"""AF-4 / Render Web Service. Private single-device live snapshots + Gemini marker checks."""
import base64
import json
import os
import re
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import requests
from cryptography.fernet import Fernet, InvalidToken
from flask import Flask, abort, jsonify, make_response, redirect, render_template, request, session, url_for

app = Flask(__name__)
app.secret_key = os.environ.get('AF4_SESSION_SECRET') or secrets.token_urlsafe(48)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                  SESSION_COOKIE_SECURE=os.environ.get('AF4_LOCAL_HTTP') != '1',
                  MAX_CONTENT_LENGTH=750_000)
DATA_DIR = Path(os.environ.get('AF4_DATA_DIR', '/tmp/af4-data'))
DATA_DIR.mkdir(parents=True, exist_ok=True)
EVENTS_PATH = DATA_DIR / 'events.json'
KEY_PATH = DATA_DIR / 'gemini.key.enc'
PANEL_PASSWORD = os.environ.get('AF4_ADMIN_PASSWORD', '')
DEVICE_TOKEN = os.environ.get('AF4_DEVICE_TOKEN', '')
MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
LOCK = threading.RLock()
LAST_FRAME = None
LAST_FRAME_AT = None
EVENTS = deque(maxlen=100)
MODE = 'home'
PENDING = None
ACTIVE_WORK = False
LAST_TRIGGER = 0.0

try:
    old = json.loads(EVENTS_PATH.read_text(encoding='utf-8'))
    for event in old[-100:]:
        if isinstance(event, dict):
            EVENTS.append(event)
except (OSError, ValueError, TypeError):
    pass


def utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')


def push_event(kind, message):
    entry = {'id': secrets.token_hex(8), 'type': kind, 'message': message, 'time': utc()}
    with LOCK:
        EVENTS.appendleft(entry)
        try:
            temp = EVENTS_PATH.with_suffix('.tmp')
            temp.write_text(json.dumps(list(EVENTS), ensure_ascii=False), encoding='utf-8')
            temp.replace(EVENTS_PATH)
        except OSError:
            app.logger.exception('Failed to persist event metadata')
    return entry


def fernet():
    key = os.environ.get('AF4_ENCRYPTION_KEY', '')
    if not key:
        return None
    try:
        return Fernet(key.encode('ascii'))
    except (ValueError, TypeError):
        return None


def gemini_key():
    env = os.environ.get('GEMINI_API_KEY')
    if env:
        return env
    crypto = fernet()
    if crypto and KEY_PATH.exists():
        try:
            return crypto.decrypt(KEY_PATH.read_bytes()).decode('utf-8')
        except (InvalidToken, OSError, UnicodeError):
            return None
    return None


def require_device(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        token = request.headers.get('X-AF4-Device-Token', '')
        if not DEVICE_TOKEN or not secrets.compare_digest(token, DEVICE_TOKEN):
            return jsonify(error='device authentication required'), 401
        return fn(*args, **kwargs)
    return wrapped


def require_panel(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not session.get('panel'):
            return jsonify(error='login required'), 401
        return fn(*args, **kwargs)
    return wrapped


def check_csrf():
    if not secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), session.get('csrf', '!')):
        abort(403)


def status_payload(device=False):
    with LOCK:
        event = dict(EVENTS[0]) if EVENTS else None
        payload = {'mode': MODE, 'gemini_configured': bool(gemini_key()), 'last_frame': LAST_FRAME_AT,
                   'latest_event': event, 'camera_online': LAST_FRAME_AT is not None and time.time() - LAST_FRAME_TIME[0] < 12,
                   'processing': bool(PENDING) or ACTIVE_WORK}
    return payload

LAST_FRAME_TIME = [0.0]


@app.get('/health')
def health():
    return jsonify(ok=True)


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        password = request.form.get('password', '')
        if PANEL_PASSWORD and secrets.compare_digest(password, PANEL_PASSWORD):
            session.clear()
            session['panel'] = True
            session['csrf'] = secrets.token_urlsafe(32)
            return redirect(url_for('panel'))
        error = 'パスワードが正しくないか、サーバーに管理者パスワードが設定されていません。'
        time.sleep(0.25)
    return render_template('login.html', error=error)


@app.get('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.get('/')
def panel():
    if not session.get('panel'):
        return redirect(url_for('login'))
    return render_template('panel.html', csrf=session['csrf'])


@app.get('/api/status')
@require_panel
def panel_status():
    return jsonify(status_payload())


@app.get('/api/events')
@require_panel
def panel_events():
    with LOCK:
        return jsonify(events=list(EVENTS))


@app.get('/api/frame/latest')
@require_panel
def latest_frame():
    with LOCK:
        image = LAST_FRAME
    if not image:
        return '', 204
    response = make_response(image)
    response.headers['Content-Type'] = 'image/jpeg'
    response.headers['Cache-Control'] = 'no-store, private, max-age=0'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/api/device/status')
@require_device
def device_status():
    return jsonify(status_payload(device=True))


@app.get('/api/device/events')
@require_device
def device_events():
    with LOCK:
        return jsonify(events=list(EVENTS)[:30])


@app.post('/api/device/mode')
@require_device
def device_mode():
    global MODE
    mode = (request.get_json(silent=True) or {}).get('mode')
    if mode not in ('home', 'away', 'sleep'):
        return jsonify(error='invalid mode'), 400
    with LOCK:
        MODE = mode
    return jsonify(ok=True, mode=mode)


@app.post('/api/admin/mode')
@require_panel
def panel_mode():
    check_csrf()
    global MODE
    mode = (request.get_json(silent=True) or {}).get('mode')
    if mode not in ('home', 'away', 'sleep'):
        return jsonify(error='invalid mode'), 400
    with LOCK:
        MODE = mode
    return jsonify(ok=True, mode=MODE)


@app.post('/api/admin/key')
@require_panel
def configure_key():
    check_csrf()
    crypto = fernet()
    if crypto is None:
        return jsonify(error='AF4_ENCRYPTION_KEY が未設定です。Renderの環境変数に登録してください。'), 400
    key = (request.get_json(silent=True) or {}).get('api_key', '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,256}', key):
        return jsonify(error='APIキーの形式を確認してください'), 400
    temp = KEY_PATH.with_suffix('.tmp')
    temp.write_bytes(crypto.encrypt(key.encode('utf-8')))
    os.chmod(temp, 0o600)
    temp.replace(KEY_PATH)
    return jsonify(ok=True, warning='無料プランのローカル保存は再起動で消えます。永続保存にはPersistent Diskなどが必要です。')


def analyze_image(image_bytes):
    key = gemini_key()
    if not key:
        return 'unknown', 'Gemini APIキーが未設定です'
    instruction = (
      'You are checking a camera frame for a deliberately worn WHITE marker attached to a PERSON. '
      'Do not identify a person. Ignore ordinary white walls, ceiling, paper, glare and clothing unless a clear '
      'distinct intentional white marker is attached to the person. '
      'Return ONLY JSON exactly {"marker_visible": true/false, "uncertain": true/false}. '
      'If image is dark/blurred, no person is visible, or it is unclear whether there is an intentional marker, '
      'set uncertain to true. This is not reliable authentication.'
    )
    payload = {'contents':[{'parts':[{'text':instruction},{'inline_data':{
               'mime_type':'image/jpeg','data':base64.b64encode(image_bytes).decode('ascii')}}]}],
               'generationConfig':{'responseMimeType':'application/json', 'temperature':0}}
    try:
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
        response = requests.post(url, json=payload, headers={'x-goog-api-key':key}, timeout=28)
        response.raise_for_status()
        body = response.json()
        text = ''.join(p.get('text','') for p in body['candidates'][0]['content']['parts'])
        result = json.loads(text.strip().removeprefix('```json').removesuffix('```').strip())
        if result.get('uncertain') is True:
            return 'unknown', 'AIが白いマーカーを判定できませんでした'
        if result.get('marker_visible') is True:
            return 'visible', '白色マーカーを確認しました'
        if result.get('marker_visible') is False and result.get('uncertain') is False:
            return 'absent', '白色マーカーを確認できませんでした'
        return 'unknown', 'Geminiの回答が不明確です'
    except (KeyError, ValueError, TypeError, requests.RequestException) as exc:
        app.logger.warning('Gemini API check failed: %s', type(exc).__name__)
        return 'unknown', 'Gemini APIへの接続・判定に失敗しました'


def process_image(image_bytes, job_id):
    global PENDING, ACTIVE_WORK
    result, msg = analyze_image(image_bytes)
    with LOCK:
        pending = PENDING
        if pending is None or pending['id'] != job_id:
            ACTIVE_WORK = False
            return
        pending['attempts'] += 1
        pending['results'].append(result)
        pending['messages'].append(msg)
        attempts = pending['attempts']
        test = pending['test']
        finished = result == 'visible' or attempts >= 2
        if finished:
            if test:
                kind = 'test'
                label = 'AI認識テスト: ' + (('白色マーカーを検知' if result=='visible' else '判定できず') if result!='absent' else '白色マーカーなし')
            elif 'visible' in pending['results']:
                kind, label = 'welcome', 'マスター、お入りください'
            elif pending['results'] == ['absent', 'absent']:
                kind, label = 'alarm', '動きを検知しましたが、白色マーカーを確認できませんでした'
            else:
                kind, label = 'unknown', '判定不確実: 警報は保留しました'
            PENDING = None
        ACTIVE_WORK = False
    if finished:
        push_event(kind, label)


@app.post('/api/frame')
@require_device
def receive_frame():
    global LAST_FRAME, LAST_FRAME_AT, PENDING, ACTIVE_WORK, LAST_TRIGGER
    image = request.get_data(cache=False)
    if not image.startswith(b'\xff\xd8') or not image.endswith(b'\xff\xd9'):
        return jsonify(error='JPEG required'), 400
    motion = request.headers.get('X-AF4-Motion') == '1'
    test = request.headers.get('X-AF4-Test') == '1'
    now = time.time()
    with LOCK:
        LAST_FRAME = image
        LAST_FRAME_AT = utc()
        LAST_FRAME_TIME[0] = now
        if PENDING and now - PENDING['created'] > 65:
            PENDING = None
            ACTIVE_WORK = False
        if (motion or test) and PENDING is None and (test or now-LAST_TRIGGER >= 9):
            PENDING = {'id':secrets.token_hex(7), 'created':now, 'attempts':0,
                       'results':[], 'messages':[], 'test':test}
            LAST_TRIGGER = now
        pending = PENDING
        if pending and not ACTIVE_WORK and now-pending['created'] < 65:
            ACTIVE_WORK = True
            worker = threading.Thread(target=process_image, args=(image,pending['id']), daemon=True)
            worker.start()
    return jsonify(ok=True, motion=motion, processing=bool(pending))


@app.after_request
def secure_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Cache-Control'] = 'no-store'
    return response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '10000')))