// Shared by every test: loads the built page and gives each test its own temp folder.
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-pong-'));
const artifact = () => fs.readFileSync(path.join(__dirname, '..', 'dist', 'pocket-pong.artifact.html'), 'utf8');
module.exports = { tmp, artifact };
