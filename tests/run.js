// Runs every test file and fails if any prints a FAIL line or exits non-zero.
const { spawnSync } = require('child_process'); const path = require('path');
const files = ['sound-online.js', 'ball-size.js', 'title-and-defaults.js', 'layout.js', 'devices.js', 'packaged.js'];
let bad = 0, pass = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 180000 });
  const lines = (r.stdout || '').split('\n'); const p = lines.filter((l) => l.startsWith('PASS')).length, fl = lines.filter((l) => l.startsWith('FAIL'));
  const ok = r.status === 0 && fl.length === 0 && p > 0; if (!ok) bad++; pass += p;
  console.log((ok ? 'ok   ' : 'FAIL ') + f + '  (' + p + ' checks)'); fl.forEach((l) => console.log('       ' + l));
  if (!ok && !fl.length) console.log('       ' + (r.stderr || r.stdout || 'no output').slice(-400));
}
console.log(bad ? bad + ' test file(s) failed' : 'ALL ' + pass + ' CHECKS PASS'); process.exit(bad ? 1 : 0);
