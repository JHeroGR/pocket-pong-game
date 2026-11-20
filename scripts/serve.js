// Tiny static server for local play: node scripts/serve.js [port]   then open http://localhost:8080
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'www'), port = +process.argv[2] || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(port, () => console.log('Pocket Pong on http://localhost:' + port));
