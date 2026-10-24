"""End-to-end API checks. Run `pytest -q test_smoke.py`."""
import pytest
from fastapi.testclient import TestClient

OWNER='a-very-long-unique-owner-bootstrap-password'

@pytest.fixture
def client(tmp_path, monkeypatch):
    import main
    main.DATABASE_URL = ''
    main.BASE = tmp_path
    main.OWNER_SETUP_CODE = OWNER
    main.IS_PROD = False
    (tmp_path/'static').mkdir(exist_ok=True)
    (tmp_path/'static'/'index.html').write_text('<h1>test</h1>')
    main.RATE.clear()
    with TestClient(main.app) as c:
        yield c


def register(c, name, code='男子', password='safe-password-123'):
    return c.post('/api/register',json={'username':name,'password':password,'invite':code})

def test_owner_and_admin_invite(client):
    c=client
    assert c.get('/api/setup').json()['needs_owner']
    assert register(c,'ordinary').status_code==403
    assert c.get('/api/setup').json()['needs_owner']
    first=c.post('/api/register',json={'username':'firstowner','password':'safe-password-123','owner_code':'wrong'})
    assert first.status_code==403,first.text
    first=c.post('/api/register',json={'username':'firstowner','password':'safe-password-123','owner_code':OWNER})
    assert first.status_code==200,first.text
    assert first.json()['role']=='owner'
    assert c.get('/api/setup').json()['needs_owner'] is False
    assert c.get('/api/me').json()['role']=='owner'
    assert c.post('/api/register',json={'username':'impostor','password':'safe-password-123','owner_code':OWNER}).status_code==403
    assert c.get('/api/admin/users').status_code==200
    import main; main.RATE.clear() # reset per-IP throttling while simulating different clients

    token=c.post('/api/admin/invites').json()['code']
    assert len(token)>20
    inv=c.get('/api/admin/invites').json()
    assert len(inv)==1 and 'code' not in inv[0] and 'token_hash' not in inv[0]
    assert c.post('/api/logout').status_code==200
    assert register(c,'userA').status_code==200
    assert c.get('/api/admin/users').status_code==403
    # Regular users can accept a code to become an admin.
    assert c.post('/api/admin/invites/accept',json={'code':'wrongwrongwrongwrong'}).status_code==403
    assert c.post('/api/admin/invites/accept',json={'code':token}).status_code==200
    assert c.get('/api/me').json()['role']=='admin'
    assert c.post('/api/logout').status_code==200
    assert register(c,'userB').status_code==200
    assert c.post('/api/admin/invites/accept',json={'code':token}).status_code==403
    assert c.post('/api/logout').status_code==200
    main.RATE.clear()
    assert register(c,'userC',code=token).status_code==403
    # Other admins can issue invites too.
    assert c.post('/api/login',json={'username':'userA','password':'safe-password-123'}).status_code==200
    token2=c.post('/api/admin/invites').json()['code']
    assert c.post('/api/logout').status_code==200
    assert register(c,'invited',code=token2).status_code==200
    assert c.get('/api/me').json()['role']=='admin'
    assert c.post('/api/admin/invites/accept',json={'code':token2}).status_code==409


def test_post_and_moderation(client):
    c=client
    assert c.post('/api/register',json={'username':'firstowner','password':'safe-password-123','owner_code':OWNER}).status_code==200
    assert c.post('/api/logout').status_code==200
    assert register(c,'testuser').status_code==200
    video=b'\x00\x00\x00\x18ftypmp42'+b'0'*2048
    r=c.post('/api/posts',data={'title':'テスト動画','description':'歯車を作った','category':'機械'}, files={'video':('test.mp4',video,'video/mp4')})
    assert r.status_code==201,r.text
    pid=r.json()['id']
    assert len(c.get('/api/posts').json())==1
    r=c.get('/api/media/'+pid,headers={'Range':'bytes=0-7'})
    assert r.status_code==206 and len(r.content)==8
    assert c.post('/api/posts/'+pid+'/like').json()['liked'] is True
    assert c.post('/api/posts/'+pid+'/comments',json={'body':'すごい！'}).status_code==200
    assert c.post('/api/posts/'+pid+'/report',json={'reason':'テストで報告'}).status_code==200
    assert c.get('/api/admin/users').status_code==403
    user_id=c.get('/api/me').json()['id']
    assert c.post('/api/logout').status_code==200
    assert c.post('/api/login',json={'username':'firstowner','password':'safe-password-123'}).status_code==200
    assert len(c.get('/api/admin/reports').json())==1
    assert c.patch('/api/admin/users/'+user_id,json={'blocked':True}).status_code==200
    assert c.get('/api/posts').json()==[]
    assert c.patch('/api/admin/users/'+user_id,json={'blocked':False}).status_code==200
    assert len(c.get('/api/posts').json())==1
    assert c.delete('/api/posts/'+pid).status_code==200
    assert c.get('/api/posts').json()==[]


def test_content_filters(client):
    c=client
    assert c.post('/api/register',json={'username':'firstowner','password':'safe-password-123','owner_code':OWNER}).status_code==200
    assert c.post('/api/logout').status_code==200
    assert register(c,'another').status_code==200
    blob=b'\x00\x00\x00\x18ftypmp42'
    r=c.post('/api/posts',data={'title':'スクイーズ動画','category':'ゲーム'},files={'video':('a.mp4',blob,'video/mp4')})
    assert r.status_code==400
    r=c.post('/api/posts',data={'title':'良い動画','category':'ゲーム'},files={'video':('a.txt',b'bad-data','video/mp4')})
    assert r.status_code==400
