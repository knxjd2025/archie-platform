// A cookie-injecting proxy so the Chrome extension can browse the local app
// as a signed-in user without an OAuth round trip. Forwards :4000 -> :3999
// and adds the forged session cookie to every request.
import http from 'node:http';
const COOKIE = process.env.E2E_COOKIE;
const TARGET = { host: '127.0.0.1', port: Number(process.env.E2E_TARGET_PORT || 3999) };
import fs from 'node:fs'; import path from 'node:path';
http.createServer((req, res) => {
  if (req.url.startsWith('/__e2e/')) { // same-origin wrappers so the share links can be framed at tablet widths
    const f = path.join(process.cwd(), req.url.slice(7).split('?')[0]);
    try { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(f)); } catch { res.writeHead(404); res.end(); }
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${TARGET.port}`, cookie: COOKIE };
  const up = http.request({ ...TARGET, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(Number(process.env.E2E_PROXY_PORT || 4000), '127.0.0.1', () => console.log('proxy up'));
