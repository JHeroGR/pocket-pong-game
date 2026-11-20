// The pause button must sit on the scoreboard's row, exactly midway between the two scores.
const { chromium, devices } = require('playwright'); const fs = require('fs'); const { tmp, artifact } = require('./helper');
fs.writeFileSync(tmp + '/pause.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + artifact() + '</body></html>');
const SPY = `window.__d = []; const f = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { if (Math.abs(w - 12) < .01 && Math.abs(h - 12) < .01) { const t = this.getTransform(); window.__d.push([t.a * x + t.e, t.d * y + t.f, t.a * (x + w) + t.e, t.d * (y + h) + t.f, t.a]); } return f.apply(this, arguments); };`;
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const cases = [['phone upright', devices['iPhone 13'], null], ['phone sideways', devices['iPhone 13 landscape'], null], ['phone, forced horizontal', devices['iPhone 13'], { view: 'land', v: 2 }], ['phone sideways, forced vertical', devices['iPhone 13 landscape'], { view: 'port', v: 2 }], ['iPad', devices['iPad (gen 7)'], null], ['desktop', { viewport: { width: 1280, height: 720 } }, null]];
(async () => {
  const browser = await chromium.launch();
  for (const [name, dev, cfg] of cases) {
    const ctx = await browser.newContext({ ...dev }); const page = await ctx.newPage();
    await page.addInitScript(SPY);
    await page.addInitScript((c) => { try { localStorage.setItem('pocket-pong', JSON.stringify(Object.assign({ ball: 'medium', v: 2 }, c || {}))); } catch (e) {} }, cfg);
    await page.goto('file://' + tmp + '/pause.html'); await page.waitForTimeout(500);
    await (dev.hasTouch ? page.tap('#playBtn') : page.click('#playBtn')); await page.waitForTimeout(150);
    await page.evaluate(() => { window.__d = []; }); await page.waitForTimeout(120);
    const r = await page.evaluate(() => { const b = document.getElementById('pauseBtn'), cv = document.getElementById('cv'); const dpr = cv.width / parseFloat(getComputedStyle(cv).width);
      const sq = window.__d.slice(-60); const xs = [], ys = []; sq.forEach((q) => { xs.push(q[0], q[2]); ys.push(q[1], q[3]); });
      const st = document.getElementById('stage'); const land = st.classList.contains('land');
      const bx = b.offsetLeft + b.offsetWidth / 2, by = b.offsetTop + b.offsetHeight / 2;
      return { n: sq.length, scoreMid: [(Math.min(...xs) + Math.max(...xs)) / 2 / dpr, (Math.min(...ys) + Math.max(...ys)) / 2 / dpr], btn: [bx, by], land, rotated: /rotate/.test(st.style.transform), shown: !b.hidden }; });
    // landscape view: scores flank the middle (same row), so x must match the midpoint and y the row; portrait view: the other way round
    const dx = Math.abs(r.btn[0] - r.scoreMid[0]), dy = Math.abs(r.btn[1] - r.scoreMid[1]);
    ck(r.shown && r.n >= 20 && dx <= 3 && dy <= 3, name + ' (' + (r.land ? 'horizontal' : 'vertical') + ')', { off: [Math.round(dx), Math.round(dy)], btn: r.btn.map(Math.round), scores: r.scoreMid.map(Math.round) });
    await ctx.close();
  }
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
