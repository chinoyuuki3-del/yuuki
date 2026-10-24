"""BOYS HUB: small, moderated video SNS for Render (PostgreSQL) or local SQLite.
Use Render environment secrets for production. No personal info or tracking fields.
"""
import os, re, time, uuid, hmac, base64, hashlib, secrets, sqlite3
from contextlib import contextmanager
from pathlib import Path
from collections import defaultdict, deque
from typing import Optional
from fastapi import FastAPI, Request, Response, HTTPException, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).parent
DATABASE_URL = os.getenv('DATABASE_URL', '').strip()
IS_PROD = os.getenv('APP_ENV') == 'production'
if IS_PROD and (not DATABASE_URL or not os.getenv('SESSION_SECRET')):
    raise RuntimeError('Set DATABASE_URL and SESSION_SECRET before deploying')
SECRET = (os.getenv('SESSION_SECRET') or secrets.token_urlsafe(48)).encode()
INVITE = os.getenv('INVITE_CODE', '男子')
COOKIE = 'boyshub_session'
TTL = 7 * 24 * 3600
MAX_VIDEO = 8 * 1024 * 1024  # intentionally small until durable object storage is added
ALLOWED_CATEGORIES = ('ゲーム', '機械', '工作', 'おもしろ', 'その他')
BANNED = re.compile(r'2ch|2ちゃん|スクイーズ|squishy|ダンス', re.IGNORECASE)
NAME = re.compile(r'^[\wぁ-んァ-ヶ一-龯ー]{2,24}$', re.UNICODE)
RATE = defaultdict(deque)
app = FastAPI(title='BOYS HUB', docs_url=None, redoc_url=None)

@contextmanager
def db():
    if DATABASE_URL:
        import psycopg
        from psycopg.rows import dict_row
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    else:
        conn = sqlite3.connect(str(BASE / 'local_dev.sqlite3'), timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def q(conn, sql, args=(), one=False):
    sql = sql.replace('?', '%s') if DATABASE_URL else sql
    cur = conn.execute(sql, args)
    if cur.description:
        result = cur.fetchone() if one else cur.fetchall()
        return dict(result) if (one and result) else ([dict(r) for r in result] if not one else None)
    return None

def setup_database():
    binary = 'BYTEA' if DATABASE_URL else 'BLOB'
    stmts = [
        '''CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
           passhash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', blocked INTEGER NOT NULL DEFAULT 0,
           created BIGINT NOT NULL)''',
        f'''CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
           title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
           mime TEXT NOT NULL, media {binary} NOT NULL, size_bytes INTEGER NOT NULL, created BIGINT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS likes (user_id TEXT NOT NULL REFERENCES users(id),
           post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
           PRIMARY KEY(user_id,post_id))''',
        '''CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
           post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, body TEXT NOT NULL, created BIGINT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
           post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
           reason TEXT NOT NULL, created BIGINT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
           UNIQUE(user_id,post_id))''',
        'CREATE INDEX IF NOT EXISTS idx_post_date ON posts(created DESC)',
        'CREATE INDEX IF NOT EXISTS idx_comment_post ON comments(post_id,created)',
    ]
    with db() as conn:
        for sql in stmts: q(conn, sql)
        admin_name = os.getenv('ADMIN_USERNAME', 'admin').strip()
        admin_pw = os.getenv('ADMIN_PASSWORD', '')
        if admin_pw:
            if len(admin_pw) < 12:
                raise RuntimeError('ADMIN_PASSWORD must be at least 12 characters')
            admin = q(conn, 'SELECT id,role FROM users WHERE username=?', (admin_name,), one=True)
            if not admin:
                q(conn, 'INSERT INTO users(id,username,passhash,role,created) VALUES(?,?,?,?,?)',
                  (uid(), admin_name, hash_password(admin_pw), 'admin', now()))
            elif admin['role'] != 'admin':
                raise RuntimeError('ADMIN_USERNAME conflicts with a regular user')
            else:
                # Environment secret is source of truth for administrator login.
                stored = q(conn, 'SELECT passhash FROM users WHERE id=?', (admin['id'],), one=True)
                if not verify_password(admin_pw, stored['passhash']):
                    q(conn, 'UPDATE users SET passhash=? WHERE id=?', (hash_password(admin_pw),admin['id']))

@app.on_event('startup')
def startup():
    setup_database()

def now(): return int(time.time())
def uid(): return uuid.uuid4().hex

def hash_password(password):
    salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 250000)
    return base64.b64encode(salt).decode() + ':' + base64.b64encode(key).decode()

def verify_password(password, saved):
    try:
        salt_s, key_s = saved.split(':', 1)
        key = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(salt_s), 250000)
        return hmac.compare_digest(key, base64.b64decode(key_s))
    except (ValueError, TypeError): return False

def sign(user_id):
    payload = f'{user_id}.{now()+TTL}'.encode()
    body = base64.urlsafe_b64encode(payload).decode().rstrip('=')
    mac = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + mac

def parse_cookie(token):
    try:
        body, mac = token.rsplit('.', 1)
        expected = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, expected): return None
        payload = base64.urlsafe_b64decode(body + '='*(-len(body)%4))
        user_id, expires = payload.decode().rsplit('.', 1)
        if int(expires) < now(): return None
        return user_id
    except (ValueError, UnicodeDecodeError, IndexError): return None

def set_login(response, user_id):
    response.set_cookie(COOKIE, sign(user_id), max_age=TTL, httponly=True,
                        secure=IS_PROD, samesite='lax', path='/')

def user_for(request: Request):
    user_id = parse_cookie(request.cookies.get(COOKIE, ''))
    if not user_id: raise HTTPException(401, 'ログインしてください')
    with db() as conn:
        user = q(conn, 'SELECT id,username,role,blocked FROM users WHERE id=?', (user_id,), one=True)
    if not user: raise HTTPException(401, 'アカウントがありません')
    if user['blocked']: raise HTTPException(403, 'このアカウントは利用停止されています')
    return user

def admin_for(user=Depends(user_for)):
    if user['role'] != 'admin': raise HTTPException(403, '管理者のみ利用できます')
    return user

def limited(request: Request, scope, max_req, seconds):
    key = (scope, request.client.host if request.client else 'unknown')
    bucket = RATE[key]
    while bucket and bucket[0] <= time.time()-seconds: bucket.popleft()
    if len(bucket) >= max_req: raise HTTPException(429, '操作が多すぎます。少し時間をおいてください')
    bucket.append(time.time())

@app.middleware('http')
async def security(request: Request, call_next):
    if request.method in ('POST','PUT','PATCH','DELETE'):
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return Response('Cross-site request blocked', status_code=403)
        origin = request.headers.get('origin')
        if origin:
            from urllib.parse import urlparse
            a, b = urlparse(origin), urlparse(str(request.base_url))
            # Render edge terminates HTTPS. Host matching is the decisive boundary.
            if a.netloc.lower() != b.netloc.lower() or a.scheme not in ('http','https'):
                return Response('Cross-origin request blocked', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    return response

class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=24)
    password: str = Field(min_length=8, max_length=128)
    invite: str = ''
class Login(BaseModel):
    username: str
    password: str
class Comment(BaseModel):
    body: str = Field(min_length=1, max_length=280)
class Report(BaseModel):
    reason: str = Field(min_length=3, max_length=160)
class BlockAction(BaseModel):
    blocked: bool

@app.post('/api/register')
def register(data: Credentials, request: Request, response: Response):
    limited(request, 'register', 5, 3600)
    name = data.username.strip()
    if data.invite != INVITE: raise HTTPException(403, '招待コードが違います')
    if not NAME.fullmatch(name): raise HTTPException(400, 'ユーザー名は2～24文字の文字・数字にしてください')
    if data.password == data.invite: raise HTTPException(400, 'アカウントのパスワードは招待コードと違うものにしてください')
    with db() as conn:
        if q(conn, 'SELECT id FROM users WHERE username=?', (name,), one=True):
            raise HTTPException(409, 'その名前はすでに使われています')
        user_id = uid()
        q(conn, 'INSERT INTO users(id,username,passhash,role,created) VALUES(?,?,?,?,?)',
          (user_id,name,hash_password(data.password),'user',now()))
    set_login(response, user_id)
    return {'ok': True}

@app.post('/api/login')
def login(data: Login, request: Request, response: Response):
    limited(request, 'login', 15, 600)
    with db() as conn:
        account = q(conn, 'SELECT id,passhash,blocked FROM users WHERE username=?', (data.username.strip(),), one=True)
    if not account or not verify_password(data.password, account['passhash']):
        raise HTTPException(401, 'ユーザー名かパスワードが違います')
    if account['blocked']: raise HTTPException(403, 'このアカウントは利用停止されています')
    set_login(response, account['id'])
    return {'ok': True}

@app.post('/api/logout')
def logout(response: Response):
    response.delete_cookie(COOKIE, path='/')
    return {'ok': True}

@app.get('/api/me')
def me(user=Depends(user_for)):
    return user

POST_SQL = '''SELECT p.id,p.user_id,p.title,p.description,p.category,p.mime,p.size_bytes,p.created,
  u.username,(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments_count
  FROM posts p JOIN users u ON u.id=p.user_id WHERE u.blocked=0'''

@app.get('/api/posts')
def posts(user=Depends(user_for), category: str = '', search: str = '', mine: bool = False):
    with db() as conn:
        rows = q(conn, POST_SQL + ' ORDER BY p.created DESC LIMIT 120')
        liked = {r['post_id'] for r in q(conn,'SELECT post_id FROM likes WHERE user_id=?',(user['id'],))}
    if category and category in ALLOWED_CATEGORIES: rows = [r for r in rows if r['category']==category]
    if mine: rows = [r for r in rows if r['user_id']==user['id']]
    if search:
        needle = search[:80].casefold()
        rows = [r for r in rows if needle in (r['title']+' '+r['description']+' '+r['username']).casefold()]
    for r in rows: r['liked'] = r['id'] in liked
    return rows

def sniff(blob):
    if len(blob)>12 and blob[4:8] == b'ftyp': return 'video/mp4'
    if blob[:4] == b'\x1a\x45\xdf\xa3': return 'video/webm'
    return None

@app.post('/api/posts', status_code=201)
async def create_post(request: Request, title: str = Form(...),
                      description: str = Form(''), category: str = Form('その他'),
                      video: UploadFile = File(...), user=Depends(user_for)):
    limited(request, 'post-'+user['id'], 8, 3600)
    title, description = title.strip(), description.strip()
    if not 1<=len(title)<=70 or len(description)>350: raise HTTPException(400, 'タイトルか説明が長すぎます')
    if category not in ALLOWED_CATEGORIES: raise HTTPException(400, 'ジャンルが違います')
    if BANNED.search(title+' '+description): raise HTTPException(400, 'このジャンルは投稿できません')
    blob = await video.read(MAX_VIDEO+1)
    mime = sniff(blob)
    if not blob or len(blob)>MAX_VIDEO or not mime:
        raise HTTPException(400, '8MB以下のMP4/WebM動画を選んでください')
    with db() as conn:
        post_id=uid()
        q(conn,'''INSERT INTO posts(id,user_id,title,description,category,mime,media,size_bytes,created)
                  VALUES(?,?,?,?,?,?,?,?,?)''',
          (post_id,user['id'],title,description,category,mime,blob,len(blob),now()))
    return {'id':post_id}

@app.get('/api/media/{post_id}')
def media(post_id: str, request: Request, user=Depends(user_for)):
    with db() as conn:
        p = q(conn,'''SELECT p.media,p.mime,p.size_bytes FROM posts p
          JOIN users u ON p.user_id=u.id WHERE p.id=? AND u.blocked=0''',(post_id,), one=True)
    if not p: raise HTTPException(404, '動画がありません')
    data=bytes(p['media'])
    total=len(data)
    headers={'Accept-Ranges':'bytes', 'Cache-Control':'private, max-age=120'}
    rng=request.headers.get('range','')
    if rng:
        m=re.fullmatch(r'bytes=(\d*)-(\d*)',rng.strip())
        if not m or not (m.group(1) or m.group(2)): raise HTTPException(416,'Invalid Range')
        if not m.group(1):
            n=int(m.group(2)); start=max(0,total-n);end=total-1
        else:
            start=int(m.group(1));end=min(total-1,int(m.group(2))) if m.group(2) else total-1
        if start>=total or end<start: raise HTTPException(416,'Invalid Range')
        headers['Content-Range']=f'bytes {start}-{end}/{total}'
        return Response(data[start:end+1],status_code=206,media_type=p['mime'],headers=headers)
    return Response(data,media_type=p['mime'],headers=headers)

@app.delete('/api/posts/{post_id}')
def delete_post(post_id: str, user=Depends(user_for)):
    with db() as conn:
        p=q(conn,'SELECT user_id FROM posts WHERE id=?',(post_id,),one=True)
        if not p:raise HTTPException(404,'投稿がありません')
        if p['user_id']!=user['id'] and user['role']!='admin': raise HTTPException(403,'削除権限がありません')
        q(conn,'DELETE FROM posts WHERE id=?',(post_id,))
    return {'ok':True}

@app.post('/api/posts/{post_id}/like')
def like(post_id: str, user=Depends(user_for)):
    with db() as conn:
        if not q(conn,'SELECT id FROM posts WHERE id=?',(post_id,),one=True):
            raise HTTPException(404, '投稿がありません')
        own=q(conn,'SELECT user_id FROM likes WHERE user_id=? AND post_id=?',(user['id'],post_id),one=True)
        if own: q(conn,'DELETE FROM likes WHERE user_id=? AND post_id=?',(user['id'],post_id))
        else: q(conn,'INSERT INTO likes(user_id,post_id) VALUES(?,?)',(user['id'],post_id))
    return {'liked': not bool(own)}

@app.get('/api/posts/{post_id}/comments')
def comments(post_id: str, user=Depends(user_for)):
    with db() as conn:
        return q(conn,'''SELECT c.id,c.body,c.created,u.username FROM comments c
             JOIN users u ON u.id=c.user_id WHERE c.post_id=? AND u.blocked=0
             ORDER BY c.created ASC LIMIT 100''',(post_id,))

@app.post('/api/posts/{post_id}/comments')
def add_comment(post_id: str, data: Comment, request: Request, user=Depends(user_for)):
    limited(request, 'comment-'+user['id'], 30, 3600)
    content=data.body.strip()
    if not content or BANNED.search(content): raise HTTPException(400,'このコメントは投稿できません')
    with db() as conn:
        if not q(conn,'SELECT id FROM posts WHERE id=?',(post_id,),one=True):raise HTTPException(404,'投稿がありません')
        q(conn,'INSERT INTO comments(id,user_id,post_id,body,created) VALUES(?,?,?,?,?)',
          (uid(),user['id'],post_id,content,now()))
    return {'ok':True}

@app.post('/api/posts/{post_id}/report')
def report(post_id: str, data: Report, user=Depends(user_for)):
    with db() as conn:
        if not q(conn,'SELECT id FROM posts WHERE id=?',(post_id,),one=True):raise HTTPException(404,'投稿がありません')
        q(conn,'''INSERT INTO reports(id,user_id,post_id,reason,created) VALUES(?,?,?,?,?)
           ON CONFLICT(user_id,post_id) DO NOTHING''',
           (uid(),user['id'],post_id,data.reason.strip(),now()))
    return {'ok':True}

@app.get('/api/admin/users')
def admin_users(admin=Depends(admin_for)):
    with db() as conn:
        return q(conn,'''SELECT u.id,u.username,u.role,u.blocked,u.created,
           (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id) AS posts_count
           FROM users u ORDER BY u.created DESC LIMIT 300''')

@app.patch('/api/admin/users/{user_id}')
def admin_block(user_id: str, data: BlockAction, admin=Depends(admin_for)):
    if user_id==admin['id']:raise HTTPException(400,'自分自身は停止できません')
    with db() as conn:
        target=q(conn,'SELECT id,role FROM users WHERE id=?',(user_id,),one=True)
        if not target: raise HTTPException(404,'アカウントがありません')
        if target['role']=='admin':raise HTTPException(403,'別の管理者は停止できません')
        q(conn,'UPDATE users SET blocked=? WHERE id=?',(int(data.blocked),user_id))
    return {'ok':True}

@app.get('/api/admin/reports')
def admin_reports(admin=Depends(admin_for)):
    with db() as conn:
        return q(conn,'''SELECT r.id,r.post_id,r.reason,r.created,r.resolved,
             u.username AS reporter,p.title FROM reports r
             JOIN users u ON r.user_id=u.id JOIN posts p ON p.id=r.post_id
             ORDER BY r.resolved ASC,r.created DESC LIMIT 200''')

@app.post('/api/admin/reports/{report_id}/resolve')
def resolve_report(report_id: str, admin=Depends(admin_for)):
    with db() as conn:
        q(conn,'UPDATE reports SET resolved=1 WHERE id=?',(report_id,))
    return {'ok':True}

@app.get('/health')
def health(): return {'ok':True}

@app.get('/')
def homepage(): return FileResponse(BASE/'static'/'index.html')
app.mount('/static', StaticFiles(directory=BASE/'static'), name='static')
