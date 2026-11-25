// No top speed: every return speeds the ball up. Does the game stay stable and playable?
const { chromium } = require('playwright'); const fs = require('fs'); const { tmp, artifact } = require('./helper');
fs.writeFileSync(tmp + '/speed.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + artifact() + '</body></html>');
let fails = 0; const ck = (ok, n, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const SIM = () => {
  const T = window.__PP_TEST, D = T.DIFF, out = [];
  const person = (keys) => ({ react: 230, speed: keys ? 720 : 2800, err: 22, slip: 0.08, predict: true, aim: 0, recenter: true });   // a plausible player
  const sim = (label, c0, c1, N) => {
    T.setScene('game'); T.ctrl[0] = 'ai'; T.ctrl[1] = 'ai'; T.ai[0].cfg = c0; T.ai[1].cfg = c1; T.resetAI(); T.p[0].y = T.p[1].y = 280; T.p[0].score = 0; T.p[1].score = 0; T.centerBall(1, 0);
    const lens = []; let prev = 0, top = 0, fastest = 0, frames = 0, finite = true, stuck = false;
    while (lens.length < N && frames++ < 1500000) {
      T.tick(0.016); top = Math.max(top, T.ball.sp); const r = T.stats.rally;
      if (r < prev) { lens.push(prev); fastest = Math.max(fastest, top); top = 0; }
      prev = r; T.p[0].score = 0; T.p[1].score = 0;
      if (!isFinite(T.ball.x + T.ball.y + T.ball.sp)) { finite = false; break; }
      if (r > 1000) { stuck = true; break; } }
    return { label, points: lens.length, longestRally: Math.max(...lens), fastest: Math.round(fastest), finite, stuck };
  };
  for (const sz of ['small', 'medium', 'large']) { T.applyBall(sz);
    out.push(Object.assign({ ball: sz }, sim('insane vs insane', D.insane, D.insane, 60)));
    out.push(Object.assign({ ball: sz }, sim('hard vs hard (the menu demo)', D.hard, D.hard, 60)));
    out.push(Object.assign({ ball: sz }, sim('phone player vs insane', person(false), D.insane, 60)));
    out.push(Object.assign({ ball: sz }, sim('keyboard player vs insane', person(true), D.insane, 60))); }
  // cost of one 50 ms hitch at absurd speeds
  const cost = []; T.setScene('game'); for (const sp of [900, 9000, 90000, 9e6]) { T.ball.x = 500; T.ball.y = 280; T.ball.sp = sp; T.ball.vx = sp; T.ball.vy = 0; T.setPhase('play'); const t0 = performance.now(); T.tick(0.05); cost.push({ sp, ms: +(performance.now() - t0).toFixed(1), finite: isFinite(T.ball.x + T.ball.y) }); }
  return { out, cost };
};
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.addInitScript(() => { window.__PP_TEST = true; }); await page.goto('file://' + tmp + '/speed.html'); await page.waitForTimeout(400);
  const { out, cost } = await page.evaluate(SIM);
  ck(out.every((r) => r.finite), 'ball position and speed stay finite in every rally');
  ck(out.every((r) => !r.stuck && r.points > 0), 'no endless rallies: every simulated rally ends', out.filter((r) => r.stuck));
  ck(Math.max(...out.map((r) => r.longestRally)) < 200, 'longest rally in ' + out.reduce((a, r) => a + r.points, 0) + ' points is ' + Math.max(...out.map((r) => r.longestRally)) + ' returns');
  ck(Math.max(...out.map((r) => r.fastest)) > 900, 'the old 900 cap is really gone', { fastestSeen: Math.max(...out.map((r) => r.fastest)) });
  const easy = out.filter((r) => r.label.indexOf('phone') >= 0);
  ck(cost.every((c) => c.ms < 50 && c.finite), 'a 50 ms frame hitch stays cheap even at 9,000,000 units/s', cost);
  console.log('INFO fastest ball per matchup: ' + out.map((r) => r.ball[0] + ':' + r.label.split(' ')[0] + '=' + r.fastest).join(', '));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
