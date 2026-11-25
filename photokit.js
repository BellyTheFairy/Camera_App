/* Photo Kit 2026 — общий слой: сессия, роли, данные с сервера, звук, тосты, навигация. */
(function () {
  'use strict';
  var K = {};
  var me = null, cache = { kits: [], profile: null }, ready = false, cbs = [];
  var deadline = 0, saveTimer = 0, pingTimer = 0;

  function read(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function uid() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var BODIES = [
    { v: '650|1900|Sony A7 IV', n: 'Sony A7 IV', w: 650, p: 1900 },
    { v: '715|3400|Sony A7S III', n: 'Sony A7S III', w: 715, p: 3400 },
    { v: '650|2200|Canon EOS R6 Mark II', n: 'Canon EOS R6 Mark II', w: 650, p: 2200 },
    { v: '550|1350|Fujifilm X-S20', n: 'Fujifilm X-S20', w: 550, p: 1350 },
    { v: '910|3800|Nikon Z8', n: 'Nikon Z8', w: 910, p: 3800 }
  ];
  var LENSES = [
    { v: '180|250|Фикс 35mm f/1.8', n: 'Фикс 35mm f/1.8', w: 180, p: 250, size: 'small' },
    { v: '280|450|Фикс 50mm f/1.8', n: 'Фикс 50mm f/1.8', w: 280, p: 450, size: 'small' },
    { v: '695|2100|Зум 24-70mm f/2.8', n: 'Зум 24-70mm f/2.8', w: 695, p: 2100, size: 'medium' },
    { v: '1045|2400|Телевик 70-200mm f/2.8', n: 'Телевик 70-200mm f/2.8', w: 1045, p: 2400, size: 'large' },
    { v: '520|950|Кино-фикс 24mm T1.5', n: 'Кино-фикс 24mm T1.5', w: 520, p: 950, size: 'medium' }
  ];
  var PARTS = [
    { id: 'cage', n: 'Клетка (Cage)', w: 120, p: 80 }, { id: 'top-handle', n: 'Верхняя ручка', w: 90, p: 60 },
    { id: 'side-handle', n: 'Боковая рукоятка', w: 110, p: 50 }, { id: 'mattebox', n: 'Компендиум (Matte Box)', w: 350, p: 150 },
    { id: 'led', n: 'Мини RGB LED-свет', w: 150, p: 40 }, { id: 'flash', n: 'Вспышка TTL', w: 400, p: 300 },
    { id: 'monitor', n: 'Монитор 5"', w: 200, p: 250 }, { id: 'vmount', n: 'V-Mount батарея', w: 500, p: 120 }
  ];
  var TAGS = { street: 'СТРИТ', event: 'РЕПОРТАЖ', cinema: 'КИНО', travel: 'ТРЕВЕЛ', vlog: 'ВЛОГ', custom: 'СВОЙ' };

  function compute(kit) {
    var b = null, l = null, i;
    for (i = 0; i < BODIES.length; i++) if (BODIES[i].v === kit.body) b = BODIES[i];
    for (i = 0; i < LENSES.length; i++) if (LENSES[i].v === kit.lens) l = LENSES[i];
    var parts = PARTS.filter(function (p) { return (kit.parts || []).indexOf(p.id) > -1; });
    var weight = (b ? b.w : 0) + (l ? l.w : 0), price = (b ? b.p : 0) + (l ? l.p : 0);
    parts.forEach(function (p) { weight += p.w; price += p.p; });
    return { weight: weight, price: price, parts: parts, bodyName: b ? b.n : 'не выбрана',
             lensName: l ? l.n : 'не выбран', size: l ? l.size : 'small',
             load: weight === 0 ? 'none' : weight <= 1300 ? 'light' : weight <= 2400 ? 'mid' : 'heavy' };
  }
  var fmtW = function (w) { return w >= 1000 ? (w / 1000).toFixed(2) + ' кг' : w + ' г'; };
  var fmtP = function (p) { return p.toLocaleString('ru-RU') + ' $'; };
  var fmtD = function (iso) { try { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }); } catch (e) { return iso; } };

  function defProfile() {
    return {
      displayName: me ? me.displayName : 'Новый фотограф', username: me ? me.login : 'new',
      bio: 'Пока пусто. Как кадр без плёнки.', avatar: '📷', accent: '#ff4fa0', brand: 'Sony',
      joined: new Date().toISOString().slice(0, 10), frames: 0,
      views: [
        { id: 'v-all', name: 'Все', f: { q: '', tag: 'all', fav: false, sort: 'manual', dir: 'desc', maxW: 4000, maxP: 12000 } },
        { id: 'v-light', name: 'Лёгкие', f: { q: '', tag: 'all', fav: false, sort: 'weight', dir: 'asc', maxW: 1400, maxP: 12000 } },
        { id: 'v-rich', name: 'Дорогие', f: { q: '', tag: 'all', fav: false, sort: 'price', dir: 'desc', maxW: 4000, maxP: 12000 } },
        { id: 'v-fav', name: 'Избранные', f: { q: '', tag: 'all', fav: true, sort: 'manual', dir: 'desc', maxW: 4000, maxP: 12000 } }
      ],
      prefs: { sound: true, motion: true, compact: false, view: 'grid' },
      activity: []
    };
  }

  /* ---------- звук ---------- */
  var ctx = null;
  function burst(t, dur, freq, gain) {
    var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0), i;
    for (i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    var s = ctx.createBufferSource(); s.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    var g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t);
  }
  function play(kind) {
    if (!prefs().sound) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      if (kind === 'shutter') { burst(t, .07, 1400, .35); burst(t + .09, .09, 900, .26); }
      else burst(t, .04, 2400, .12);
    } catch (e) {}
  }

  /* ---------- тост ---------- */
  var toastEl = null, toastT = 0;
  function toast(msg, opt) {
    opt = opt || {};
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'pk-toast'; toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '<span>' + esc(msg) + '</span>';
    if (opt.actionLabel && typeof opt.onAction === 'function') {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pk-toast-act'; b.textContent = opt.actionLabel;
      b.addEventListener('click', function () { toastEl.classList.remove('show'); opt.onAction(); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, opt.duration || (opt.actionLabel ? 7000 : 2800));
  }

  /* ---------- запросы к серверу ---------- */
  function expire() {
    toast('⏳ Сессия истекла — входите снова');
    setTimeout(function () { location.href = '/login.html'; }, 900);
  }
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (r.status === 401 && !/\/(login|register)\.html/.test(location.pathname)) { expire(); throw new Error('auth'); }
      if (r.status === 403) { toast('👮 Недостаточно прав для этого действия'); throw new Error('forbidden'); }
      return r;
    });
  }
  function persist() {                       // отложенное сохранение на сервер
    if (!me || me.role === 'reader') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      api('/api/state', { method: 'PUT', body: JSON.stringify({ kits: cache.kits, profile: cache.profile }) })
        .catch(function () {});
    }, 400);
  }

  /* ---------- стили общего слоя ---------- */
  function injectBase() {
    if (document.getElementById('pkBase')) return;
    var st = document.createElement('style');
    st.id = 'pkBase';
    st.textContent = [
      '.nav-user{display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:6px 14px 6px 6px;border-radius:999px;border:2px solid var(--line,rgba(214,33,127,.2));background:rgba(255,255,255,.78);color:var(--berry,#8f1d5c);font:800 12px var(--fb,"Manrope",sans-serif);white-space:nowrap;transition:border-color .2s,transform .18s}',
      '.nav-user:hover{border-color:var(--candy,#ff4fa0);transform:translateY(-1px);background:#fff}',
      '.nav-ava{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:14px;background:linear-gradient(135deg,#ff77b9,#d6217f);box-shadow:inset 0 2px 0 rgba(255,255,255,.45)}',
      '.nav-user.here{border-color:transparent;background:linear-gradient(135deg,var(--candy,#ff4fa0),var(--candy-deep,#d6217f));color:#fff}',
      '.pk-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,18px);z-index:200;display:flex;align-items:center;gap:12px;opacity:0;pointer-events:none;font:700 12.5px var(--fb,"Manrope",sans-serif);color:var(--plum,#4a0e33);background:rgba(255,255,255,.95);border:1px solid var(--line,rgba(214,33,127,.2));padding:11px 16px;border-radius:999px;box-shadow:0 16px 40px rgba(74,14,51,.28);backdrop-filter:blur(12px);transition:opacity .28s,transform .28s;max-width:calc(100vw - 32px)}',
      '.pk-toast.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}',
      '.pk-toast-act{border:none;cursor:pointer;font:800 11px var(--fm,monospace);color:#fff;background:linear-gradient(135deg,#ff77b9,#d6217f);padding:7px 14px;border-radius:999px;white-space:nowrap}',
      '.role-chip{display:inline-flex;align-items:center;gap:6px;font:800 10px var(--fm,monospace);letter-spacing:.12em;color:var(--amber,#ffaa1f);background:rgba(255,170,31,.14);border:1px solid rgba(255,170,31,.5);padding:5px 12px;border-radius:999px;margin-left:8px}',
      /* читатель: прячем всё, что создаёт и меняет */
      'body.role-reader #newKit,body.role-reader #randKit,body.role-reader #addView,body.role-reader #goEdit,',
      'body.role-reader .kit-actions [data-act="edit"],body.role-reader .kit-actions [data-act="dup"],body.role-reader .kit-actions [data-act="del"],',
      'body.role-reader .kit-fav,body.role-reader .kit-check,body.role-reader #bulk,body.role-reader #profileForm,',
      'body.role-reader #importBtn,body.role-reader #wipeBtn,body.role-reader #pkSaveKit,body.role-reader #avatarUpload{display:none!important}',
      '@media (max-width:760px){.nav-uname{display:none}.nav-user{padding:6px}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { return Math.max(0, Math.min(255, Math.round(v + amt))); });
    return '#' + c.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }
  function applyAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
    var r = document.documentElement.style;
    r.setProperty('--candy', hex); r.setProperty('--candy-hot', shade(hex, -18)); r.setProperty('--candy-deep', shade(hex, -46));
  }

  /* ---------- навигация и роль ---------- */
  function injectNav() {
    var nav = document.querySelector('.nav');
    if (!nav || nav.dataset.pkNav) return;
    nav.dataset.pkNav = '1';
    var links = nav.querySelector('.nav-links');
    var onProfile = /profile\.html$/.test(location.pathname);
    var onAdmin = /admin\.html$/.test(location.pathname);
    if (links) {
      if (!links.querySelector('[data-pk-profile]')) {
        var a = document.createElement('a');
        a.href = '/profile.html'; a.textContent = 'Профиль'; a.dataset.pkProfile = '1';
        if (onProfile) a.classList.add('active');
        links.appendChild(a);
      }
      if (me && me.role === 'admin' && !links.querySelector('[data-pk-admin]')) {
        var ad = document.createElement('a');
        ad.href = '/admin.html'; ad.textContent = 'Админ'; ad.dataset.pkAdmin = '1';
        if (onAdmin) ad.classList.add('active');
        links.appendChild(ad);
      }
    }
    if (me) {
      var user = document.createElement('a');
      user.className = 'nav-user' + (onProfile ? ' here' : '');
      user.href = '/profile.html';
      user.innerHTML = '<span class="nav-ava">' + esc(profile().avatar) + '</span><span class="nav-uname">' + esc(profile().displayName) + '</span>';
      var cta = nav.querySelector('.nav-cta');
      if (cta) { nav.insertBefore(user, cta); cta.textContent = 'ВЫЙТИ'; cta.href = '#'; cta.addEventListener('click', function (e) { e.preventDefault(); logout(); }); }
      else nav.appendChild(user);
      if (me.role === 'reader') {
        var chip = document.createElement('span');
        chip.className = 'role-chip'; chip.textContent = '👁 ЧТЕНИЕ';
        nav.appendChild(chip);
      }
    }
    var sb = document.getElementById('soundToggle');
    if (sb) {
      var sync = function () { var on = prefs().sound; sb.textContent = on ? '🔊 ЗВУК' : '🔇 ТИХО'; sb.setAttribute('aria-pressed', String(on)); };
      sync();
      sb.addEventListener('click', function () { setTimeout(function () { setPrefs({ sound: sb.getAttribute('aria-pressed') !== 'false' }); }, 0); });
    }
  }
  function sessionChip() {                    // видимый таймаут сессии
    var hud = document.querySelector('.hud-bottom');
    if (!hud || document.getElementById('pkSession')) return;
    var s = document.createElement('span');
    s.className = 'hud-chip'; s.id = 'pkSession'; s.textContent = '⏳ 5:00';
    hud.appendChild(s);
    setInterval(function () {
      var left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      s.textContent = '⏳ ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      s.style.color = left < 60 ? 'var(--danger,#e5484d)' : '';
      if (left <= 0) expire();
    }, 1000);
    pingTimer = setInterval(function () {     // активность продлевает сессию
      api('/api/me').then(function (r) { return r.json(); }).then(function (m) { deadline = Date.now() + m.ttl * 1000; }).catch(function () {});
    }, 30000);
  }
  function roleGate() {
    if (!me) return;
    document.body.classList.add('role-' + me.role);
    if (me.role !== 'reader') return;
    // читатель может крутить конструктор как калькулятор, но не сохранять и не править профиль
    document.addEventListener('click', function (e) {
      if (e.target.closest('#profileForm, #newKit, #randKit, .kit-fav, #addView, #goEdit, #importBtn, #wipeBtn')) {
        e.preventDefault(); e.stopPropagation();
        toast('👁 Режим чтения: изменения недоступны');
      }
    }, true);
  }

  /* ---------- вход/регистрация форм ---------- */
  function wireAuth() {
    var login = document.getElementById('loginForm');
    var reg = document.getElementById('registerForm');
    var form = login || reg;
    if (!form || form.dataset.pkAuth) return;
    form.dataset.pkAuth = '1';
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;         // кнопка ещё убегает или валидация не прошла
      e.preventDefault();
      var payload = reg
        ? { login: form.querySelector('[name="username"]').value.trim(),
            password: form.querySelector('[name="password"]').value,
            display_name: (form.querySelector('[name="display_name"]') || {}).value || '' }
        : { login: form.querySelector('[name="username"]').value.trim(),
            password: form.querySelector('[name="password"]').value };
      api('/api/' + (reg ? 'register' : 'login'), { method: 'POST', body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { toast(res.d.error || 'Не получилось 😿'); return; }
          play('shutter');
          toast(reg ? 'Аккаунт создан. Добро пожаловать ✨' : 'Фокус пойман. Заходим ✨');
          setTimeout(function () { location.href = '/profile.html'; }, 600);
        }).catch(function () {});
    });
  }

  /* ---------- кнопка сохранения в конструкторе ---------- */
  function wireBuilder() {
    var bodySel = document.getElementById('selectBody');
    var lensSel = document.getElementById('selectLens');
    var actions = document.querySelector('.actions');
    if (!bodySel || !lensSel || !actions || actions.dataset.pkBuilder) return;
    actions.dataset.pkBuilder = '1';
    if (me && me.role !== 'reader') {
      var tiles = Array.prototype.slice.call(document.querySelectorAll('.rig-item'));
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-ghost'; btn.id = 'pkSaveKit'; btn.textContent = '💾 В ПРОФИЛЬ';
      actions.appendChild(btn);
      btn.addEventListener('click', function () {
        if (bodySel.value.split('|')[0] === '0') { toast('Сначала выберите камеру 🙃'); return; }
        var c = compute({ body: bodySel.value, lens: lensSel.value, parts: tiles.filter(function (t) { return t.checked; }).map(function (t) { return t.dataset.part; }) });
        var kit = addKit({ name: c.bodyName + ' • ' + c.lensName, tag: 'custom', body: bodySel.value, lens: lensSel.value,
                           parts: tiles.filter(function (t) { return t.checked; }).map(function (t) { return t.dataset.part; }), fav: false });
        log('💾', 'Кит сохранён: «' + kit.name + '»');
        play('shutter');
        toast('Кит сохранён в профиль 💾', { actionLabel: 'ОТКРЫТЬ', onAction: function () { location.href = '/profile.html'; } });
      });
    }
    var id = new URLSearchParams(location.search).get('kit');
    if (id) {
      onReady(function () {
        var kit = getKit(id);
        if (!kit) return;
        var bi = Array.prototype.findIndex.call(bodySel.options, function (o) { return o.value === kit.body; });
        var li = Array.prototype.findIndex.call(lensSel.options, function (o) { return o.value === kit.lens; });
        if (bi > -1) bodySel.selectedIndex = bi;
        if (li > -1) lensSel.selectedIndex = li;
        Array.prototype.forEach.call(document.querySelectorAll('.rig-item'), function (t) { t.checked = (kit.parts || []).indexOf(t.dataset.part) > -1; });
        bodySel.dispatchEvent(new Event('change', { bubbles: true }));
        toast('Кит «' + kit.name + '» загружен на стенд ✨');
      });
    }
  }

  /* ---------- загрузка ---------- */
  function finishBoot() {
    injectBase();
    if (cache.profile) {
      cache.profile = Object.assign(defProfile(), cache.profile);
      cache.profile.views = cache.profile.views || defProfile().views;
      cache.profile.prefs = Object.assign(defProfile().prefs, cache.profile.prefs || {});
      cache.profile.activity = cache.profile.activity || [];
      applyAccent(cache.profile.accent);
      document.body.classList.toggle('no-motion', cache.profile.prefs.motion === false);
    }
    injectNav(); roleGate(); wireBuilder();
    if (me) sessionChip();
    ready = true;
    cbs.forEach(function (cb) { cb(); });
  }
  function boot() {
    injectBase();
    api('/api/me').then(function (r) { return r.json(); })
      .then(function (m) {
        me = m; deadline = Date.now() + m.ttl * 1000;
        return api('/api/state').then(function (r) { return r.json(); });
      })
      .then(function (st) { cache.kits = st.kits || []; cache.profile = st.profile; finishBoot(); })
      .catch(function () {
        me = null; cache.profile = defProfile();
        if (!/\/(login|register)\.html/.test(location.pathname)) { location.href = '/login.html'; return; }
        finishBoot();
      });
    window.addEventListener('load', wireAuth);
  }
  function onReady(cb) { ready ? cb() : cbs.push(cb); }

  /* ---------- синхронный API поверх кэша ---------- */
  function profile() { return cache.profile || (cache.profile = defProfile()); }
  function saveProfile(patch) { Object.assign(profile(), patch); persist(); return profile(); }
  function kits() { return cache.kits; }
  function saveKits(a) { cache.kits = a; persist(); }
  function getKit(id) { return cache.kits.filter(function (k) { return k.id === id; })[0] || null; }
  function addKit(k) { k.id = k.id || uid(); k.createdAt = k.createdAt || new Date().toISOString(); cache.kits.unshift(k); persist(); return k; }
  function updateKit(id, patch) { cache.kits = cache.kits.map(function (k) { return k.id === id ? Object.assign({}, k, patch) : k; }); persist(); return getKit(id); }
  function removeKits(ids) { var removed = cache.kits.map(function (k, i) { return { kit: k, index: i }; }).filter(function (x) { return ids.indexOf(x.kit.id) > -1; }); cache.kits = cache.kits.filter(function (k) { return ids.indexOf(k.id) < 0; }); persist(); return removed; }
  function restoreKits(items) { items.forEach(function (it) { cache.kits.splice(Math.min(it.index, cache.kits.length), 0, it.kit); }); persist(); }
  function views() { return profile().views; }
  function saveViews(v) { profile().views = v; persist(); }
  function prefs() { return profile().prefs; }
  function setPrefs(patch) { Object.assign(profile().prefs, patch); persist(); return profile().prefs; }
  function activity() { return profile().activity; }
  function log(icon, text) { profile().activity.unshift({ id: uid(), at: new Date().toISOString(), icon: icon, text: text }); profile().activity = profile().activity.slice(0, 40); persist(); }
  function session() { return me ? { username: me.login, displayName: me.displayName, role: me.role, demo: false } : null; }
  function canWrite() { return !!me && me.role !== 'reader'; }
  function logout() {
    api('/api/logout', { method: 'POST' }).catch(function () {});
    play('shutter');
    toast('Сессия закрыта 🚪');
    setTimeout(function () { location.href = '/login.html'; }, 700);
  }
  function uploadAvatar(file) {
    var fd = new FormData(); fd.append('avatar', file);
    return fetch('/api/avatar', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { if (r.status === 403) { toast('👮 Недостаточно прав'); throw new Error('forbidden'); } return r.json(); });
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function copy(text) {
    var ok = function () { toast('Скопировано 📋'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok).catch(function () { toast('Не удалось 😿'); });
    else ok();
  }
  function kitSpec(kit) {
    var c = compute(kit);
    return '📷 ' + kit.name + ' — Photo Kit 2026\n• Камера: ' + c.bodyName + '\n• Объектив: ' + c.lensName + '\n' +
      (c.parts.length ? '• Обвес: ' + c.parts.map(function (p) { return p.n; }).join(', ') + '\n' : '') +
      '⚖️ Масса: ' + fmtW(c.weight) + '\n💰 Бюджет: ' + fmtP(c.price);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.PK = {
    BODIES: BODIES, LENSES: LENSES, PARTS: PARTS, TAGS: TAGS,
    compute: compute, uid: uid, esc: esc, fmtW: fmtW, fmtP: fmtP, fmtD: fmtD,
    onReady: onReady, me: function () { return me; }, session: session, canWrite: canWrite, logout: logout,
    profile: profile, saveProfile: saveProfile,
    kits: kits, saveKits: saveKits, getKit: getKit, addKit: addKit, updateKit: updateKit, removeKits: removeKits, restoreKits: restoreKits,
    views: views, saveViews: saveViews, prefs: prefs, setPrefs: setPrefs, activity: activity, log: log,
    toast: toast, play: play, applyAccent: applyAccent, download: download, copy: copy, kitSpec: kitSpec,
    uploadAvatar: uploadAvatar, api: api
  };
})();