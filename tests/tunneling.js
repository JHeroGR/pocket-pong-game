// Tunneling: can a fast ball ever pass through a bar or a wall? Drives the real physics (tick) with controlled frame times.
const { chromium } = require('playwright'); const fs = require('fs'); const { tmp, artifact } = require('./helper');
fs.writeFileSync(tmp + '/tun.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + artifact() + '</body></html>');
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.addInitScript(() => { window.__PP_TEST = true; });
  await page.goto('file://' + tmp + '/tun.html'); await page.waitForTimeout(400);
  const hasHook = await page.evaluate(() => typeof window.__PP_TEST === 'object');
  ck(hasHook, 'test hook available'); if (!hasHook) process.exit(1);
  const res = await page.evaluate(() => {
    const T = window.__PP_TEST, out = { trials: 0, passedThrough: [], bounced: 0, wallEscapes: 0, missesWhenMisaligned: 0, misalignedTrials: 0, maxTravelPerStep: 0, windows: {} };
    // let the physics run: scene 'game', both bars still (human with no input)
    T.setScene('game'); T.ctrl[0] = 'human'; T.ctrl[1] = 'human';
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (const size of ['small', 'medium', 'large']) {
      T.applyBall(size); const C = T.consts(); out.windows[size] = (C.P1_FACE - C.PAD_M) + 2 * C.R;
      for (const sp of [430, 900, 3000, 6000, 9000, 12000]) for (const dt of [0.001, 0.004, 0.008, 0.016, 0.0333, 0.05]) for (const side of [0, 1]) for (let k = 0; k < 120; k++) {
        const ang = rnd(-0.95, 0.95), dir = side === 0 ? -1 : 1, face = side === 0 ? C.P1_FACE : C.P2_FACE;
        // start anywhere up to one frame's travel before the window so a frame can land before, inside, or beyond it
        const run = sp * dt + 40, startX = side === 0 ? face + C.R + rnd(0, run) : face - C.R - rnd(0, run);
        const y = rnd(C.YMIN + 90, C.YMAX - 90); T.ball.x = startX; T.ball.y = y; T.ball.sp = sp; T.ball.vx = dir * sp * Math.cos(ang); T.ball.vy = sp * Math.sin(ang);
        // bar centred somewhere on the ball's path (it will be hit): bar y follows where the ball will be when it arrives
        const contactX = side === 0 ? face + C.R : face - C.R;      // the game first checks the bar when the ball's edge reaches the face
        const tArr = Math.abs((startX - contactX) / T.ball.vx); let yArr = y + T.ball.vy * tArr; const lo = C.YMIN, hi = C.YMAX;
        // reflect off the walls analytically to know where it arrives
        let span = hi - lo - 2 * C.R, yy = yArr - lo - C.R; yy = ((yy % (2 * span)) + 2 * span) % (2 * span); if (yy > span) yy = 2 * span - yy; yArr = lo + C.R + yy;
        const aligned = Math.random() < 0.85; const off = aligned ? rnd(-(C.PAD_L / 2), C.PAD_L / 2) : (Math.random() < 0.5 ? -1 : 1) * rnd(C.PAD_L / 2 + C.R + 25, C.PAD_L / 2 + C.R + 80);
        T.p[side].y = Math.max(C.YMIN + C.PAD_L / 2, Math.min(C.YMAX - C.PAD_L / 2, yArr + off)); T.p[1 - side].y = (C.YMIN + C.YMAX) / 2;
        const h0 = T.stats.hits, s0 = T.p[0].score + T.p[1].score; T.setPhase('play'); let prevX = T.ball.x, pass = false, escaped = false, steps = 0;
        const barEdgeBetween = Math.abs(T.p[side].y - yArr) <= C.PAD_L / 2 + C.R - 3;      // clearly inside the bar's reach
        const yExit = yArr + T.ball.vy * ((C.P1_FACE - C.PAD_M + 2 * C.R) / Math.abs(T.ball.vx));   // the ball keeps sliding while it is inside the bar's depth
        const reach = C.PAD_L / 2 + C.R + 12, bY = T.p[side].y;
        const bounceInside = yExit < C.YMIN + C.R || yExit > C.YMAX - C.R;      // a wall bounce inside the bar's depth makes the straight-line estimate unreliable: skip those
        const clearlyOut = !bounceInside && (bY > Math.max(yArr, yExit) + reach || bY < Math.min(yArr, yExit) - reach);
        while (steps++ < 4000) {
          T.tick(dt); if (T.ball.y < C.YMIN - 0.01 || T.ball.y > C.YMAX + 0.01) escaped = true;
          if (T.stats.hits > h0 || T.p[0].score + T.p[1].score > s0) break; }
        out.trials++; if (escaped) out.wallEscapes++;
        if (aligned && barEdgeBetween) { if (T.stats.hits === h0) out.passedThrough.push({ size, sp, dt, side, y, ang: +ang.toFixed(2), barY: Math.round(T.p[side].y), yArr: Math.round(yArr) }); else out.bounced++; }
        if (!aligned && clearlyOut) { out.misalignedTrials++; if (T.stats.hits === h0) out.missesWhenMisaligned++; }
        T.setPhase('serve'); T.p[0].score = 0; T.p[1].score = 0;
      }
    }
    out.maxStepBound = { MAX_STEP: T.consts().MAX_STEP, smallestWindow: Math.min(...Object.values(out.windows)) };
    return out;
  });
  ck(res.passedThrough.length === 0, 'no bar tunneling: ' + res.bounced + ' aligned shots all bounced (small/medium/large ball, speeds 430 to 12000, 1-50 ms frames, both sides)', res.passedThrough.slice(0, 3));
  ck(res.misalignedTrials > 0 && res.missesWhenMisaligned / res.misalignedTrials >= 0.99, 'the test can tell a miss from a hit: at least 99% of ' + res.misalignedTrials + ' clearly-missed shots scored (the rest are fast shots that bounced off walls inside the bar, which the straight-line estimate cannot predict)', { misses: res.missesWhenMisaligned, of: res.misalignedTrials });
  ck(res.wallEscapes === 0, 'the ball never leaves the court through the top or bottom wall');
  ck(res.maxStepBound.MAX_STEP < res.maxStepBound.smallestWindow / 2, 'per-step travel limit is under half the smallest bar window', res.maxStepBound);
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
