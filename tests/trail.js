// A fast ball must look continuous: between two screen frames the streak has to join the ball's old position to its new one.
const { chromium } = require('playwright'); const fs = require('fs'); const { tmp, artifact } = require('./helper');
fs.writeFileSync(tmp + '/trail.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + artifact() + '</body></html>');
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.addInitScript(() => { window.__PP_TEST = true; }); await page.goto('file://' + tmp + '/trail.html'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const T = window.__PP_TEST, C = T.consts(), res = []; T.setScene('game'); T.ctrl[0] = 'human'; T.ctrl[1] = 'human';
    for (const sp of [430, 900, 3000, 8000]) for (const dt of [0.008, 0.016, 0.0333, 0.05]) {
      T.setScene('game'); T.trail.length = 0; T.p[0].score = 0; T.p[1].score = 0; T.p[0].y = T.p[1].y = 280; T.ball.x = 500; T.ball.y = 280; T.ball.sp = sp; T.ball.vx = sp * 0.8; T.ball.vy = sp * 0.6; T.setPhase('play');
      let gaps = 0, frames = 0, worst = 0; T.tick(0.016); T.ball.sp = sp;   // one warm-up frame so the streak exists
      for (let f = 0; f < 200 && T.ball.vx !== 0; f++) {
        const hx = T.ball.x, hy = T.ball.y, h0 = T.stats.hits, s0 = T.p[0].score + T.p[1].score; T.tick(dt); if (T.p[0].score + T.p[1].score > s0) break;
        if (T.stats.hits > h0) {   // a return moves the ball a few units off the bar face, so skip the joining check this frame, and put the speed back (the bars never miss here)
          const k = sp / T.ball.sp; T.ball.vx *= k; T.ball.vy *= k; T.ball.sp = sp; continue; }
        const cut = T.simT() - T.TRAIL_T, pts = T.trail.filter((q) => q.t >= cut); frames++;
        const near = pts.some((q) => Math.hypot(q.x - hx, q.y - hy) <= C.MAX_STEP + 1);   // the old head is on the streak
        if (!near) gaps++;
        for (let i = 1; i < pts.length; i++) worst = Math.max(worst, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      }
      res.push({ sp, dt, frames, gaps, worstStep: +worst.toFixed(1) });
    }
    return res;
  });
  const bad = r.filter((x) => x.gaps > 0);
  ck(r.every((x) => x.frames >= 1) && r.filter((x) => x.frames >= 10).length >= 12, 'the frames were measured (a few fast shots end on their first frames by missing the bar)', r.filter((x) => x.frames < 10));
  ck(bad.length === 0, 'the streak always joins last frame\'s ball position to the new one (speeds 430-8000, frames 8-50 ms)', bad.slice(0, 4));
  ck(Math.max(...r.map((x) => x.worstStep)) <= 9, 'streak points are never more than 9 units apart (6 per step, a little more around a wall bounce), so there are no holes in it', { worst: Math.max(...r.map((x) => x.worstStep)) });
  // slow ball is classic: no streak drawn; fast ball: streak drawn
  const drawn = await page.evaluate(async () => {
    const T = window.__PP_TEST; const sq = []; const f = CanvasRenderingContext2D.prototype.fillRect; let alphas = new Set();
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { if (Math.abs(w - h) < 0.01 && Math.round(w) === Math.round(T.consts().R * 2)) alphas.add(+this.globalAlpha.toFixed(2)); return f.apply(this, arguments); };
    const run = async (sp) => { alphas = new Set(); T.setScene('menu'); T.ctrl[0] = 'human'; T.ctrl[1] = 'human'; T.p[0].y = T.p[1].y = 280; T.ball.x = 500; T.ball.y = 280; T.ball.sp = sp; T.ball.vx = sp * 0.5; T.ball.vy = 0; T.setPhase('play'); await new Promise((r) => setTimeout(r, 120)); return [...alphas].filter((a) => a < 1).length; };
    const slow = await run(430), fast = await run(2500); CanvasRenderingContext2D.prototype.fillRect = f; return { slowFaded: slow, fastFaded: fast };
  });
  ck(drawn.slowFaded === 0 && drawn.fastFaded > 0, 'slow ball has no streak, fast ball is drawn with a fading streak', drawn);
  await page.screenshot({ path: tmp + '/trail.png' }); console.log('shot ' + tmp + '/trail.png');
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
