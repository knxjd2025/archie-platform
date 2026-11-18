/**
 * A new serverless instance must answer its first request without doing any
 * per-company work. It used to seed every live company first (about 17
 * queries each, one company after another, retried every 60s while any
 * company failed). Seeding now happens when a company is created and through
 * an explicit backfill; this pins that the request path stays clear of it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const seedCalls = vi.hoisted(() => ({ seedAll: 0, seedCompany: 0 }));
vi.mock('../seed', async (importOriginal) => {
  const real = await importOriginal<typeof import('../seed')>();
  return {
    ...real,
    seedAll: vi.fn(async (...a: Parameters<typeof real.seedAll>) => { seedCalls.seedAll++; return real.seedAll(...a); }),
    seedCompany: vi.fn(async () => { seedCalls.seedCompany++; return real.seedCompany(); }),
  };
});

describe.skipIf(!local)('cold start', () => {
  let server: http.Server;
  let base = '';
  let connects = 0;

  beforeAll(async () => {
    const { pool } = await import('../db');
    const realConnect = pool.connect.bind(pool);
    vi.spyOn(pool, 'connect').mockImplementation(((...args: any[]) => { connects++; return (realConnect as any)(...args); }) as any);
    const { default: handler } = await import('../../api/index');
    server = http.createServer((req, res) => { handler(req as any, res as any); });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(() => { server?.close(); vi.restoreAllMocks(); });

  it('answers the first requests with no seeding and no database work', async () => {
    const [a, b] = await Promise.all([fetch(`${base}/api/ping`), fetch(`${base}/api/ping`)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(seedCalls).toEqual({ seedAll: 0, seedCompany: 0 });
    expect(connects).toBe(0);
  });
});
