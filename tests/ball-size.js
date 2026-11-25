const { chromium } = require('playwright');
const fs = require('fs');
const SP = require('./helper').tmp;
const src = '<script>window.__PP_ONLINE = true;</script>' + require('./helper').artifact();
fs.writeFileSync(SP + '/ball.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
const URL = 'file://' + SP + '/ball.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const check = (n, ok, x) => out.push((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));

// record every square fillRect so we can see the ball (it is drawn as BALL x BALL)
const SPY = `window.__sq = {}; const f = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { if (Math.abs(w - h) < 0.01) { const k = Math.round(w); window.__sq[k] = (window.__sq[k] || 0) + 1; } return f.apply(this, arguments); };
  window.__reset = () => { window.__sq = {}; };`;

const rooms = {}; const pages = {};
async function broadcast(name) { const m = rooms[name] || {}; for (const id of Object.keys(m)) { const snap = Object.keys(m).map((pid) => ({ peer: pid, isMe: pid === id, sameTab: pid === id, kind: 'viewer', guest: false, presence: Object.assign({}, m[pid]), updatedAt: Date.now() })); if (pages[id]) pages[id].evaluate(([n, s]) => window.__peers && window.__peers(n, s), [name, snap]).catch(() => {}); } }
async function newPlayer(browser, id, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage(); pages[id] = page;
  await page.exposeFunction('__hubJoin', (n) => { rooms[n] = rooms[n] || {}; rooms[n][id] = rooms[n][id] || {}; broadcast(n); });
  await page.exposeFunction('__hubPres', (n, p) => { const m = rooms[n]; if (!m || !m[id]) return; for (const k of Object.keys(p)) { if (p[k] === null) delete m[id][k]; else m[id][k] = p[k]; } broadcast(n); });
  await page.exposeFunction('__hubLeave', (n) => { if (rooms[n]) { delete rooms[n][id]; broadcast(n); } });
  await page.addInitScript(SPY + `const snaps = {}; window.__peers = (n, s) => { snaps[n] = Object.freeze(s); };
    window.claude = { use: async (n) => n === 'room' ? { join: async (name) => { await window.__hubJoin(name); return { name, presence: (p) => window.__hubPres(name, p), peers: () => snaps[name] || [], leave: async () => window.__hubLeave(name) }; } } : null };`);
  page.on('pageerror', (e) => check('no page error on ' + id, false, String(e)));
  await page.goto(URL); await sleep(300); return page;
}
// the ball is the only square on screen in the menu demo (no scoreboard, no digits)
const sizesSeen = async (P) => { await P.evaluate(() => window.__reset()); await sleep(400); return P.evaluate(() => Object.keys(window.__sq).map(Number)); };

(async () => {
  const browser = await chromium.launch();
  {
    const P = await newPlayer(browser, 'S', { width: 844, height: 390 });
    for (const [name, size] of [['small', 12], ['medium', 16], ['large', 24]]) {
      await P.click(`.seg[data-key="ball"][data-val="${name}"]`);
      const s = await sizesSeen(P);
      check(`menu demo ball is ${size} when ${name} is selected`, s.length === 1 && s[0] === size, JSON.stringify(s));
      check(`${name} button shows as selected`, await P.evaluate((n) => document.querySelector(`.seg[data-key="ball"][data-val="${n}"]`).classList.contains('on'), name));
    }
    // saved between visits
    await P.click('.seg[data-key="ball"][data-val="large"]');
    await P.reload(); await sleep(400);
    const s = await sizesSeen(P);
    check('the choice is remembered after reload', s.length === 1 && s[0] === 24, JSON.stringify(s));
    // a real match with the large ball: still plays through to the end
    await P.click('.seg[data-key="target"][data-val="3"]'); await P.click('.seg[data-key="diff"][data-val="insane"]');
    await P.click('#playBtn'); await sleep(1500);
    await P.screenshot({ path: SP + '/ball-large.png' });
    await P.waitForSelector('#overScr:not([hidden])', { timeout: 60000 });
    check('a match with the large ball finishes', true);
    await P.context().close();
  }
  {
    const A = await newPlayer(browser, 'A', { width: 844, height: 390 });   // host picks LARGE
    const B = await newPlayer(browser, 'B', { width: 390, height: 844 });   // guest keeps MEDIUM
    for (const P of [A, B]) { await P.click('.seg[data-key="mode"][data-val="online"]'); await P.click('.seg[data-key="target"][data-val="3"]'); }
    await A.click('.seg[data-key="ball"][data-val="large"]');   // guest stays on the default medium (16), which nothing else on screen can mimic
    await A.click('#playBtn'); await B.click('#playBtn');
    await A.click('#lbHost'); await A.waitForFunction(() => document.querySelector('#lbCode').textContent !== '----', null, { timeout: 8000 });
    const code = (await A.textContent('#lbCode')).trim();
    await B.click('#lbJoin'); await B.fill('#codeIn', code); await B.click('#lbGo');
    await A.waitForSelector('#lbStart:not([hidden])', { timeout: 8000 });
    await A.click('#lbStart'); await sleep(1500);
    await A.evaluate(() => window.__reset()); await B.evaluate(() => window.__reset()); await sleep(400);
    const sa = await A.evaluate(() => Object.keys(window.__sq).map(Number)), sb = await B.evaluate(() => Object.keys(window.__sq).map(Number));
    check('host draws the large ball (24)', sa.includes(24), JSON.stringify(sa));
    check('guest draws the host\'s large ball too, not its own small one', sb.includes(24) && !sb.includes(16), JSON.stringify(sb));
    await B.screenshot({ path: SP + '/ball-guest.png' });
  }
  console.log(out.join('\n')); await browser.close();
  process.exit(out.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(out.join('\n')); console.error('CRASH', e); process.exit(2); });
