import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// watch_cursors has no unique index on (source, channel), so two sweeps racing
// on a new key can both insert. The read must take the newest row, or an SMS
// control command already applied reads its old mark and is applied again.
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/brain
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');
const source = `cursor-store-test-${Date.now()}`;

describe.skipIf(!onE2eDb)('getCursor with duplicate rows (bra_e2e)', () => {
  let db: typeof import('../../db').db;
  let watchCursors: typeof import('../../../shared/schema').watchCursors;
  let eq: typeof import('drizzle-orm').eq;
  let getCursor: typeof import('../cursor-store').getCursor;

  beforeAll(async () => {
    ({ db } = await import('../../db'));
    ({ watchCursors } = await import('../../../shared/schema'));
    ({ eq } = await import('drizzle-orm'));
    ({ getCursor } = await import('../cursor-store'));
  });
  afterAll(async () => {
    await db.delete(watchCursors).where(eq(watchCursors.source, source));
  });

  it('reads the last mark written, not whichever row comes first', async () => {
    await db.insert(watchCursors).values({ source, channel: 'conv-1', cursor: '1000' });
    await db.insert(watchCursors).values({ source, channel: 'conv-1', cursor: '2000' });
    expect(await getCursor(source, 'conv-1')).toBe('2000');
  });
});
