// Menu layout after turning the phone: nothing stretched, nothing off screen, title and Play always visible.
const { chromium, devices } = require('playwright');
const fs = require('fs'); const { tmp, artifact } = require('./helper');
fs.writeFileSync(tmp + '/layout.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style></head><body>' + artifact() + '</body></html>');
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const probe = () => { const r = (e) => e.getBoundingClientRect(); const ui = r(document.getElementById('ui')); const grps = [...document.querySelectorAll('#menuScr .opts > .grp')].filter((g) => g.getBoundingClientRect().height > 0).map(r);
  const gaps = grps.slice(1).map((g, i) => Math.round(g.top - grps[i].bottom)); const t = r(document.querySelector('h1')), p = r(document.getElementById('playBtn'));
  return { ui: [Math.round(ui.height), innerHeight], uiMatches: Math.round(ui.height) === innerHeight && Math.round(ui.width) <= innerWidth && Math.round(ui.width) >= innerWidth - 40, maxGapInColumn: document.getElementById('ui').classList.contains('port') ? Math.max(...gaps) : 0,
    titleOnScreen: t.top >= 0 && t.bottom <= innerHeight, playOnScreen: p.top >= 0 && p.bottom <= innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth, uiClass: document.getElementById('ui').classList.contains('land') ? 'land' : 'port' }; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage();
  await page.goto('file://' + tmp + '/layout.html'); await page.waitForTimeout(500);
  for (const [w, h, label] of [[390, 844, 'upright'], [844, 390, 'sideways'], [390, 844, 'upright again'], [844, 390, 'sideways again'], [390, 844, 'upright, third time']]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(700);
    const m = await page.evaluate(probe);
    ck(m.uiMatches && m.titleOnScreen && m.playOnScreen && !m.hScroll && m.maxGapInColumn <= 40 && m.uiClass === (w > h ? 'land' : 'port'), label, m);
  }
  // forced views keep the menu in the phone's own orientation
  for (const view of ['land', 'port']) {
    await page.evaluate((v) => { document.querySelector('#menuScr .seg[data-key="view"][data-val="' + v + '"]').click(); }, view); await page.waitForTimeout(300);
    const m = await page.evaluate(probe); ck(m.uiMatches && m.titleOnScreen && m.playOnScreen, 'forced ' + view + ' view keeps the menu upright and on screen', m);
  }
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
