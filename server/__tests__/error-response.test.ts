import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { clientErrorMessage, createErrorHandler, errorStatus, GENERIC_SERVER_ERROR } from '../lib/error-response';

/**
 * The last-resort error handler sent err.message for every status, so in
 * production a failed query answered the browser with Drizzle's "Failed query:
 * select ... params: ..." — SQL and the customer values bound into it.
 */
const DRIZZLE = 'Failed query: select "id", "phone" from "leads" where "email" = $1\nparams: dana@example.com';

const record = vi.fn();
let server: Server;
let base = '';
const savedEnv = process.env.NODE_ENV;

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.get('/boom', () => { throw new Error(DRIZZLE); });
  app.get('/teapot', () => { throw Object.assign(new Error('Pick a product first.'), { status: 422 }); });
  app.get('/weird', () => { throw Object.assign(new Error(DRIZZLE), { status: 'nope' }); });
  app.use(createErrorHandler(record));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { process.env.NODE_ENV = savedEnv; record.mockReset(); });

describe('the last-resort error handler', () => {
  it('in production, a 5xx gets generic copy and no stack — the detail goes to the log', async () => {
    process.env.NODE_ENV = 'production';
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ message: GENERIC_SERVER_ERROR });
    expect(JSON.stringify(body)).not.toContain('leads');
    expect(record).toHaveBeenCalledTimes(1);
    expect((record.mock.calls[0][1] as Error).message).toBe(DRIZZLE);
  });

  it('keeps a deliberate 4xx message, which is meant to be read', async () => {
    process.env.NODE_ENV = 'production';
    const res = await fetch(`${base}/teapot`);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe('Pick a product first.');
    expect(record).not.toHaveBeenCalled();
  });

  it('treats a nonsense status as a 500, and masks it', async () => {
    process.env.NODE_ENV = 'production';
    const res = await fetch(`${base}/weird`);
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe(GENERIC_SERVER_ERROR);
  });

  it('outside production, still shows the real message and stack for debugging', async () => {
    process.env.NODE_ENV = 'development';
    const body = await (await fetch(`${base}/boom`)).json();
    expect(body.message).toBe(DRIZZLE);
    expect(body.stack).toContain('Error');
  });
});

describe('errorStatus / clientErrorMessage', () => {
  it('reads status or statusCode, and only an error range', () => {
    expect(errorStatus({ status: 404 })).toBe(404);
    expect(errorStatus({ statusCode: 413 })).toBe(413);
    expect(errorStatus({ status: 200 })).toBe(500);
    expect(errorStatus(null)).toBe(500);
    expect(errorStatus('x')).toBe(500);
  });
  it('masks every 5xx in production, whatever it says', () => {
    expect(clientErrorMessage(new Error('Pick a product.'), 503, true)).toBe(GENERIC_SERVER_ERROR);
    expect(clientErrorMessage({ message: 'Bad input' }, 400, true)).toBe('Bad input');
    expect(clientErrorMessage(undefined, 400, true)).toBe('Request failed');
  });
});
