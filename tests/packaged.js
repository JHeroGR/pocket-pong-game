// Smoke test of the two shipped forms: the www/ folder over http, and the single standalone file.
const { chromium, devices } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const www = path.join(__dirname, '..', 'www'), single = path.join(__dirname, '..', 'dist', 'pocket-pong.single.html');
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { const p = path.join(www, q.url === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/plain' }); s.end(d); }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const browser = await chromium.launch();
  for (const [label, url] of [['www over http', 'http://localhost:' + port + '/'], ['single file', 'file://' + single]]) {
    for (const [dn, dev] of [['phone', devices['iPhone 13']], ['desktop', { viewport: { width: 1280, height: 720 } }]]) {
      const ctx = await browser.newContext({ ...dev }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
      page.on('requestfailed', () => {});
      await page.goto(url); await page.waitForTimeout(600);
      await (dn === 'phone' ? page.tap('#playBtn') : page.click('#playBtn')); await page.waitForTimeout(400);
      const playing = await page.evaluate(() => { const b = document.getElementById('pauseBtn'); return !b.hidden && b.getBoundingClientRect().width > 0; });
      const canvasDrawn = await page.evaluate(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 100) return true; return false; });
      ck(playing && canvasDrawn && errs.length === 0, label + ' / ' + dn + ': loads, starts a match, draws, no errors', { playing, canvasDrawn, errs });
      await ctx.close();
    }
  }
  await browser.close(); srv.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
