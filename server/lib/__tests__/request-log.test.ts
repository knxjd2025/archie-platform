/**
 * The request log and the bug log never hold a photo link's token.
 *
 * A report page shows its photos from short signed links whose token is part of
 * the address (the sandboxed page has no cookie, no header and no script that
 * may connect anywhere, so an address is all an image has). The token works for
 * ten minutes. It must not be written down by the app: not in the request log
 * (both entrypoints use requestLogger) and not in the address a recorded server
 * failure keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loggablePath, requestLogger } from '../request-log';

const TOKEN = 'eyJjIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIn0.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc';

describe('loggablePath', () => {
  it('hides the token of a photo link and leaves the rest of the address', () => {
    expect(loggablePath(`/api/roof-reports/linked-photo/${TOKEN}`)).toBe('/api/roof-reports/linked-photo/[token]');
    expect(loggablePath('/api/roof-reports/linked-photo/x')).toBe('/api/roof-reports/linked-photo/[token]');
  });

  it('leaves every other address as it is', () => {
    for (const p of ['/api/roof-reports', '/api/roof-reports/linked-photo', '/api/roof-reports/linked-photo/', '/api/roof-reports/4b0f/photos/9c1e/thumb', '/api/clients/abc/roof-reports', '/api/user', '/']) {
      expect(loggablePath(p), p).toBe(p);
    }
  });

  it('hides it wherever the address sits in a longer string, and in a full URL', () => {
    expect(loggablePath(`https://app.example.test/api/roof-reports/linked-photo/${TOKEN}?x=1`)).toBe('https://app.example.test/api/roof-reports/linked-photo/[token]?x=1');
    expect(loggablePath(`GET /api/roof-reports/linked-photo/${TOKEN} 200`)).toBe('GET /api/roof-reports/linked-photo/[token] 200');
  });

  it('never throws for what is not a string', () => {
    expect(loggablePath(undefined as unknown as string)).toBe('');
    expect(loggablePath(null as unknown as string)).toBe('');
  });
});

describe('requestLogger', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  async function lines(path: string): Promise<string[]> {
    const out: string[] = [];
    const app = express();
    app.use(requestLogger((line: string) => out.push(line)));
    app.get('/api/*', (_req, res) => res.status(200).end('ok'));
    server = app.listen(0);
    await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 20));
    return out;
  }

  it('writes one line for an API request: the method, the address, the status and the time', async () => {
    const out = await lines('/api/user');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^GET \/api\/user 200 - \d+ms$/);
  });

  it('writes the address of a photo link without its token', async () => {
    const out = await lines(`/api/roof-reports/linked-photo/${TOKEN}`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^GET \/api\/roof-reports\/linked-photo\/\[token\] 200 - \d+ms$/);
    expect(out.join('\n')).not.toContain(TOKEN);
    expect(out.join('\n')).not.toContain(TOKEN.slice(0, 20));
  });

  it('writes nothing for an address outside the API', async () => {
    const out: string[] = [];
    const app = express();
    app.use(requestLogger((line: string) => out.push(line)));
    app.get('/health', (_req, res) => res.end('ok'));
    server = app.listen(0);
    await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 20));
    expect(out).toEqual([]);
  });
});

describe('the entrypoints use it, and nothing else writes a request address down raw', () => {
  it('both entrypoints mount requestLogger instead of logging req.path themselves', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['server/index.ts', 'api/index.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toContain('requestLogger');
      expect(text, file).not.toMatch(/console\.log\(`\$\{req\.method\} \$\{(path|reqPath)\}/);
    }
  });
});

describe('a recorded server failure keeps no token in its address', () => {
  it('stores the address of a photo link with the token hidden', async () => {
    vi.resetModules();
    const recorded: any[] = [];
    vi.doMock('../../bugs/store', async (orig) => ({ ...(await orig<object>()), recordCaughtError: async (row: any) => { recorded.push(row); return { id: 1, firstTime: false, reopened: false }; } }));
    vi.doMock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { void p; } }));
    const { recordServerError } = await import('../../bugs/routes');
    recordServerError('GET /api/roof-reports/linked-photo/:token', new Error('boom'), {
      originalUrl: `/api/roof-reports/linked-photo/${TOKEN}`, method: 'GET', session: {},
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('/api/roof-reports/linked-photo/[token]');
    expect(JSON.stringify(recorded[0])).not.toContain(TOKEN);
    vi.doUnmock('../../bugs/store'); vi.doUnmock('@vercel/functions');
  });
});
