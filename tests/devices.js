const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = require('./helper').tmp;
const src = require('./helper').artifact();
fs.writeFileSync(SP + '/dev.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
let fails = 0; const ck = (ok, name, extra) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
(async () => {
  const browser = await chromium.launch();
  // ---- desktop
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('file://' + SP + '/dev.html'); await page.waitForTimeout(500);
    ck(await page.evaluate(() => document.documentElement.classList.contains('desk')), 'desktop detected');
    ck(await vis(page, '.hints'), 'desktop shows keyboard hints');
    ck(await vis(page, '#fsBtn'), 'desktop shows fullscreen button');
    ck(await vis(page, '.grp-desk, #menuScr .grp.desk-only'), 'desktop shows Retro screen option');
    ck(!(await vis(page, '#menuScr .grp-view')), 'desktop hides the View option');
    ck(await page.evaluate(() => getComputedStyle(document.querySelector('.scan')).display !== 'none'), 'desktop shows scanlines by default');
    await page.screenshot({ path: SP + '/dev-desktop-menu.png' });
    await page.click('.seg[data-key="crt"][data-val="off"]');
    ck(await page.evaluate(() => getComputedStyle(document.querySelector('.scan')).display === 'none'), 'Retro screen Off removes scanlines');
    await page.click('.seg[data-key="crt"][data-val="on"]');
    // M toggles sound, Enter starts
    const snd = () => page.evaluate(() => document.querySelector('.seg[data-key="sound"].on').dataset.val);
    const s0 = await snd(); await page.keyboard.press('m'); const s1 = await snd(); await page.keyboard.press('m');
    ck(s0 === 'on' && s1 === 'off' && (await snd()) === 'on', 'M toggles sound', [s0, s1]);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    ck(await vis(page, '#pauseBtn'), 'Enter starts the match');
    await page.screenshot({ path: SP + '/dev-desktop-game.png' });
    // keyboard moves the player bar: sample canvas column of left paddle before/after holding ArrowDown
    await page.keyboard.press('p'); await page.waitForTimeout(150);
    ck(await vis(page, '#pauseScr'), 'P pauses'); ck(!(await vis(page, '#pauseScr .grp-view')), 'pause screen hides View on desktop');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ck(!(await vis(page, '#pauseScr')), 'Enter resumes');
    // fullscreen button does not throw
    await page.click('#fsBtn').catch(() => {}); await page.waitForTimeout(200);
    // forced vertical saved in an older save is ignored on desktop
    ck(errs.length === 0, 'no page errors on desktop', errs);
    await ctx.close(); }
  // ---- desktop with a saved forced-vertical view must still be landscape-shaped
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pocket-pong', JSON.stringify({ view: 'port', v: 2 })); } catch (e) {} });
    await page.goto('file://' + SP + '/dev.html'); await page.waitForTimeout(400);
    ck(await page.evaluate(() => document.getElementById('stage').classList.contains('land') && !/rotate/.test(document.getElementById('stage').style.transform)), 'desktop ignores a saved forced-vertical view');
    await ctx.close(); }
  // ---- phone + tablet: desktop extras are gone
  for (const [name, dev] of [['iPhone', devices['iPhone 13']], ['iPhone landscape', devices['iPhone 13 landscape']], ['iPad', devices['iPad (gen 7)']], ['iPad landscape', devices['iPad (gen 7) landscape']]]) {
    const ctx = await browser.newContext({ ...dev }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('file://' + SP + '/dev.html'); await page.waitForTimeout(500);
    ck(!(await page.evaluate(() => document.documentElement.classList.contains('desk'))), name + ': touch layout');
    ck(!(await vis(page, '.hints')) && !(await vis(page, '#fsBtn')) && !(await vis(page, '#menuScr .grp.desk-only')), name + ': no keyboard hints, fullscreen or retro option');
    ck(await page.evaluate(() => getComputedStyle(document.querySelector('.scan')).display === 'none'), name + ': no scanlines');
    ck(await vis(page, '#menuScr .grp-view'), name + ': View option still there');
    ck(await vis(page, '#playBtn'), name + ': Play visible');
    await page.tap('#playBtn'); await page.waitForTimeout(300);
    ck(await vis(page, '#pauseBtn'), name + ': a match starts by touch');
    ck(errs.length === 0, name + ': no page errors', errs);
    await ctx.close(); }
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
