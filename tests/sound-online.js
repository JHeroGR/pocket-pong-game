const { chromium } = require('playwright');
const fs = require('fs');
const SP = require('./helper').tmp;
const src = '<script>window.__PP_ONLINE = true;</script>' + require('./helper').artifact();
fs.writeFileSync(SP + '/test.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
const URL = 'file://' + SP + '/test.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

// audio spy: records every oscillator frequency and the state of every AudioContext
const AUDIO_SPY = `
  window.__osc = []; window.__acs = [];
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor() { super(); window.__acs.push(this); }
    createOscillator() { const o = super.createOscillator(); const self = this;
      const st = o.start.bind(o); o.start = function (t) { window.__osc.push(Math.round(o.frequency.value)); return st(t); }; return o; }
  };
`;

// in-memory stand-in for the room capability, shared between pages through the node process
const rooms = {}; const pages = {};
async function broadcast(name) {
  const members = rooms[name] || {};
  for (const id of Object.keys(members)) {
    const snap = Object.keys(members).map((pid) => ({ peer: pid, isMe: pid === id, sameTab: pid === id, kind: 'viewer', guest: false, presence: Object.assign({}, members[pid]), updatedAt: Date.now() }));
    if (pages[id]) pages[id].evaluate(([n, s]) => window.__peers && window.__peers(n, s), [name, snap]).catch(() => {});
  }
}
async function newPlayer(browser, id, vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: false });
  const page = await ctx.newPage();
  pages[id] = page;
  await page.exposeFunction('__hubJoin', (name) => { rooms[name] = rooms[name] || {}; rooms[name][id] = rooms[name][id] || {}; broadcast(name); });
  await page.exposeFunction('__hubPres', (name, patch) => { const m = rooms[name]; if (!m || !m[id]) return; for (const k of Object.keys(patch)) { if (patch[k] === null) delete m[id][k]; else m[id][k] = patch[k]; } broadcast(name); });
  await page.exposeFunction('__hubLeave', (name) => { if (rooms[name]) { delete rooms[name][id]; broadcast(name); } });
  await page.addInitScript(AUDIO_SPY + `
    const snaps = {};
    window.__peers = (n, s) => { snaps[n] = Object.freeze(s); };
    window.claude = { use: async (n) => n === 'room' ? {
      join: async (name) => { await window.__hubJoin(name); return { name, presence: (patch) => window.__hubPres(name, patch), peers: () => snaps[name] || [], leave: async () => window.__hubLeave(name) }; }
    } : null };
  `);
  page.on('pageerror', (e) => check('no page error on ' + id, false, String(e)));
  await page.goto(URL);
  await sleep(300);
  return page;
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  /* ---------------- sound ---------------- */
  {
    const P = await newPlayer(browser, 'S', { width: 844, height: 390 });
    const osc = () => P.evaluate(() => window.__osc.slice());
    const states = () => P.evaluate(() => window.__acs.map((a) => a.state));
    await P.click('.seg[data-key="sound"][data-val="off"]'); await sleep(200);
    await P.click('.seg[data-key="sound"][data-val="on"]'); await sleep(400);
    let o = await osc();
    check('selecting On plays exactly one sound (the ding)', o.length === 1 && o[0] === 1175, JSON.stringify(o));
    const before = o.length;
    await P.click('.seg[data-key="diff"][data-val="hard"]'); await sleep(300);
    o = await osc();
    check('another menu option plays one different sound (the tick)', o.length === before + 1 && o[o.length - 1] === 587, JSON.stringify(o));
    await P.click('.seg[data-key="target"][data-val="5"]'); await sleep(300);
    o = await osc(); const n2 = o.length;
    check('every other option ticks the same way', o[o.length - 1] === 587 && n2 === before + 2, JSON.stringify(o));
    await P.click('.seg[data-key="sound"][data-val="off"]'); await sleep(400);
    o = await osc();
    check('selecting Off plays nothing', o.length === n2, JSON.stringify(o));
    check('Off suspends the audio engine', (await states()).every((s) => s === 'suspended'), JSON.stringify(await states()));
    await P.click('.seg[data-key="diff"][data-val="easy"]'); await sleep(200);
    await P.click('.seg[data-key="view"][data-val="land"]'); await sleep(200);
    await P.click('.seg[data-key="target"][data-val="3"]'); await sleep(300);
    o = await osc();
    check('with Off, other options make no sound', o.length === n2, JSON.stringify(o));
    await P.click('#playBtn'); await sleep(2500);
    o = await osc();
    check('with Off, the game itself is silent too', o.length === n2, 'count ' + o.length);
    await P.click('.seg[data-key="sound"][data-val="on"]').catch(() => {});
    await P.context().close();
  }

  /* ---------------- online ---------------- */
  {
    const A = await newPlayer(browser, 'A', { width: 844, height: 390 });   // host, landscape
    const B = await newPlayer(browser, 'B', { width: 390, height: 844 });   // guest, portrait
    for (const P of [A, B]) {
      await P.click('.seg[data-key="mode"][data-val="online"]');
      await P.click('.seg[data-key="target"][data-val="3"]');
    }
    await A.fill('#n1', 'ANNA'); await B.fill('#n1', 'BEN');
    await A.click('#playBtn'); await B.click('#playBtn');
    check('lobby opens on both', (await vis(A, '#lobbyScr')) && (await vis(B, '#lobbyScr')));
    await A.click('#lbHost');
    await A.waitForFunction(() => document.querySelector('#lbCode').textContent !== '----', null, { timeout: 8000 });
    const code = (await A.textContent('#lbCode')).trim();
    check('host gets a 4-character code', /^[A-Z0-9]{4}$/.test(code), code);
    await B.click('#lbJoin'); await B.fill('#codeIn', code); await B.click('#lbGo');
    await A.waitForSelector('#lbStart:not([hidden])', { timeout: 8000 });
    check('host sees the friend join', /BEN joined/.test(await A.textContent('#lbMsg')), await A.textContent('#lbMsg'));
    await sleep(300);
    check('guest sees connected', /Connected/.test(await B.textContent('#lbMsg')), await B.textContent('#lbMsg'));
    await A.click('#lbStart'); await sleep(1800);
    check('match starts on the guest too', await vis(B, '#pauseBtn') && !(await vis(B, '#lobbyScr')));
    await A.screenshot({ path: SP + '/host.png' });
    await B.screenshot({ path: SP + '/guest.png' });
    // guest moves its bar; the host should follow
    // where is the host's right-hand bar? scan its pixel column on the canvas (skip the top and bottom walls)
    const barY = (P) => P.evaluate(() => { const c = document.getElementById('cv'); const g = c.getContext('2d'); const sc = Math.min(c.width / 1000, c.height / 560); const x = Math.round(c.width / 2 + (959 - 500) * sc);
      const d = g.getImageData(x, 0, 1, c.height).data; let lo = -1, hi = -1;
      for (let y = 14; y < c.height - 14; y++) { if (d[y * 4] > 150) { if (lo < 0) lo = y; hi = y; } } return lo < 0 ? null : (lo + hi) / 2; });
    console.log('DEBUG', JSON.stringify(await A.evaluate(() => { const c = document.getElementById('cv'); const g = c.getContext('2d'); const out = [];
      for (const fx of [0.05, 0.12, 0.2, 0.5, 0.8, 0.86, 0.878, 0.9]) { const x = Math.round(c.width * fx); const d = g.getImageData(x, 0, 1, c.height).data; let n = 0; for (let y = 0; y < c.height; y++) if (d[y * 4] > 150) n++; out.push([fx, x, n]); }
      return { w: c.width, h: c.height, out }; })));
    await B.mouse.move(60, 500); await sleep(600);
    const yTop = await barY(A);
    await B.mouse.move(330, 500); await sleep(600);
    const yBot = await barY(A);
    check('host sees the guest bar move to one side', yTop !== null && yTop < 120, 'y=' + yTop);
    check('host sees the guest bar move to the other side', yBot !== null && yBot > 250, 'y=' + yBot);
    await B.mouse.move(195, 500); await sleep(400);
    await A.screenshot({ path: SP + '/host2.png' });
    await B.screenshot({ path: SP + '/guest2.png' });
    // guest pauses, then resumes
    await B.click('#pauseBtn'); await sleep(500);
    check('guest pause request pauses the host', await vis(A, '#pauseScr'));
    check('guest sees the pause screen', await vis(B, '#pauseScr'));
    check('guest cannot restart', !(await vis(B, '#restartBtn')));
    await B.click('#resumeBtn'); await sleep(500);
    check('guest resume request resumes the host', !(await vis(A, '#pauseScr')) && !(await vis(B, '#pauseScr')));
    // let the ball run to the end of a 3-point match
    await A.waitForSelector('#overScr:not([hidden])', { timeout: 40000 });
    await sleep(500);
    check('both players see the match end', await vis(A, '#overScr') && await vis(B, '#overScr'));
    check('same result on both', (await A.textContent('#ovTitle')) === (await B.textContent('#ovTitle')), await A.textContent('#ovTitle') + ' / ' + await B.textContent('#ovTitle'));
    await B.screenshot({ path: SP + '/guest_over.png' });
    await B.click('#rematchBtn'); await sleep(1200);
    check('guest rematch request starts a new match', !(await vis(A, '#overScr')) && !(await vis(B, '#overScr')) && await vis(B, '#pauseBtn'));
    // guest leaves; the host drops back to the lobby
    await B.click('#pauseBtn'); await sleep(400);
    await B.click('#pauseMenuBtn');
    await A.waitForSelector('#lobbyScr:not([hidden])', { timeout: 9000 });
    check('host returns to the lobby when the friend leaves', /left/.test(await A.textContent('#lbMsg')), await A.textContent('#lbMsg'));
    // wrong code
    await B.click('.seg[data-key="mode"][data-val="online"]').catch(() => {});
    await B.click('#playBtn'); await B.click('#lbJoin'); await B.fill('#codeIn', 'ZZZZ'); await B.click('#lbGo');
    await sleep(7000);
    check('a wrong code says no game found', /No game found/.test(await B.textContent('#lbMsg')), await B.textContent('#lbMsg'));
  }

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error('TEST CRASH', e); process.exit(2); });
