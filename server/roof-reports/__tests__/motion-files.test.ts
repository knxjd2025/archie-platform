/**
 * The vendored motion files are loaded by a page that runs in a sandbox with no
 * origin of its own, with an integrity hash, so the browser needs the response
 * to allow it (CORS). The host's static files do; when the app serves them
 * itself (server/index.ts in production) this does.
 */
import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MOTION_PATH } from '../../lib/roof-reports/report-motion';
import { motionFilesCors } from '../motion-files';

describe('the motion folder\'s CORS answer', () => {
  const app = express();
  app.use(MOTION_PATH, motionFilesCors());
  app.get('*', (req, res) => { res.send('x'); });
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => { server.close(); });

  it('lets any origin read a file in the motion folder, without credentials', async () => {
    const r = await fetch(`${base}${MOTION_PATH}/gsap-3.14.2.min.js`);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-credentials')).toBeNull();
    expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('says nothing for any other address', async () => {
    for (const p of ['/api/anything', '/roof-reports/other/x.js', '/index.html']) {
      const r = await fetch(`${base}${p}`);
      expect(r.headers.get('access-control-allow-origin'), p).toBeNull();
    }
  });

  it('answers a preflight and allows only GET and HEAD', async () => {
    const r = await fetch(`${base}${MOTION_PATH}/gsap-3.14.2.min.js`, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toBe('GET, HEAD');
  });
});
