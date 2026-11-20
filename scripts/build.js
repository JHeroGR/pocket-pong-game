// Builds three things from index.html + src/:
//   www/                          the folder Capacitor (iOS/Android) or any static host serves
//   dist/pocket-pong.single.html  one standalone file with CSS and JS inlined
//   dist/pocket-pong.artifact.html the same page without <html>/<head>/<body>, ready to publish as a Claude Artifact
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, c) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c); };

const index = read('index.html'), css = read('src/styles.css'), js = read('src/app.js');
const body = index.slice(index.indexOf('<body>') + 6, index.indexOf('<script src=')).trim();
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap">';
const safeJs = js.replace(/<\/script/gi, '<\\/script');

write('dist/pocket-pong.single.html', `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">\n<meta name="theme-color" content="#070707">\n<title>Pocket Pong</title>\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n<script>\n${safeJs}</script>\n</body>\n</html>\n`);
write('dist/pocket-pong.artifact.html', `<title>Pocket Pong</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>\n${css}</style>\n\n${body}\n\n<script>\n${safeJs}</script>\n`);

// www/ for Capacitor
fs.rmSync(path.join(root, 'www'), { recursive: true, force: true });
for (const f of ['index.html', 'manifest.webmanifest', 'src/styles.css', 'src/app.js']) write('www/' + f, read(f));
console.log('built www/, dist/pocket-pong.single.html, dist/pocket-pong.artifact.html');
