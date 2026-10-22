import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api';

/**
 * What a failed request tells the person looking at the screen.
 *
 * Around 330 routes answer with `{ error: "…" }` and write that sentence for a
 * rep to read. The client used to look only at `.message`, find nothing, and
 * raise "HTTP 400" instead — so every refusal in the app arrived as a status
 * code. These pin the extraction down.
 */
const respond = (status: number, body: unknown, ok = false) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  })));
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('api error messages', () => {
  it('shows the sentence a route wrote in `error`', async () => {
    respond(400, { error: "Dana Whitfield's email doesn't look right." });
    await expect(api.get('/api/anything')).rejects.toThrow("Dana Whitfield's email doesn't look right.");
  });

  it('still reads `message` for the routes that use it', async () => {
    respond(400, { message: 'Pick a stage first.' });
    await expect(api.get('/api/anything')).rejects.toThrow('Pick a stage first.');
  });

  it('prefers `error` when a route sends both', async () => {
    respond(409, { error: 'This is signed — send a replacement.', message: 'Conflict' });
    await expect(api.post('/api/anything', {})).rejects.toThrow('This is signed — send a replacement.');
  });

  it('falls back to the status when the body carries no words', async () => {
    respond(502, {});
    await expect(api.get('/api/anything')).rejects.toThrow('HTTP 502');
  });

  it('falls back to the status when the body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, headers: new Map(),
      json: async () => { throw new SyntaxError('Unexpected token <'); },
      text: async () => '<html>502 Bad Gateway</html>',
    })));
    await expect(api.get('/api/anything')).rejects.toThrow('HTTP 500');
  });

  it('never surfaces a non-string error field as "[object Object]"', async () => {
    respond(500, { error: { code: 'P0001', detail: 'internal' } });
    await expect(api.get('/api/anything')).rejects.toThrow('HTTP 500');
  });
});
