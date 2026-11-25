# -*- coding: utf-8 -*-
# Photo Kit 2026 — простой сервер: роли (гость/читатель/админ), сессии 5 минут,
# хранение в users.csv / data.csv, логирование всех действий в logs.csv.
# Запуск:  pip install flask  ->  python app.py
from flask import Flask, request, redirect, send_from_directory, jsonify
import csv, os, json, hashlib, uuid, time

BASE = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE, 'users.csv')
DATA_FILE  = os.path.join(BASE, 'data.csv')
LOGS_FILE  = os.path.join(BASE, 'logs.csv')
SESSION_TIMEOUT = 5 * 60                      # 5 минут

app = Flask(__name__)
sessions = {}                                 # токен -> {login, role, last}

# ================= пароли и csv =================
def hash_pw(pw):
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()

def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f, delimiter=';'))

def write_csv(path, rows, fields):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=';')
        w.writeheader()
        w.writerows(rows)

def seed():
    if not os.path.exists(USERS_FILE):
        write_csv(USERS_FILE, [
            {'login': 'admin',  'password': hash_pw('admin'),  'avatar': 'static/ava/admin.png',  'role': 'admin'},
            {'login': 'reader', 'password': hash_pw('reader'), 'avatar': 'static/ava/reader.png', 'role': 'reader'},
        ], ['login', 'password', 'avatar', 'role'])
    if not os.path.exists(DATA_FILE):
        write_csv(DATA_FILE, [], ['login', 'key', 'value'])
    if not os.path.exists(LOGS_FILE):
        write_csv(LOGS_FILE, [], ['time', 'login', 'role', 'page', 'action'])
seed()

def log(login, role, page, action):
    rows = read_csv(LOGS_FILE)
    rows.append({'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'login': login,
                 'role': role, 'page': page, 'action': action})
    write_csv(LOGS_FILE, rows, ['time', 'login', 'role', 'page', 'action'])

def users():
    return read_csv(USERS_FILE)

def find_user(login):
    for u in users():
        if u['login'] == login:
            return u
    return None

# ================= данные приложения (data.csv) =================
def data_get(login, key, default):
    for r in read_csv(DATA_FILE):
        if r['login'] == login and r['key'] == key:
            try:
                return json.loads(r['value'])
            except Exception:
                return default
    return default

def data_set_key(login, key, value):
    rows = [r for r in read_csv(DATA_FILE) if not (r['login'] == login and r['key'] == key)]
    rows.append({'login': login, 'key': key, 'value': json.dumps(value, ensure_ascii=False)})
    write_csv(DATA_FILE, rows, ['login', 'key', 'value'])

def data_set_all(login, state):
    for key in ('profile', 'kits', 'views', 'activity'):
        if key in state:
            data_set_key(login, key, state[key])

# ================= сессии =================
def now():
    return time.time()

def start_session(login, role):
    token = uuid.uuid4().hex
    sessions[token] = {'login': login, 'role': role, 'last': now()}
    return token

def user():
    token = request.cookies.get('sid')
    s = sessions.get(token)
    if not s:
        return None
    if now() - s['last'] > SESSION_TIMEOUT:    # таймаут 5 минут
        sessions.pop(token, None)
        return None
    s['last'] = now()                          # продлеваем при активности
    return s

# ================= стартовые данные пользователя =================
DEFAULT_PROFILE = {'displayName': 'Алиса Ветрова', 'username': 'alice.frames',
                   'bio': 'Снимаю город на 35 мм и спорю с автофокусом.',
                   'avatar': '📷', 'accent': '#ff4fa0', 'brand': 'Sony',
                   'joined': '2026-03-14', 'frames': 1284}
DEFAULT_KITS = [
    {'id': 'k1', 'name': 'Стрит-минимализм', 'tag': 'street', 'body': '550|1350|Fujifilm X-S20', 'lens': '180|250|Фикс 35mm f/1.8', 'parts': ['led'], 'fav': True,  'createdAt': '2026-09-02T10:12:00'},
    {'id': 'k2', 'name': 'Свадебный репортаж', 'tag': 'event', 'body': '650|1900|Sony A7 IV', 'lens': '695|2100|Зум 24-70mm f/2.8', 'parts': ['flash'], 'fav': False, 'createdAt': '2026-09-18T16:40:00'},
    {'id': 'k3', 'name': 'Кино-риг Full Cage', 'tag': 'cinema', 'body': '715|3400|Sony A7S III', 'lens': '520|950|Кино-фикс 24mm T1.5', 'parts': ['cage', 'top-handle', 'mattebox', 'monitor', 'vmount'], 'fav': True, 'createdAt': '2026-10-07T09:05:00'},
]
DEFAULT_VIEWS = [
    {'id': 'v-all', 'name': 'Все', 'f': {'q': '', 'tag': 'all', 'fav': False, 'sort': 'manual', 'dir': 'desc', 'maxW': 4000, 'maxP': 12000}},
    {'id': 'v-fav', 'name': 'Избранные', 'f': {'q': '', 'tag': 'all', 'fav': True, 'sort': 'manual', 'dir': 'desc', 'maxW': 4000, 'maxP': 12000}},
]
DEFAULT_ACTIVITY = [
    {'id': 'a1', 'at': '2026-11-21T19:02:00', 'icon': '🎬', 'text': 'Собран кит «Кино-риг Full Cage»'},
    {'id': 'a2', 'at': '2026-10-07T09:05:00', 'icon': '✨', 'text': 'Профиль создан'},
]

# ================= страницы =================
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if user():
            return redirect('/')
        log('guest', 'guest', '/login', 'просмотр страницы входа')
        return send_from_directory(BASE, 'login.html')

    action = request.form.get('action')
    name = (request.form.get('username') or '').strip()
    pw = request.form.get('password') or ''

    if action == 'register':                   # регистрация даёт роль читателя
        if not name or find_user(name):
            log(name or 'guest', 'guest', '/login', 'ошибка регистрации')
            return redirect('/register.html?err=1')
        rows = users()
        rows.append({'login': name, 'password': hash_pw(pw),
                     'avatar': 'static/ava/%s.png' % name, 'role': 'reader'})
        write_csv(USERS_FILE, rows, ['login', 'password', 'avatar', 'role'])
        token = start_session(name, 'reader')
        log(name, 'reader', '/login', 'регистрация и вход')
        resp = redirect('/profile.html')
        resp.set_cookie('sid', token, max_age=SESSION_TIMEOUT)
        return resp

    u = find_user(name)
    if u and u['password'] == hash_pw(pw):
        token = start_session(u['login'], u['role'])
        log(u['login'], u['role'], '/login', 'вход')
        resp = redirect('/')
        resp.set_cookie('sid', token, max_age=SESSION_TIMEOUT)
        return resp
    log(name or 'guest', 'guest', '/login', 'неудачная попытка входа')
    return redirect('/login?err=1')

@app.route('/logout')
def logout():
    token = request.cookies.get('sid')
    s = sessions.pop(token, None)
    if s:
        log(s['login'], s['role'], '/logout', 'выход')
    resp = redirect('/login')
    resp.set_cookie('sid', '', max_age=0)
    return resp

@app.route('/')
def index():
    s = user()
    if not s:
        log('guest', 'guest', '/', 'отказ: нет сессии')
        return redirect('/login')
    log(s['login'], s['role'], '/', 'просмотр главной')
    return send_from_directory(BASE, 'index.html')

@app.route('/profile.html')
def profile_page():
    s = user()
    if not s:
        log('guest', 'guest', '/profile.html', 'отказ: нет сессии')
        return redirect('/login')
    log(s['login'], s['role'], '/profile.html', 'просмотр своего профиля')
    return send_from_directory(BASE, 'profile.html')

@app.route('/register.html')
def register_page():
    log('guest', 'guest', '/register.html', 'просмотр регистрации')
    return send_from_directory(BASE, 'register.html')

# ================= api =================
@app.route('/api/state')
def api_state():
    s = user()
    if not s:
        return jsonify({'error': 'no session'}), 401
    u = find_user(s['login'])
    return jsonify({
        'login': s['login'], 'role': s['role'],
        'avatar': u['avatar'] if u else '',
        'profile':  data_get(s['login'], 'profile',  DEFAULT_PROFILE),
        'kits':     data_get(s['login'], 'kits',     DEFAULT_KITS),
        'views':    data_get(s['login'], 'views',    DEFAULT_VIEWS),
        'activity': data_get(s['login'], 'activity', DEFAULT_ACTIVITY),
    })

@app.route('/api/state', methods=['POST'])
def api_state_save():
    s = user()
    if not s:
        return jsonify({'error': 'no session'}), 401
    body = request.get_json(silent=True) or {}
    if s['role'] == 'reader':                  # читателю можно только свою ленту
        if 'activity' in body:
            data_set_key(s['login'], 'activity', body['activity'])
        log(s['login'], s['role'], '/api/state', 'отказ в изменении данных (читатель)')
        return jsonify({'ok': True, 'partial': True})
    if s['role'] != 'admin':
        log(s['login'], s['role'], '/api/state', 'отказ: недостаточно прав')
        return jsonify({'error': 'forbidden'}), 403
    data_set_all(s['login'], body)
    log(s['login'], s['role'], '/api/state', 'сохранение данных приложения')
    return jsonify({'ok': True})

@app.route('/api/log', methods=['POST'])
def api_log():
    s = user()
    if not s:
        return jsonify({'error': 'no session'}), 401
    b = request.get_json(silent=True) or {}
    log(s['login'], s['role'], b.get('page', '?'), b.get('action', 'действие'))
    return jsonify({'ok': True})

@app.errorhandler(404)
def not_found(e):
    s = user()
    log(s['login'] if s else 'guest', s['role'] if s else 'guest', request.path, 'ошибка 404')
    return send_from_directory(BASE, '404.html'), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)