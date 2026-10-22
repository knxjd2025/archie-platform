import { describe, it, expect, vi } from 'vitest';

// Mock the db module so runSync doesn't hit Postgres in unit tests.
vi.mock('../../db', () => {
  const rows: any[] = [];
  return { db: {
    insert: () => ({ values: (v: any) => ({ returning: async () => { rows.push({ id: rows.length + 1, ...v }); return [rows[rows.length - 1]]; } }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    __rows: rows,
  } };
});

import { runSync, effectiveRunStatus, UNFINISHED_NOTE } from '../run';
import { db } from '../../db';

describe('runSync', () => {
  it('returns ok with counts when fn succeeds', async () => {
    const r = await runSync('jobtread', async () => ({ deals: 3, invoices: 2 }));
    expect(r.status).toBe('ok');
    expect(r.counts).toEqual({ deals: 3, invoices: 2 });
    expect(r.error).toBeUndefined();
  });

  it('captures error and does NOT throw when fn fails', async () => {
    const r = await runSync('calendar', async () => { throw new Error('boom'); });
    expect(r.status).toBe('error');
    expect(r.error).toContain('boom');
  });
});

describe('a run that is killed must not read as ok', () => {
  it('is inserted as not-ok until it records its own result', async () => {
    await runSync('leads', async () => ({ leads: 1 }));
    const rows = (db as any).__rows as any[];
    const inserted = rows[rows.length - 1];
    expect(inserted.status).toBe('error');
    expect(inserted.error).toBe(UNFINISHED_NOTE);
  });

  const started = new Date('2026-10-15T13:00:00Z');
  it('reads as running while young, failed once older than any run can live', () => {
    const row = { status: 'error', startedAt: started, finishedAt: null, error: UNFINISHED_NOTE };
    expect(effectiveRunStatus(row, new Date('2026-10-15T13:02:00Z'))).toEqual({ status: 'running', error: null });
    const late = effectiveRunStatus(row, new Date('2026-10-15T13:07:00Z'));
    expect(late.status).toBe('error');
    expect(late.error).toMatch(/never finished/);
  });

  it('a finished row reads as it was written', () => {
    expect(effectiveRunStatus({ status: 'ok', startedAt: started, finishedAt: new Date('2026-10-15T13:01:00Z'), error: null }, new Date('2026-10-15T15:00:00Z')))
      .toEqual({ status: 'ok', error: null });
  });
});
