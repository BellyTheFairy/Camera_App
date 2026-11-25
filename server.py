# -*- coding: utf-8 -*-
# Photo Kit 2026 — простой сервер: роли, CSV-хранилище, логи, сессии по 5 минут.
# Запуск:  pip install flask  ->  python server.py  ->  http://127.0.0.1:8000
# Роли: неавторизованный (ничего), читатель (смотрит главную и свой профиль), админ (всё).
import csv, json, os, time, uuid, hashlib
from datetime import datetime
from flask import Flask, request, redirect, send_from_directory, jsonify, g, make_response

ROOT      = os.path.dirname(os.path.abspath(__file__))
PAGES     = os.path.join(ROOT, 'pages')
STATIC    = os.path.join(ROOT, 'static')
IMAGES    = os.path.join(ROOT, 'images')
AVATARS   = os.path.join(STATIC, 'avatars')
USERS_CSV = os.path.join(ROOT, 'users.csv')   # login;password_hash;avatar;role
DATA_CSV  = os.path.join(ROOT, 'data.csv')    # kind;owner;payload(JSON)
LOGS_CSV  = os.path.join(ROOT, 'logs.csv')    # time;login;method;path;note

SESSION_TTL = 5 * 60                          # таймаут сессии, сек
SESSIONS = {}                                 # sid -> {login, role, expires}

USER_COLS = ['login', 'password_hash', 'avatar', 'role']
DATA_COLS = ['kind', 'owner', 'payload']
LOG_COLS  = ['time', 'login', 'method', 'path', 'note']
PUBLIC_PAGES = {'login.html', 'register.html'}
DEFAULT_AVATAR = 'static/avatars/default.svg'

app = Flask(__name__)

# ---------- файлы CSV ----------
def read_csv(path, cols):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        return [dict(r) for r in csv.DictReader(f)]

def write_csv(path, cols, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

def log(login, method, path, note=''):
    with open(LOGS_CSV, 'a', newline='', encoding='utf-8') as f:
        csv.writer(f).writerow([datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                                login or 'anon', method, path, note])

# ---------- пароли ----------
def hash_password(pwd):
    salt = os.urandom(8).hex()
    return salt + ':' + hashlib.sha256((salt + pwd).encode('utf-8')).hexdigest()

def check_password(pwd, stored):
    salt, h = stored.split(':', 1)
    return hashlib.sha256((salt + pwd).encode('utf-8')).hexdigest() == h

# ---------- данные приложения (data.csv) ----------
def get_payload(kind, owner, default):
    for row in read_csv(DATA_CSV, DATA_COLS):
        if row['kind'] == kind and row['owner'] == owner:
            try:
                return json.loads(row['payload'])
            except Exception:
                return default
    return default

def set_payload(kind, owner, value):
    rows = read_csv(DATA_CSV, DATA_COLS)
    text = json.dumps(value, ensure_ascii=False)
    for row in rows:
        if row['kind'] == kind and row['owner'] == owner:
            row['payload'] = text
            write_csv(DATA_CSV, DATA_COLS, rows)
            return
    rows.append({'kind': kind, 'owner': owner, 'payload': text})
    write_csv(DATA_CSV, DATA_COLS, rows)

# ---------- сессии ----------
def get_session():
    sid = request.cookies.get('sid')
    s = SESSIONS.get(sid)
    if not s:
        return None
    if s['expires'] < time.time():           # протухла
        SESSIONS.pop(sid, None)
        return None
    s['expires'] = time.time() + SESSION_TTL # скользящий таймаут
    return s

def start_session(user):
    sid = uuid.uuid4().hex
    SESSIONS[sid] = {'login': user['login'], 'role': user['role'],
                     'expires': time.time() + SESSION_TTL}
    return sid

# ---------- стартовые данные ----------
DEFAULT_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
               '<circle cx="32" cy="32" r="30" fill="#ff9cc9"/>'
               '<circle cx="32" cy="32" r="16" fill="#8f1d5c"/>'
               '<circle cx="26" cy="26" r="5" fill="#fff"/></svg>')

def seed():
    os.makedirs(AVATARS, exist_ok=True)
    if not os.path.exists(os.path.join(AVATARS, 'default.svg')):
        with open(os.path.join(AVATARS, 'default.svg'), 'w', encoding='utf-8') as f:
            f.write(DEFAULT_SVG)
    if not os.path.exists(USERS_CSV):
        write_csv(USERS_CSV, USER_COLS, [
            {'login': 'admin',  'password_hash': hash_password('admin123'),  'avatar': DEFAULT_AVATAR, 'role': 'admin'},
            {'login': 'reader', 'password_hash': hash_password('reader123'), 'avatar': DEFAULT_AVATAR, 'role': 'reader'},
        ])
    if not os.path.exists(DATA_CSV):
        admin_kits = [{'id': 'k1', 'name': 'Студийный комплект', 'tag': 'event',
                       'body': '650|1900|Sony A7 IV', 'lens': '695|2100|Зум 24-70mm f/2.8',
                       'parts': ['flash', 'monitor'], 'fav': True, 'createdAt': '2026-10-01T10:00:00'}]
        reader_kits = [{'id': 'k2', 'name': 'Мой первый кит', 'tag': 'street',
                        'body': '550|1350|Fujifilm X-S20', 'lens': '180|250|Фикс 35mm f/1.8',
                        'parts': ['led'], 'fav': False, 'createdAt': '2026-11-01T10:00:00'}]
        write_csv(DATA_CSV, DATA_COLS, [
            {'kind': 'kits', 'owner': 'admin',  'payload': json.dumps(admin_kits, ensure_ascii=False)},
            {'kind': 'profile', 'owner': 'admin',  'payload': json.dumps({'displayName': 'Админ Студии', 'bio': 'Слежу за порядком и чужими ригами.', 'avatar': '🛠', 'brand': 'Sony', 'joined': '2026-01-10', 'frames': 4210}, ensure_ascii=False)},
            {'kind': 'kits', 'owner': 'reader', 'payload': json.dumps(reader_kits, ensure_ascii=False)},
            {'kind': 'profile', 'owner': 'reader', 'payload': json.dumps({'displayName': 'Читатель', 'bio': 'Смотрю, не трогаю.', 'avatar': '👀', 'brand': 'Fujifilm', 'joined': '2026-09-01', 'frames': 120}, ensure_ascii=False)},
        ])
    if not os.path.exists(LOGS_CSV):
        write_csv(LOGS_CSV, LOG_COLS, [])

# ---------- служебное ----------
def body():
    if request.is_json:
        return request.get_json(silent=True) or {}
    return request.form.to_dict()

def find_user(login):
    return next((u for u in read_csv(USERS_CSV, USER_COLS) if u['login'] == login), None)

@app.before_request
def before():
    g.user = get_session()
    g.note = ''

@app.after_request
def after(resp):
    if not request.path.startswith('/static/') and not request.path.startswith('/images/'):
        login = g.user['login'] if getattr(g, 'user', None) else 'anon'
        log(login, request.method, request.path, getattr(g, 'note', ''))
    return resp

# ---------- страницы и статика ----------
@app.route('/')
def root():
    return redirect('/index.html')

@app.route('/<page>.html')
def page(page):
    if page not in PUBLIC_PAGES and not g.user:
        g.note = 'отказ: нет сессии'
        return redirect('/login.html')
    if page == 'admin.html' and (not g.user or g.user['role'] != 'admin'):
        g.note = 'отказ: страница админа'
        return redirect('/index.html')
    g.note = 'просмотр ' + page
    return send_from_directory(PAGES, page)

@app.route('/static/<path:p>')
def static_files(p):
    return send_from_directory(STATIC, p)

@app.route('/images/<path:p>')
def image_files(p):
    return send_from_directory(IMAGES, p)

# ---------- вход / выход / регистрация ----------
@app.route('/api/login', methods=['POST'])
def api_login():
    d = body()
    login = (d.get('login') or d.get('username') or '').strip()
    user = find_user(login)
    if not user or not check_password(d.get('password') or '', user['password_hash']):
        g.note = 'неудачный вход: ' + login
        return jsonify({'error': 'Неверный логин или пароль'}), 401
    sid = start_session(user)
    g.user = {'login': user['login'], 'role': user['role']}
    g.note = 'вход выполнен'
    resp = make_response(jsonify({'ok': True, 'login': user['login'], 'role': user['role']}))
    resp.set_cookie('sid', sid, httponly=True, samesite='Lax', max_age=SESSION_TTL)
    return resp

@app.route('/api/register', methods=['POST'])
def api_register():
    d = body()
    login = (d.get('login') or d.get('username') or '').strip()
    if len(login) < 3 or find_user(login):
        g.note = 'отказ регистрации: ' + login
        return jsonify({'error': 'Логин занят или слишком короткий'}), 409
    rows = read_csv(USERS_CSV, USER_COLS)
    rows.append({'login': login, 'password_hash': hash_password(d.get('password') or ''),
                 'avatar': DEFAULT_AVATAR, 'role': 'reader'})   # новые всегда читатели
    write_csv(USERS_CSV, USER_COLS, rows)
    set_payload('profile', login, {'displayName': (d.get('display_name') or login),
                                   'username': login, 'joined': datetime.now().strftime('%Y-%m-%d'), 'frames': 0})
    sid = start_session({'login': login, 'role': 'reader'})
    g.user = {'login': login, 'role': 'reader'}
    g.note = 'регистрация нового читателя'
    resp = make_response(jsonify({'ok': True, 'login': login, 'role': 'reader'}))
    resp.set_cookie('sid', sid, httponly=True, samesite='Lax', max_age=SESSION_TTL)
    return resp

@app.route('/api/logout', methods=['POST'])
def api_logout():
    sid = request.cookies.get('sid')
    SESSIONS.pop(sid, None)
    g.note = 'выход'
    resp = make_response(jsonify({'ok': True}))
    resp.delete_cookie('sid')
    return resp

@app.route('/api/me')
def api_me():
    if not g.user:
        return jsonify({'error': 'no session'}), 401
    prof = get_payload('profile', g.user['login'], {})
    user = find_user(g.user['login']) or {}
    sid = request.cookies.get('sid')
    ttl = int(SESSIONS[sid]['expires'] - time.time()) if sid in SESSIONS else SESSION_TTL
    return jsonify({'login': g.user['login'], 'role': g.user['role'],
                    'displayName': prof.get('displayName', g.user['login']),
                    'avatarPath': user.get('avatar', DEFAULT_AVATAR), 'ttl': ttl})

# ---------- данные пользователя ----------
@app.route('/api/state')
def api_state():
    if not g.user:
        return jsonify({'error': 'no session'}), 401
    g.note = 'чтение своих данных'
    return jsonify({'kits': get_payload('kits', g.user['login'], []),
                    'profile': get_payload('profile', g.user['login'], None)})

@app.route('/api/state', methods=['PUT'])
def api_state_put():
    if not g.user:
        return jsonify({'error': 'no session'}), 401
    if g.user['role'] == 'reader':
        g.note = 'читатель пытался изменить данные'
        return jsonify({'error': 'Недостаточно прав'}), 403
    d = request.get_json(silent=True) or {}
    if 'kits' in d:
        set_payload('kits', g.user['login'], d['kits'])
    if 'profile' in d:
        set_payload('profile', g.user['login'], d['profile'])
    g.note = 'сохранение данных'
    return jsonify({'ok': True})

@app.route('/api/avatar', methods=['POST'])
def api_avatar():
    if not g.user:
        return jsonify({'error': 'no session'}), 401
    if g.user['role'] == 'reader':
        g.note = 'читатель пытался загрузить аватар'
        return jsonify({'error': 'Недостаточно прав'}), 403
    f = request.files.get('avatar')
    ext = os.path.splitext(f.filename or '')[1].lower()
    if not f or ext not in ('.png', '.jpg', '.jpeg', '.svg', '.gif'):
        return jsonify({'error': 'Нужна картинка'}), 400
    name = g.user['login'] + ext
    f.save(os.path.join(AVATARS, name))
    rows = read_csv(USERS_CSV, USER_COLS)
    for r in rows:
        if r['login'] == g.user['login']:
            r['avatar'] = 'static/avatars/' + name
    write_csv(USERS_CSV, USER_COLS, rows)
    g.note = 'загружен аватар'
    return jsonify({'ok': True, 'avatar': 'static/avatars/' + name})

# ---------- только админ ----------
def need_admin():
    return g.user and g.user['role'] == 'admin'

@app.route('/api/users')
def api_users():
    if not need_admin():
        g.note = 'отказ: список пользователей'
        return jsonify({'error': 'только админ'}), 403
    return jsonify([{'login': u['login'], 'role': u['role'], 'avatar': u['avatar']}
                    for u in read_csv(USERS_CSV, USER_COLS)])

@app.route('/api/users/<login>/role', methods=['POST'])
def api_user_role(login):
    if not need_admin():
        return jsonify({'error': 'только админ'}), 403
    role = (body().get('role') or '').strip()
    if role not in ('reader', 'admin'):
        return jsonify({'error': 'неизвестная роль'}), 400
    rows = read_csv(USERS_CSV, USER_COLS)
    for r in rows:
        if r['login'] == login:
            r['role'] = role
    write_csv(USERS_CSV, USER_COLS, rows)
    g.note = 'смена роли %s -> %s' % (login, role)
    return jsonify({'ok': True})

@app.route('/api/users/<login>', methods=['DELETE'])
def api_user_del(login):
    if not need_admin():
        return jsonify({'error': 'только админ'}), 403
    if login == g.user['login']:
        return jsonify({'error': 'Себя удалять нельзя'}), 400
    rows = [r for r in read_csv(USERS_CSV, USER_COLS) if r['login'] != login]
    write_csv(USERS_CSV, USER_COLS, rows)
    data = [r for r in read_csv(DATA_CSV, DATA_COLS) if r['owner'] != login]
    write_csv(DATA_CSV, DATA_COLS, data)
    g.note = 'удалён пользователь ' + login
    return jsonify({'ok': True})

@app.route('/api/logs')
def api_logs():
    if not need_admin():
        g.note = 'отказ: просмотр логов'
        return jsonify({'error': 'только админ'}), 403
    return jsonify(read_csv(LOGS_CSV, LOG_COLS)[-300:][::-1])

@app.errorhandler(404)
def not_found(e):
    g.note = '404'
    return redirect('/404.html' if g.user else '/login.html')

if __name__ == '__main__':
    seed()
    app.run(host='127.0.0.1', port=8000)