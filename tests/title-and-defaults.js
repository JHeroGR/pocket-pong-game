const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = require('./helper').tmp;
const src = require('./helper').artifact();
fs.writeFileSync(SP + '/land.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
const SPY = `window.__sq = {}; const f = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { if (Math.abs(w - h) < 0.01) { const k = Math.round(w); window.__sq[k] = (window.__sq[k] || 0) + 1; } return f.apply(this, arguments); };`;
(async () => {
  const browser = await chromium.launch();
  // short landscape screens: is the title still fully on screen and on top?
  for (const h of [342, 260, 220, 190]) {
    const dev = devices['iPhone 13 landscape'];
    const ctx = await browser.newContext({ ...dev, viewport: { width: 844, height: h }, screen: { width: 844, height: h } });
    const page = await ctx.newPage();
    await page.goto('file://' + SP + '/land.html'); await page.waitForTimeout(500);
    const i = await page.evaluate(() => { const t = document.querySelector('h1'); const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const play = document.getElementById('playBtn').getBoundingClientRect();
      return { vh: innerHeight, title: [Math.round(r.top), Math.round(r.bottom)], titleOnScreen: r.top >= 0 && r.bottom <= innerHeight, titleOnTop: !!top && t.contains(top), playOnScreen: play.top >= 0 && play.bottom <= innerHeight,
        menuBg: getComputedStyle(document.getElementById('menuScr')).backgroundColor }; });
    console.log('landscape h=' + h, JSON.stringify(i));
    if (h === 190) await page.screenshot({ path: SP + '/land-190.png' });
    await ctx.close();
  }
  // default ball and migration of an older saved choice
  const cases = [['fresh install', null, 12], ['older save with a large ball (no version)', { ball: 'large', mode: 'ai' }, 12], ['new save with a large ball (v2)', { ball: 'large', v: 2 }, 24]];
  for (const [name, saved, want] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, ...{} });
    const page = await ctx.newPage();
    await page.addInitScript(SPY);
    if (saved) await page.addInitScript((c) => { try { localStorage.setItem('pocket-pong', JSON.stringify(c)); } catch (e) {} }, saved);
    await page.goto('file://' + SP + '/land.html'); await page.waitForTimeout(600);
    const seen = await page.evaluate(() => Object.keys(window.__sq).map(Number));
    const sel = await page.evaluate(() => [...document.querySelectorAll('.seg[data-key="ball"].on')].map((b) => b.dataset.val));
    console.log((seen.length === 1 && seen[0] === want ? 'PASS ' : 'FAIL ') + name + ' -> ball ' + JSON.stringify(seen) + ' selected ' + JSON.stringify(sel));
    await ctx.close();
  }
  await browser.close();
})();
