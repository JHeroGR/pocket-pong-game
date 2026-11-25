(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var wrap = $('wrap'), stage = $('stage'), ui = $('ui'), cv = $('cv'), ctx = cv.getContext('2d');
  var cs = getComputedStyle(document.documentElement);
  var FG = cs.getPropertyValue('--fg').trim() || '#ecece6';
  var DIM = cs.getPropertyValue('--dim').trim() || '#8a8a82';
  var BG = cs.getPropertyValue('--bg').trim() || '#070707';
  var PIX = '"Press Start 2P", ui-monospace, monospace';

  /* ---------- constants (abstract play space: x runs paddle to paddle, y runs across) ---------- */
  var LEN = 1000, WALL = 8, PAD_M = 34, PAD_T = 14, PAD_L = 112, BALL = 16, R = 8;
  var P1_FACE = PAD_M + PAD_T, P2_FACE = LEN - PAD_M - PAD_T;
  var BALL_START = 430, SPEED_GAIN = 1.045, MAX_ANGLE = 0.95;   // no top speed: every return speeds the ball up until someone misses (tests/speed.js shows rallies end by about 60 hits)
  var MAX_STEP = 6;   // most the ball may travel between two collision checks (see tick)
  var KEY_SPEED = 720, TOUCH_SPEED = 2800;
  // ball sizes in court units: small, medium (the classic size) and large. BALL is the side length, R half of it.
  var BALL_SIZES = { small: 12, medium: 16, large: 24 };
  function applyBall(name) { BALL = BALL_SIZES[name] || 16; R = BALL / 2; }
  var WID = 560, YMIN = WALL, YMAX = WID - WALL;

  /* ---------- CPU difficulty: every number below changes how the AI plays ----------
     react   ms before it responds after the ball turns toward it, and between re-aims
     speed   top paddle speed in px/s (ball cross-court speed reaches about 700)
     err     std deviation of its aiming error in px, rolled once per incoming ball
     slip    chance of a bigger misjudgement on any incoming ball (lands near the bar's edge or past it)
     predict true: computes where the ball will land, including wall bounces. false: just follows the ball's height
     aim     0 to 1: how hard it tries to hit with the bar's edge, sending the ball away from you
     recenter true: drifts back to mid-field while the ball is travelling away */
  var DIFF = {
    easy:   { react: 360, speed: 300, err: 42, slip: 0.20, predict: false, aim: 0,    recenter: false, desc: 'Slow to react and only follows the ball\'s height.' },
    medium: { react: 210, speed: 470, err: 26, slip: 0.10, predict: true,  aim: 0,    recenter: true,  desc: 'Predicts bounces but makes honest mistakes.' },
    hard:   { react: 120, speed: 640, err: 16, slip: 0.05, predict: true,  aim: 0.45, recenter: true,  desc: 'Quick reactions. Aims shots away from you.' },
    insane: { react: 50,  speed: 800, err: 7,  slip: 0.015, predict: true, aim: 0.9,  recenter: true,  desc: 'Near-instant reactions, a fast bar, pinpoint aim.' }
  };

  /* ---------- settings ---------- */
  var cfg = { mode: 'ai', diff: 'medium', target: 7, ball: 'small', view: 'auto', sound: true, n1: 'PLAYER 1', n2: 'PLAYER 2' };
  try { var saved = JSON.parse(localStorage.getItem('pocket-pong') || 'null'); if (saved && typeof saved === 'object') { if (saved.v !== 2) delete saved.ball; Object.assign(cfg, saved); } } catch (e) {}   // v2: the default ball became small, so earlier saved sizes are dropped once
  cfg.v = 2;
  // Online play is switched off for now: the code stays, but the Online button is not added and a saved 'online' choice falls back to 1 Player.
  // To bring it back, set ONLINE_ENABLED to true (tests set window.__PP_ONLINE = true before the page loads).
  var ONLINE_ENABLED = window.__PP_ONLINE === true;
  if (['ai', '2p'].concat(ONLINE_ENABLED ? ['online'] : []).indexOf(cfg.mode) < 0) cfg.mode = 'ai';
  if (!DIFF[cfg.diff]) cfg.diff = 'medium';
  cfg.target = +cfg.target; if ([3, 5, 7, 11].indexOf(cfg.target) < 0) cfg.target = 7;
  if (['auto', 'land', 'port'].indexOf(cfg.view) < 0) cfg.view = 'auto';
  if (['small', 'medium', 'large'].indexOf(cfg.ball) < 0) cfg.ball = 'medium';
  cfg.sound = cfg.sound !== false;
  cfg.n1 = String(cfg.n1 == null ? '' : cfg.n1).slice(0, 8);
  cfg.n2 = String(cfg.n2 == null ? '' : cfg.n2).slice(0, 8);
  function save() { try { localStorage.setItem('pocket-pong', JSON.stringify(cfg)); } catch (e) {} }

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function gauss() { var u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  /* ---------- game state ---------- */
  var scene = 'menu';      // menu (demo runs behind it) | game | paused | over
  var phase = 'serve';     // serve | play
  var now = 0;             // game clock in ms, drives the AI
  var p = [{ y: WID / 2, score: 0, name: '' }, { y: WID / 2, score: 0, name: '' }];
  var ball = { x: LEN / 2, y: WID / 2, vx: 0, vy: 0, sp: BALL_START };
  var serveT = 0, serveDir = 1;
  var ctrl = ['ai', 'ai'];
  var ai = [
    { cfg: DIFF.hard, next: 0, target: WID / 2, bias: 0, inc: false },
    { cfg: DIFF.hard, next: 0, target: WID / 2, bias: 0, inc: false }
  ];
  var stats = { hits: 0, rally: 0, best: 0, top: BALL_START, time: 0 };
  var series = [0, 0], seriesKey = '';
  var touchT = [null, null], ptrSide = new Map(), down = {};

  /* online state (the online play section further down uses it) */
  var net = { role: null, room: null, code: '', token: 0, ok: false, seen: 0, peerId: null, me: null, waitUntil: 0,
    last: null, lht: null, lwb: null, lss: null, tg: 7, pz: 0, rq: 0, hostPz: 0, hostRq: 0, remoteY: null, rn: '',
    y0t: 0, lastSend: 0, sentY: null };
  var lobbyOpen = false, lobbyStep = 'choose', lobbyMsg = '', roomState = 'unknown', roomP = null, wallHits = 0;
  function cleanName(s) { return String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '').toUpperCase().trim().slice(0, 8); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function rd(v) { return Math.round(v * 10) / 10; }

  function setField(w) {
    WID = w; YMIN = WALL; YMAX = WID - WALL;
    for (var i = 0; i < 2; i++) p[i].y = clamp(p[i].y, YMIN + PAD_L / 2, YMAX - PAD_L / 2);
    for (var j = 0; j < 2; j++) ai[j].target = clamp(ai[j].target, YMIN, YMAX);
  }
  // path the ball took over the last TRAIL_T seconds, one point per physics step. The game draws it as a fading streak so a fast ball
  // looks like it moves smoothly instead of jumping from place to place between two screen frames.
  var trail = [], simT = 0, TRAIL_T = 0.055;
  function centerBall(dir, delay) {
    trail.length = 0;
    ball.x = LEN / 2; ball.y = WID / 2; ball.vx = 0; ball.vy = 0; ball.sp = BALL_START;
    serveDir = dir; serveT = delay; phase = 'serve';
  }
  function launch() {
    var a = (Math.random() * 2 - 1) * 0.45;
    ball.vx = serveDir * ball.sp * Math.cos(a);
    ball.vy = ball.sp * Math.sin(a);
  }
  function resetAI() { for (var i = 0; i < 2; i++) { ai[i].next = 0; ai[i].bias = 0; ai[i].inc = false; ai[i].target = WID / 2; } }

  function startDemo() {
    scene = 'menu'; ctrl = ['ai', 'ai']; applyBall(cfg.ball);
    ai[0].cfg = DIFF.hard; ai[1].cfg = DIFF.hard; resetAI();
    p[0].score = 0; p[1].score = 0; p[0].y = WID / 2; p[1].y = WID / 2;
    stats.rally = 0;
    centerBall(Math.random() < 0.5 ? 1 : -1, 0.6);
    setScreens();
  }
  function startMatch() {
    scene = 'game'; lobbyOpen = false; applyBall(cfg.ball);
    var online = net.role === 'host';
    if (online) { setField(560); layout(); }   // both phones use the same court size online
    ctrl = online ? ['human', 'remote'] : (cfg.mode === 'ai' ? ['human', 'ai'] : ['human', 'human']);
    ai[0].cfg = DIFF[cfg.diff]; ai[1].cfg = DIFF[cfg.diff]; resetAI();
    p[0].name = online ? hostName() : (cfg.n1 || 'PLAYER 1').toUpperCase().slice(0, 8);
    p[1].name = online ? (net.rn || 'FRIEND') : (cfg.mode === 'ai' ? 'CPU' : (cfg.n2 || 'PLAYER 2').toUpperCase().slice(0, 8));
    var key = (online ? 'online' : cfg.mode) + '|' + cfg.diff + '|' + p[0].name + '|' + p[1].name;
    if (key !== seriesKey) { series = [0, 0]; seriesKey = key; }
    p[0].score = 0; p[1].score = 0; p[0].y = WID / 2; p[1].y = WID / 2;
    stats.hits = 0; stats.rally = 0; stats.best = 0; stats.top = BALL_START; stats.time = 0;
    touchT = [null, null]; ptrSide.clear(); down = {};
    centerBall(Math.random() < 0.5 ? 1 : -1, 1.0);
    setScreens();
  }
  function endMatch(w) {
    scene = 'over'; series[w]++;
    fillOver(w);
    try { if (navigator.vibrate) navigator.vibrate([30, 40, 60]); } catch (e) {}
    setScreens();
  }
  function fillOver(w) {
    $('ovTitle').textContent = p[w].name + ' WINS';
    $('fn1').textContent = p[0].name; $('fn2').textContent = p[1].name;
    $('fs1').textContent = p[0].score; $('fs2').textContent = p[1].score;
    $('stRally').textContent = stats.best;
    $('stHits').textContent = stats.hits;
    $('stSpeed').textContent = (stats.top / BALL_START).toFixed(1) + 'x';
    $('stTime').textContent = fmtTime(stats.time);
    $('ovSeries').textContent = 'Series ' + p[0].name + ' ' + series[0] + ' - ' + series[1] + ' ' + p[1].name;
  }
  function pause() {
    if (net.role === 'guest') { if (scene === 'game') netToggle(); return; }   // the host owns the clock: ask it to pause
    if (scene !== 'game') return;
    scene = 'paused'; touchT = [null, null]; ptrSide.clear(); down = {};
    setScreens();
  }
  function resume() {
    if (net.role === 'guest') { if (scene === 'paused') netToggle(); return; }
    if (scene === 'paused') { scene = 'game'; setScreens(); }
  }
  function toMenu() { if (net.role) leaveOnline(); lobbyOpen = false; startDemo(); }

  function setScreens() {
    ui.classList.toggle('on', scene !== 'game');
    stage.classList.toggle('playing', scene === 'game');
    $('menuScr').hidden = !(scene === 'menu' && !lobbyOpen);
    $('lobbyScr').hidden = !(scene === 'menu' && lobbyOpen);
    $('pauseScr').hidden = scene !== 'paused';
    $('overScr').hidden = scene !== 'over';
    $('pauseBtn').hidden = scene !== 'game';
    $('restartBtn').hidden = net.role === 'guest';
    $('pauseMenuBtn').textContent = net.role ? 'Leave' : 'Menu';
    $('overMenuBtn').textContent = net.role ? 'Leave' : 'Menu';
  }

  /* ---------- sound (classic square-wave blips) ---------- */
  var AC = null, unlocked = false, keepAlive = null;
  function silentWavUri() {
    var n = 800, b = new Uint8Array(44 + n), dv = new DataView(b.buffer), i, str = '';
    function s(o, t) { for (var k = 0; k < t.length; k++) b[o + k] = t.charCodeAt(k); }
    s(0, 'RIFF'); dv.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true);
    dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); s(36, 'data'); dv.setUint32(40, n, true);
    for (i = 44; i < 44 + n; i++) b[i] = 128;
    for (i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
    return 'data:audio/wav;base64,' + btoa(str);
  }
  function ensureAudio() {
    if (!cfg.sound) return;
    try {
      // iOS mutes Web Audio while the ringer switch is on silent unless the page asks for playback audio
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    try {
      if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); }
      if (AC && AC.state !== 'running') { var rp = AC.resume(); if (rp && rp.catch) rp.catch(function () {}); }
      if (AC && !unlocked) {   // play one silent sample inside the gesture so the browser opens the audio output
        var ub = AC.createBuffer(1, 1, 22050), us = AC.createBufferSource();
        us.buffer = ub; us.connect(AC.destination); us.start(0); unlocked = true;
      }
      if (!keepAlive) {        // a silent looping media element keeps iPhones from muting Web Audio on the silent switch
        keepAlive = new Audio(silentWavUri()); keepAlive.loop = true;
        var kp = keepAlive.play(); if (kp && kp.catch) kp.catch(function () { keepAlive = null; });
      }
    } catch (e) {}
  }
  // Off means silence everywhere: nothing is scheduled, the audio engine is suspended and the keep-alive loop is stopped.
  function stopAudio() {
    try { if (keepAlive) { keepAlive.pause(); keepAlive = null; } } catch (e) {}
    try { if (AC && AC.state === 'running') { var sp = AC.suspend(); if (sp && sp.catch) sp.catch(function () {}); } } catch (e) {}
  }
  function tone(f, d, vol) {
    if (!cfg.sound || !AC) return;
    var go = function () {
      if (!cfg.sound) return;   // switched off while the engine was waking up
      try {
        var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + 0.005;
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
      } catch (e) {}
    };
    if (AC.state === 'running') go();
    else { var rp = AC.resume(); if (rp && rp.then) rp.then(go, function () {}); else go(); }
  }
  function beep(f, d) { if (scene === 'game') tone(f, d, 0.28); }   // gameplay sounds
  // Menu sounds: switching Sound on plays one bright ding, every other control plays a different, lower tick.
  var lastUi = 0;
  function uiSound(kind) {
    if (!cfg.sound) return;
    var t = performance.now();
    if (t - lastUi < 60) return;   // one tap, one sound
    lastUi = t;
    if (kind === 'on') tone(1175, 0.14, 0.26); else tone(587, 0.05, 0.2);
  }

  /* ---------- AI ---------- */
  function predictY(faceX) {
    var t = (faceX - ball.x) / ball.vx;
    if (!(t >= 0)) return ball.y;
    var lo = YMIN + R, hi = YMAX - R, span = hi - lo;
    var y = ball.y + ball.vy * t - lo;
    var m = ((y % (2 * span)) + 2 * span) % (2 * span);
    return lo + (m > span ? 2 * span - m : m);
  }
  function aiThink(i) {
    var a = ai[i], c = a.cfg;
    var inc = phase === 'play' && (i === 0 ? ball.vx < 0 : ball.vx > 0);
    if (inc && !a.inc) {
      // ball just turned toward this paddle: size up the shot once, then react after a delay
      a.bias = gauss() * c.err;
      if (Math.random() < c.slip) a.bias += (Math.random() < 0.5 ? -1 : 1) * (PAD_L * 0.55 + Math.random() * PAD_L * 0.45);
      a.next = now + c.react;
    }
    a.inc = inc;
    if (now < a.next) return;
    a.next = now + c.react * (0.8 + Math.random() * 0.4);
    if (!inc) { if (c.recenter) a.target = WID / 2; return; }
    var faceX = i === 0 ? P1_FACE + R : P2_FACE - R;
    var ty = (c.predict ? predictY(faceX) : ball.y) + a.bias;
    if (c.aim > 0) {
      var opp = p[1 - i].y;
      ty -= (opp < WID / 2 ? 1 : -1) * c.aim * PAD_L * 0.4; // hit with the bar's edge, away from the opponent
    }
    a.target = ty;
  }

  /* ---------- simulation ---------- */
  function keyDir(i) {
    var up, dn;
    if (i === 0) {
      up = down.w || down.a || (cfg.mode !== '2p' && (down.arrowup || down.arrowleft));
      dn = down.s || down.d || (cfg.mode !== '2p' && (down.arrowdown || down.arrowright));
    } else {
      up = down.arrowup || down.arrowleft || (net.role === 'guest' && (down.w || down.a));
      dn = down.arrowdown || down.arrowright || (net.role === 'guest' && (down.s || down.d));
    }
    return (dn ? 1 : 0) - (up ? 1 : 0);
  }
  function movePaddle(i, dt) {
    var pd = p[i], lo = YMIN + PAD_L / 2, hi = YMAX - PAD_L / 2, tgt, m, d;
    if (ctrl[i] === 'ai') {
      aiThink(i);
      tgt = clamp(ai[i].target, lo, hi); m = ai[i].cfg.speed * dt; d = tgt - pd.y;
      pd.y += Math.abs(d) <= m ? d : (d < 0 ? -m : m);
    } else if (ctrl[i] === 'remote') {          // online: follow the friend's paddle position
      tgt = clamp(net.remoteY == null ? pd.y : net.remoteY, lo, hi); m = TOUCH_SPEED * dt; d = tgt - pd.y;
      pd.y += Math.abs(d) <= m ? d : (d < 0 ? -m : m);
    } else {
      var kd = keyDir(i);
      if (kd) { pd.y += kd * KEY_SPEED * dt; touchT[i] = null; }
      else if (touchT[i] !== null) {
        tgt = clamp(touchT[i], lo, hi); m = TOUCH_SPEED * dt; d = tgt - pd.y;
        pd.y += Math.abs(d) <= m ? d : (d < 0 ? -m : m);
      }
    }
    pd.y = clamp(pd.y, lo, hi);
  }
  function hit(i) {
    var dir = i === 0 ? 1 : -1;
    var rel = clamp((ball.y - p[i].y) / (PAD_L / 2 + R), -1, 1);
    var ang = rel * MAX_ANGLE;
    ball.sp = ball.sp * SPEED_GAIN + 6;
    ball.vx = dir * ball.sp * Math.cos(ang);
    ball.vy = ball.sp * Math.sin(ang);
    ball.x = i === 0 ? P1_FACE + R : P2_FACE - R;
    stats.hits++; stats.rally++;
    if (stats.rally > stats.best) stats.best = stats.rally;
    if (ball.sp > stats.top) stats.top = ball.sp;
    beep(880, 0.07);
  }
  function point(i) {
    if (scene === 'game') {
      p[i].score++;
      beep(330, 0.4);
      try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) {}
      if (p[i].score >= cfg.target) { stats.rally = 0; endMatch(i); return; }
    }
    stats.rally = 0;
    centerBall(i === 0 ? 1 : -1, scene === 'game' ? 1.0 : 0.6); // serve toward the player who just lost the point
  }
  function stepBall(h) {
    ball.x += ball.vx * h; ball.y += ball.vy * h;
    simT += h; trail.push({ x: ball.x, y: ball.y, t: simT }); if (trail.length > 400) trail.shift();
    if (ball.y - R < YMIN) { ball.y = YMIN + R; ball.vy = Math.abs(ball.vy); wallHits++; beep(520, 0.05); }
    else if (ball.y + R > YMAX) { ball.y = YMAX - R; ball.vy = -Math.abs(ball.vy); wallHits++; beep(520, 0.05); }
    if (ball.vx < 0 && ball.x - R <= P1_FACE && ball.x + R >= PAD_M && Math.abs(ball.y - p[0].y) <= PAD_L / 2 + R) hit(0);
    else if (ball.vx > 0 && ball.x + R >= P2_FACE && ball.x - R <= LEN - PAD_M && Math.abs(ball.y - p[1].y) <= PAD_L / 2 + R) hit(1);
    if (ball.x < -2 * R) point(1);
    else if (ball.x > LEN + 2 * R) point(0);
  }
  function tick(dt) {
    if (net.role === 'guest' && scene === 'game') { guestTick(dt); return; }   // the guest only draws what the host sends
    if (scene !== 'menu' && scene !== 'game') return;
    now += dt * 1000;
    if (scene === 'game') stats.time += dt;
    if (phase === 'serve') { serveT -= dt; if (serveT <= 0) { launch(); phase = 'play'; } }
    movePaddle(0, dt); movePaddle(1, dt);
    if (phase === 'play') {
      // swept in small steps so a fast ball can never jump over a bar or wall between two checks: never more than MAX_STEP units per step
      // (the smallest bar window is 26 units deep), and never more than 8 ms per step, even after a 50 ms frame hitch.
      var n = Math.max(1, Math.ceil(dt / 0.008), Math.ceil(ball.sp * dt / MAX_STEP)), h = dt / n;
      for (var k = 0; k < n && phase === 'play' && (scene === 'game' || scene === 'menu'); k++) stepBall(h);
    }
  }

  /* ---------- layout: portrait / landscape, with optional forced rotation ---------- */
  var view = 'land', rot = false, sw = 800, sh = 400, scale = 1, offX = 0, offY = 0, viewW = LEN, viewH = WID, dpr = 1;
  var deskMQ = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)');
  var pb = $('pauseBtn');
  function layout() {
    var ww = wrap.clientWidth, wh = wrap.clientHeight;
    if (!ww || !wh) return;
    var devLand = ww >= wh;
    var wasLand = ui.classList.contains('land');
    if (wasLand !== devLand) {      // the phone was turned: start every menu from its top so nothing is left scrolled and stretched
      [].forEach.call(ui.querySelectorAll('.opts,.panel'), function (e) { e.scrollTop = 0; });
    }
    ui.classList.toggle('land', devLand); ui.classList.toggle('port', !devLand);
    if (wasLand !== devLand) {   // some phone browsers keep the old row heights of the menu after a turn: force them to be worked out again
      [].forEach.call(ui.querySelectorAll('.opts'), function (e) { e.style.display = 'none'; void e.offsetHeight; e.style.display = ''; });
    }   // menus follow how the phone is held; only the game follows the chosen view
    var desk = deskMQ.matches;
    document.documentElement.classList.toggle('desk', desk);
    $('subCtl').textContent = desk ? 'Move the mouse or use the keys to slide your bar' : 'Drag a finger to slide your bar';
    var nv = (cfg.view === 'auto' || desk) ? (devLand ? 'land' : 'port') : cfg.view;   // a computer window never turns, so it always follows its own shape
    if (nv !== view && scene === 'game') pause();
    view = nv;
    rot = (view === 'land') !== devLand;           // chosen view differs from how the phone is held: turn the stage 90deg
    sw = rot ? wh : ww; sh = rot ? ww : wh;
    stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
    stage.style.left = ((ww - sw) / 2) + 'px'; stage.style.top = ((wh - sh) / 2) + 'px';
    stage.style.transform = rot ? 'rotate(90deg)' : 'none';
    stage.classList.remove('land', 'port'); stage.classList.add(view, 'ready');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.round(sw * dpr), ch = Math.round(sh * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    var aspect = Math.max(sw, sh) / Math.min(sw, sh);
    var fw = clamp(Math.round(LEN / aspect), 440, 720);
    if (scene === 'menu' && fw !== WID) { setField(fw); centerBall(serveDir, 0.6); }
    viewW = view === 'land' ? LEN : WID; viewH = view === 'land' ? WID : LEN;
    scale = Math.min(sw / viewW, sh / viewH);
    offX = (sw - viewW * scale) / 2; offY = (sh - viewH * scale) / 2;
    // pause button: on the scoreboard's row, centred between the two scores (same spot in both views, mirrored online too)
    var pp = S(LEN / 2, 96);
    pb.style.left = Math.round(offX + pp[0] * scale - 22) + 'px'; pb.style.top = Math.round(offY + pp[1] * scale - 22) + 'px';
  }

  /* ---------- drawing ---------- */
  var DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
             '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  // the online guest sees the court mirrored, so its own bar is on the left (horizontal) or at the bottom (vertical)
  function S(ax, ay) { if (net.role === 'guest') ax = LEN - ax; return view === 'land' ? [ax, ay] : [ay, LEN - ax]; }
  function rectA(ax, ay, aw, ah) {
    if (net.role === 'guest') ax = LEN - ax - aw;
    if (view === 'land') ctx.fillRect(ax, ay, aw, ah); else ctx.fillRect(ay, LEN - ax - aw, ah, aw);
  }
  function drawNum(n, cx, cy, u) {
    var s = String(n), w = (s.length * 3 + (s.length - 1)) * u, x = cx - w / 2, y = cy - 2.5 * u;
    for (var k = 0; k < s.length; k++) {
      var g = DIG[+s.charAt(k)];
      for (var r = 0; r < 5; r++) for (var c = 0; c < 3; c++) if (g.charAt(r * 3 + c) === '1') ctx.fillRect(x + c * u, y + r * u, u, u);
      x += 4 * u;
    }
  }
  function drawScoreboard() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var i = 0; i < 2; i++) {
      var pt = S(LEN / 2 + (i ? 1 : -1) * 130, 96), sx = pt[0], sy = pt[1];
      if (view === 'port') sy -= 23;   // each score block hangs down from its digits (name + pips): lift both so the pause button sits exactly midway between them
      ctx.fillStyle = FG; drawNum(p[i].score, sx, sy, 12);
      ctx.font = '14px ' + PIX; ctx.globalAlpha = 0.85; ctx.fillText(p[i].name, sx, sy + 44); ctx.globalAlpha = 1;
      var n = curTarget(), w = n * 12 - 4;
      ctx.strokeStyle = FG; ctx.lineWidth = 2;
      for (var k = 0; k < n; k++) {
        var px = sx - w / 2 + k * 12, py = sy + 68;
        if (k < p[i].score) ctx.fillRect(px, py, 8, 8); else ctx.strokeRect(px + 1, py + 1, 6, 6);
      }
    }
    if (scene !== 'menu' && stats.rally >= 4) {
      ctx.font = '14px ' + PIX; ctx.fillStyle = DIM; ctx.textBaseline = 'top';
      if (view === 'land') { ctx.textAlign = 'center'; ctx.fillText('RALLY ' + stats.rally, viewW / 2, viewH - 36); }
      else { ctx.textAlign = 'right'; ctx.fillText('RALLY ' + stats.rally, viewW - 20, viewH / 2 + 40); }
    }
  }
  function drawTrail() {
    while (trail.length && trail[0].t < simT - TRAIL_T) trail.shift();
    var k = clamp((ball.sp - 450) / 500, 0, 1);            // slow ball: classic look, no streak. fast ball: full streak
    if (k <= 0 || trail.length < 2) return;
    var n = trail.length, prevA = ctx.globalAlpha;
    for (var i = 0; i < n - 1; i++) {
      ctx.globalAlpha = 0.32 * k * (i + 1) / n;
      rectA(trail[i].x - R, trail[i].y - R, BALL, BALL);
    }
    ctx.globalAlpha = prevA;
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    ctx.fillStyle = FG;
    rectA(0, 0, LEN, WALL); rectA(0, WID - WALL, LEN, WALL);
    for (var y = WALL + 8; y < WID - WALL - 8; y += 28) rectA(LEN / 2 - 3, y, 6, 14);
    rectA(PAD_M, p[0].y - PAD_L / 2, PAD_T, PAD_L);
    rectA(LEN - PAD_M - PAD_T, p[1].y - PAD_L / 2, PAD_T, PAD_L);
    if (phase === 'play' || Math.floor(serveT * 6) % 2 === 0) {
      if (phase === 'play') drawTrail();
      rectA(ball.x - R, ball.y - R, BALL, BALL);
    }
    if (scene !== 'menu') drawScoreboard();
  }

  /* ---------- input ---------- */
  function toField(e) {
    var r = wrap.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), lx, ly;
    if (rot) { lx = dy; ly = -dx; } else { lx = dx; ly = dy; }
    lx += sw / 2; ly += sh / 2;
    var fx = (lx - offX) / scale, fy = (ly - offY) / scale;
    var g = view === 'land' ? { ax: fx, ay: fy } : { ax: LEN - fy, ay: fx };
    if (net.role === 'guest') g.ax = LEN - g.ax;
    return g;
  }
  function sideFor(g) {
    if (net.role) return net.role === 'guest' ? 1 : 0;   // online: each phone steers only its own bar
    return cfg.mode === 'ai' ? 0 : (g.ax < LEN / 2 ? 0 : 1);
  }
  cv.addEventListener('pointerdown', function (e) {
    if (scene !== 'game') return;
    e.preventDefault(); ensureAudio();
    var g = toField(e), side = sideFor(g);
    ptrSide.set(e.pointerId, side); touchT[side] = g.ay;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointermove', function (e) {
    if (scene !== 'game') return;
    var s = ptrSide.get(e.pointerId);
    if (s !== undefined) { touchT[s] = toField(e).ay; return; }
    if (e.pointerType === 'mouse') {           // desktop: moving the mouse steers
      var g = toField(e), side = sideFor(g);
      touchT[side] = g.ay;
    }
  });
  function release(e) {
    var s = ptrSide.get(e.pointerId);
    if (s === undefined) return;
    ptrSide.delete(e.pointerId); touchT[s] = null;
  }
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  cv.addEventListener('lostpointercapture', release);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (deskMQ.matches && !e.ctrlKey && !e.metaKey && !e.altKey) {          // computer-only hotkeys
      if (k === 'f') { toggleFs(); return; }
      if (k === 'm') { cfg.sound = !cfg.sound; save(); refreshUI(); if (cfg.sound) { ensureAudio(); uiSound('on'); } else stopAudio(); return; }
      var onBtn = e.target && e.target.tagName === 'BUTTON';
      if ((k === 'enter' || (k === ' ' && scene !== 'game')) && !onBtn) {
        if (scene === 'menu' && !lobbyOpen) { e.preventDefault(); $('playBtn').click(); return; }
        if (scene === 'paused') { e.preventDefault(); resume(); return; }
        if (scene === 'over') { e.preventDefault(); $('rematchBtn').click(); return; }
      }
    }
    if (k === 'escape' || k === 'p') { if (scene === 'game') pause(); else if (scene === 'paused') resume(); return; }
    if (scene === 'game') {
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
      down[k] = true; ensureAudio();
    }
  });
  document.addEventListener('keyup', function (e) { down[e.key.toLowerCase()] = false; });
  function toggleFs() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    } catch (err) {}
  }
  $('fsBtn').addEventListener('click', toggleFs);
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  /* ---------- menu wiring ---------- */
  function curVal(k) { return k === 'sound' ? (cfg.sound ? 'on' : 'off') : k === 'crt' ? (cfg.crt !== false ? 'on' : 'off') : String(cfg[k]); }
  function refreshUI() {
    var segs = document.querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) {
      var on = curVal(segs[i].dataset.key) === segs[i].dataset.val;
      segs[i].classList.toggle('on', on); segs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    document.documentElement.classList.toggle('crt', cfg.crt !== false);
    $('grpDiff').hidden = cfg.mode !== 'ai'; $('grpN2').hidden = cfg.mode !== '2p';
    $('labN1').textContent = cfg.mode === '2p' ? 'Player 1 name' : 'Your name';
    $('playBtn').textContent = cfg.mode === 'online' ? 'Play online' : 'Play';
    $('diffDesc').textContent = DIFF[cfg.diff].desc;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.seg') : null;
    if (!b) return;
    var k = b.dataset.key, v = b.dataset.val;
    if (k === 'target') v = +v; else if (k === 'sound' || k === 'crt') v = v === 'on';
    if (e.detail && b.blur) b.blur();   // after a mouse click, keep the keyboard free for the hotkeys (Enter = play)
    cfg[k] = v; save(); refreshUI();
    if (k === 'view') layout();
    if (k === 'ball') applyBall(v);   // the demo ball behind the menu changes right away
    if (k === 'sound') { if (cfg.sound) { ensureAudio(); uiSound('on'); } else stopAudio(); }
    else uiSound('tap');
  });
  document.addEventListener('click', function (e) {     // the big buttons (Play, Resume, Menu and so on) tick too
    var b = e.target.closest ? e.target.closest('button.btn, button.pause') : null;
    if (b) { ensureAudio(); uiSound('tap'); }
  });
  $('n1').value = cfg.n1; $('n2').value = cfg.n2;
  $('n1').addEventListener('input', function () { cfg.n1 = this.value.toUpperCase().slice(0, 8); save(); });
  $('n2').addEventListener('input', function () { cfg.n2 = this.value.toUpperCase().slice(0, 8); save(); });
  $('playBtn').addEventListener('click', function () { if (cfg.mode === 'online') { openLobby(); return; } setField(clamp(Math.round(LEN / (Math.max(sw, sh) / Math.min(sw, sh))), 440, 720)); layout(); startMatch(); });
  $('pauseBtn').addEventListener('click', pause);
  $('resumeBtn').addEventListener('click', resume);
  $('restartBtn').addEventListener('click', startMatch);
  $('pauseMenuBtn').addEventListener('click', toMenu);
  $('rematchBtn').addEventListener('click', function () {
    if (net.role === 'guest') { net.rq = (net.rq + 1) % 1000000; np({ rq: net.rq }); } else startMatch();
  });
  $('overMenuBtn').addEventListener('click', toMenu);
  $('lbHost').addEventListener('click', hostGame);
  $('lbJoin').addEventListener('click', function () {
    lobbyStep = 'join'; lobbyMsg = roomState === 'none' ? NO_ROOM : ''; renderLobby();
    setTimeout(function () { try { $('codeIn').focus(); } catch (e) {} }, 0);
  });
  $('lbGo').addEventListener('click', function () { joinGame($('codeIn').value); });
  $('codeIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinGame(this.value); });
  $('lbStart').addEventListener('click', function () { if (net.role === 'host' && net.ok) startMatch(); });
  $('lbBack').addEventListener('click', function () {
    if (lobbyStep === 'choose' && !net.role) { lobbyOpen = false; setScreens(); return; }
    leaveOnline(); lobbyStep = 'choose'; lobbyMsg = ''; renderLobby();
  });

  /* ---------- online play ----------
     Two phones join one named room. The host runs the whole game and shares ball, paddles and score about 30 times a second.
     The guest sends only its own paddle position plus pause and rematch requests, and sees the court mirrored so its bar
     is on its own side. Everything travels as presence fields, so no event topics need to be opened to guests. */
  var NO_ROOM = 'Online play is not available here. Both players need to be signed in with this page shared with them.';
  function getRoomNs() {
    if (!roomP) {
      var u = null;
      try { u = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('room') : null; } catch (e) { u = null; }
      roomP = Promise.resolve(u).then(function (r) { return r || null; }, function () { return null; });
    }
    return roomP;
  }
  function np(patch) {
    if (!net.room) return;
    try { var r = net.room.presence(patch); if (r && r.catch) r.catch(function () {}); } catch (e) {}
  }
  function leaveRoom(room) { try { var r = room.leave(); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
  function netToggle() { net.pz = (net.pz + 1) % 1000000; np({ pz: net.pz }); }
  function makeCode() {
    var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '', i;
    for (i = 0; i < 4; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  function hostName() { return cleanName(cfg.n1) || 'HOST'; }
  function guestName() { return cleanName(cfg.n1) || 'FRIEND'; }
  function curTarget() { return net.role === 'guest' ? net.tg : cfg.target; }

  function renderLobby() {
    var host = net.role === 'host';
    $('lbMsg').textContent = lobbyMsg;
    $('lbChoose').hidden = lobbyStep !== 'choose';
    $('lbHostBox').hidden = lobbyStep !== 'host';
    $('lbJoinBox').hidden = lobbyStep !== 'join' || net.role === 'guest';
    $('lbCode').textContent = host && net.code ? net.code : '----';
    $('lbStart').hidden = !(host && net.ok && lobbyStep === 'host');
    $('lbHost').disabled = roomState === 'none'; $('lbJoin').disabled = roomState === 'none';
  }
  function openLobby() {
    lobbyOpen = true; lobbyStep = 'choose'; lobbyMsg = roomState === 'none' ? NO_ROOM : '';
    setScreens(); renderLobby();
    if (roomState === 'unknown') getRoomNs().then(function (ns) {
      roomState = ns ? 'ok' : 'none';
      if (!ns && lobbyOpen && lobbyStep === 'choose' && !net.role) lobbyMsg = NO_ROOM;
      renderLobby();
    });
  }
  function leaveOnline() {
    net.token++;
    var r = net.room;
    net.room = null; net.role = null; net.ok = false; net.code = ''; net.peerId = null; net.me = null; net.waitUntil = 0;
    net.last = null; net.lht = null; net.lwb = null; net.lss = null; net.remoteY = null; net.rn = '';
    net.pz = 0; net.rq = 0; net.hostPz = 0; net.hostRq = 0; net.sentY = null; net.lastSend = 0;
    if (r) leaveRoom(r);
  }
  function onlineFail(msg, step) {
    leaveOnline();
    if (scene !== 'menu') startDemo();
    lobbyOpen = true; lobbyStep = step || 'choose'; lobbyMsg = msg;
    setScreens(); renderLobby();
  }

  function hostGame() {
    leaveOnline();
    var token = net.token;
    lobbyStep = 'host'; lobbyMsg = 'Setting up your game...'; renderLobby();
    getRoomNs().then(function (ns) {
      if (token !== net.token) return;
      if (!ns) { roomState = 'none'; onlineFail(NO_ROOM); return; }
      var tries = 0;
      (function attempt() {
        var code = makeCode();
        ns.join('pong-' + code.toLowerCase()).then(function (room) {
          if (token !== net.token) { leaveRoom(room); return; }
          setTimeout(function () {   // give the room a moment to show who is already in it
            if (token !== net.token) { leaveRoom(room); return; }
            var taken = room.peers().some(function (q) { return !q.isMe && q.presence && q.presence.role === 'host'; });
            if (taken) {
              leaveRoom(room);
              if (tries++ < 4) attempt(); else onlineFail('Could not set up a game. Try again.');
              return;
            }
            net.room = room; net.role = 'host'; net.code = code; net.ok = false; net.seen = performance.now();
            np({ role: 'host', v: 1, st: 'lobby', n0: hostName(), tg: cfg.target, w: 560 });
            lobbyMsg = 'Waiting for your friend to join...'; renderLobby();
          }, 900);
        }, function () { if (token === net.token) onlineFail('Could not set up a game. Try again.'); });
      })();
    });
  }
  function joinGame(raw) {
    var code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { lobbyMsg = 'Enter the 4-letter code from the host.'; renderLobby(); return; }
    leaveOnline();
    var token = net.token;
    lobbyStep = 'join'; lobbyMsg = 'Looking for the game...'; renderLobby();
    getRoomNs().then(function (ns) {
      if (token !== net.token) return;
      if (!ns) { roomState = 'none'; onlineFail(NO_ROOM); return; }
      ns.join('pong-' + code.toLowerCase()).then(function (room) {
        if (token !== net.token) { leaveRoom(room); return; }
        net.room = room; net.role = 'guest'; net.code = code; net.ok = false; net.waitUntil = performance.now() + 6000;
        np({ role: 'guest', v: 1, n: guestName(), y: rd(WID / 2), pz: 0, rq: 0 });
        renderLobby();
      }, function () { if (token === net.token) onlineFail('Could not join. Check the code and try again.', 'join'); });
    });
  }

  function partnerJoined(g) {
    if (net.role === 'host') {
      net.rn = cleanName(g.n) || 'FRIEND';
      if (net.rn === hostName()) net.rn = net.rn.slice(0, 7) + '2';
      net.hostPz = num(g.pz, 0) | 0; net.hostRq = num(g.rq, 0) | 0; net.lastSend = 0;
      lobbyMsg = net.rn + ' joined. Press start when ready.';
    } else {
      lobbyMsg = 'Connected. Waiting for the host to start.';
    }
    renderLobby();
  }
  function partnerLeft() {
    if (net.role === 'host') {
      net.peerId = null; net.remoteY = null; net.rn = '';
      lobbyOpen = true; lobbyStep = 'host'; lobbyMsg = 'Your friend left. Waiting for someone to join...';
      startDemo();
      setScreens(); renderLobby();
    } else {
      onlineFail('The host left the game.', 'choose');
    }
  }
  function hostSync(g) {
    var nm = cleanName(g.n);
    if (nm) { if (nm === hostName()) nm = nm.slice(0, 7) + '2'; net.rn = nm; }
    if (typeof g.y === 'number' && isFinite(g.y)) net.remoteY = g.y;
    var pzv = num(g.pz, 0) | 0, rqv = num(g.rq, 0) | 0;
    if (pzv !== net.hostPz) {                      // the friend asked to pause or resume
      net.hostPz = pzv;
      if (scene === 'game') pause(); else if (scene === 'paused') resume();
    }
    if (rqv !== net.hostRq) {                      // the friend asked for a rematch
      net.hostRq = rqv;
      if (scene === 'over') startMatch();
    }
  }
  function guestSync(g) {
    if (g === net.last) return;
    net.last = g;
    if (g.gp && net.me && g.gp !== net.me) { onlineFail('That game already has two players.', 'join'); return; }
    var st = g.st === 'lobby' ? 'menu' : g.st;
    if (st !== 'menu' && st !== 'game' && st !== 'paused' && st !== 'over') return;
    var prev = scene;
    net.tg = clamp(num(g.tg, 7) | 0, 1, 21);
    p[0].name = cleanName(g.n0) || 'HOST'; p[1].name = cleanName(g.n1) || 'FRIEND';
    if (st !== 'menu') {
      scene = st;                                   // leave 'menu' first so layout() keeps the host's court width
      if (typeof g.bz === 'string' && BALL_SIZES.hasOwnProperty(g.bz)) applyBall(g.bz);   // the host's ball size applies to both players
      var w = num(g.w, WID);
      if (w !== WID) { setField(clamp(w, 300, 900)); layout(); }
      var s0 = num(g.s0, 0) | 0, s1 = num(g.s1, 0) | 0, ht = num(g.ht, 0) | 0, wb = num(g.wb, 0) | 0;
      if (st === 'game' && net.lht !== null) {      // sounds come from counters the host sends
        if (ht > net.lht) beep(880, 0.07);
        if (wb > net.lwb) beep(520, 0.05);
        if (s0 + s1 > net.lss) { beep(330, 0.4); try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) {} }
      }
      net.lht = ht; net.lwb = wb; net.lss = s0 + s1;
      p[0].score = s0; p[1].score = s1;
      stats.hits = ht; stats.rally = num(g.rl, 0) | 0; stats.best = num(g.bs, 0) | 0;
      stats.top = num(g.tp, BALL_START); stats.time = num(g.tm, 0);
      series[0] = num(g.r0, 0) | 0; series[1] = num(g.r1, 0) | 0;
      phase = g.ph ? 'play' : 'serve'; serveT = clamp(num(g.sv, 0), 0, 5);
      ball.x = clamp(num(g.bx, ball.x), -60, LEN + 60); ball.y = clamp(num(g.by, ball.y), 0, WID);
      ball.vx = clamp(num(g.vx, 0), -1500, 1500); ball.vy = clamp(num(g.vy, 0), -1500, 1500);
      net.y0t = clamp(num(g.y0, WID / 2), 0, WID);
    }
    if (st !== prev) enterGuestScene(st, prev);
  }
  function enterGuestScene(st, prev) {
    if (st === 'game') {
      lobbyOpen = false;
      if (prev !== 'paused') {
        ctrl = ['remote', 'human']; touchT = [null, null]; ptrSide.clear(); down = {};
        p[0].y = net.y0t; p[1].y = WID / 2; net.sentY = null; np({ y: rd(WID / 2) });
      }
    } else if (st === 'paused') {
      touchT = [null, null]; ptrSide.clear(); down = {};
    } else if (st === 'over') {
      fillOver(p[0].score >= net.tg ? 0 : 1);
      try { if (navigator.vibrate) navigator.vibrate([30, 40, 60]); } catch (e) {}
    } else {                                        // the host is back in its lobby
      startDemo(); lobbyOpen = true; lobbyStep = 'join'; lobbyMsg = 'Connected. Waiting for the host to start.';
    }
    setScreens(); renderLobby();
  }
  function guestTick(dt) {
    now += dt * 1000;
    p[0].y += (net.y0t - p[0].y) * Math.min(1, dt * 30);
    movePaddle(1, dt);
    if (phase === 'serve') { serveT = Math.max(0, serveT - dt); return; }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;   // glide between host updates
    if (ball.y - R < YMIN) { ball.y = YMIN + R; ball.vy = Math.abs(ball.vy); }
    else if (ball.y + R > YMAX) { ball.y = YMAX - R; ball.vy = -Math.abs(ball.vy); }
    ball.x = clamp(ball.x, -3 * R, LEN + 3 * R);
  }
  function netTick(ts) {
    if (!net.role || !net.room) return;
    var ps = net.room.peers(), want = net.role === 'host' ? 'guest' : 'host', partner = null, i, q;
    for (i = 0; i < ps.length; i++) {
      q = ps[i];
      if (q.isMe) { if (q.sameTab) net.me = q.peer; continue; }
      if (q.presence && q.presence.role === want && (!partner || q.peer === net.peerId)) partner = q;
    }
    if (partner) {
      net.seen = ts; net.peerId = partner.peer; net.waitUntil = 0;
      if (!net.ok) { net.ok = true; partnerJoined(partner.presence); }
    } else if (net.ok) {
      if (ts - net.seen > 4000) { net.ok = false; partnerLeft(); }   // tolerate short connection blips
      return;
    } else {
      if (net.role === 'guest' && net.waitUntil && ts > net.waitUntil) onlineFail('No game found with that code.', 'join');
      return;
    }
    if (net.role === 'host') hostSync(partner.presence); else guestSync(partner.presence);
  }
  function netSend(ts) {
    if (!net.room || !net.role) return;
    if (net.role === 'host') {
      if (ts - net.lastSend < (scene === 'menu' ? 500 : 33)) return;
      net.lastSend = ts;
      np({ role: 'host', v: 1, st: scene === 'menu' ? 'lobby' : scene, ph: phase === 'play' ? 1 : 0,
        sv: Math.round(Math.max(0, serveT) * 100) / 100, bx: rd(ball.x), by: rd(ball.y), vx: rd(ball.vx), vy: rd(ball.vy),
        y0: rd(p[0].y), y1: rd(p[1].y), s0: p[0].score, s1: p[1].score, tg: cfg.target, w: WID,
        n0: hostName(), n1: net.rn || 'FRIEND', bz: cfg.ball, ht: stats.hits, wb: wallHits, rl: stats.rally, bs: stats.best,
        tp: Math.round(stats.top), tm: rd(stats.time), r0: series[0], r1: series[1], gp: net.peerId || '' });
    } else {
      if (scene !== 'game' || ts - net.lastSend < 33) return;
      var yy = rd(p[1].y);
      if (yy === net.sentY && ts - net.lastSend < 1000) return;
      net.lastSend = ts; net.sentY = yy;
      np({ y: yy });
    }
  }

  /* ---------- boot ---------- */
  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    var ts = performance.now();
    netTick(ts); tick(dt); netSend(ts); draw();
    requestAnimationFrame(frame);
  }
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, ensureAudio, { passive: true }); });
  // phones report a stale or in-between size for a moment while turning, so measure again a few times as the turn settles
  var settleT = [];
  function relayout() {
    layout();
    settleT.forEach(clearTimeout);
    settleT = [80, 250, 600].map(function (ms) { return setTimeout(layout, ms); });
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap);
  if (ONLINE_ENABLED) {
    var ob = document.createElement('button'); ob.className = 'seg'; ob.setAttribute('data-key', 'mode'); ob.setAttribute('data-val', 'online'); ob.textContent = 'Online';
    document.querySelector('.segs[aria-label="Mode"]').appendChild(ob);
  }
  refreshUI(); layout(); startDemo(); layout();
  if (window.__PP_TEST === true) window.__PP_TEST = {   // test-only hook: set window.__PP_TEST = true before the page loads (tests/tunneling.js)
    ball: ball, trail: trail, simT: function () { return simT; }, TRAIL_T: TRAIL_T, p: p, ctrl: ctrl, stats: stats, tick: tick, applyBall: applyBall, ai: ai, DIFF: DIFF, resetAI: resetAI, centerBall: centerBall,
    setPhase: function (v) { phase = v; }, setScene: function (v) { scene = v; },
    consts: function () { return { LEN: LEN, PAD_M: PAD_M, P1_FACE: P1_FACE, P2_FACE: P2_FACE, PAD_L: PAD_L, R: R, YMIN: YMIN, YMAX: YMAX, MAX_STEP: MAX_STEP }; }
  };
  requestAnimationFrame(frame);
})();
