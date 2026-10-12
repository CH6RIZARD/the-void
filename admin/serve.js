// Poll admin, local only: node admin/serve.js  ->  http://localhost:5178
// Serves admin/polls.html with the public Supabase URL + anon key from
// void-app/src/core/env.ts. Everything privileged is checked in the database
// (migration 013): signing in as a non-admin account can't change anything.
const http = require('http');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '../void-app/src/core/env.ts'), 'utf8');
const pick = (name) => (env.match(new RegExp(name + "\\s*=\\s*'([^']+)'")) || [])[1];
const cfg = { url: pick('SUPABASE_URL_DEFAULT'), key: pick('SUPABASE_ANON_KEY_DEFAULT') };
if (!cfg.url || !cfg.key) throw new Error('Supabase URL/key not found in void-app/src/core/env.ts');

const PORT = +process.env.PORT || 5178;
http.createServer((req, res) => {
  if (req.url !== '/' && !req.url.startsWith('/?')) { res.writeHead(404); return res.end(); }
  const html = fs.readFileSync(path.join(__dirname, 'polls.html'), 'utf8').replace('/*CFG*/null', JSON.stringify(cfg));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}).listen(PORT, '127.0.0.1', () => console.log('Poll admin: http://localhost:' + PORT));
