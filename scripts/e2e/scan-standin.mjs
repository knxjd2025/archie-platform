/**
 * A stand-in for the vision provider the commercial photo scan calls.
 *
 * run.sh points the server's COMMERCIAL_SCAN_ENDPOINT here. It answers in the
 * provider's own shape, keyed off the photo's url, so the scan runs end to end
 * — request, parse, write onto the report, render — without a paid call.
 *
 *   url contains "seam"        a failed seam, with one issue
 *   url contains "unreadable"  HTTP 500, as a provider outage would
 *   anything else              a clean roof drain
 */
import http from 'node:http';

export async function startScanStandIn(port = Number(process.env.E2E_SCAN_PORT || 3998)) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let url = '';
      try { url = JSON.parse(body).messages[1].content.find((x) => x.type === 'image_url').image_url.url; } catch {}
      calls.push(url);
      if (/unreadable/.test(url)) { res.writeHead(500); res.end('{}'); return; }
      const answer = /seam/.test(url)
        ? { usable: true, component: 'seams', caption: 'Open seam along a field lap', observation: 'The lap has opened for about two feet.', condition: 'failed', issues: [{ label: 'Open seam', detail: 'The lap is open at the centre of the frame.', severity: 'high' }] }
        : { usable: true, component: 'drains', caption: 'Roof drain with strainer', observation: 'The strainer is in place and the bowl is clear.', condition: 'good', issues: [] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(answer) + '\n```' } }] }));
    });
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  server.unref();
  return { calls, close: () => new Promise((ok) => server.close(ok)) };
}
