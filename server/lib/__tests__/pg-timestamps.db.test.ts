import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';

// A nudge written seconds earlier by defaultNow() read back four hours old,
// and the next sweep escalated at once: the local Postgres session ran in
// America/New_York while every read treats a naive timestamp as UTC. Production
// is UTC on both sides; vitest.config.ts pins the test process and session to
// match. This fails if either drifts, before a sweep test does. Runs against
// the local e2e database:
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/lib
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');
const tableName = `ts_probe_${Date.now()}`;
const probe = pgTable(tableName, {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  at: timestamp('at'),
  dflt: timestamp('dflt').defaultNow(),
});

const ageSeconds = (d: Date, from: Date) => Math.abs(d.getTime() - from.getTime()) / 1000;

describe.skipIf(!onE2eDb)('naive timestamps round-trip as the instant written (bra_e2e)', () => {
  let db: typeof import('../../db').db;
  let pool: typeof import('../../db').pool;
  let parseNaiveTimestampAsUtc: typeof import('../pg-timestamps').parseNaiveTimestampAsUtc;

  beforeAll(async () => {
    ({ db, pool } = await import('../../db'));
    ({ parseNaiveTimestampAsUtc } = await import('../pg-timestamps'));
    await pool.query(`CREATE TABLE ${tableName} (id serial primary key, label text not null, at timestamp, dflt timestamp default now())`);
  });
  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
  });

  it('runs where production runs: UTC process, UTC session', async () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    const { rows } = await pool.query('SHOW TimeZone');
    expect(rows[0].TimeZone).toBe('UTC');
  });

  it('defaultNow() and a Date through the column read back as now, by every path', async () => {
    const now = new Date();
    const [row] = await db.insert(probe).values({ label: 'orm', at: now }).returning();
    expect(ageSeconds(row.at!, now)).toBeLessThan(5);
    expect(ageSeconds(row.dflt!, now)).toBeLessThan(5);

    const [read] = await db.select().from(probe).where(eq(probe.label, 'orm'));
    expect(ageSeconds(read.dflt!, now)).toBeLessThan(5);

    const viaPool = await pool.query(`SELECT dflt FROM ${tableName} WHERE label = 'orm'`);
    expect(ageSeconds(viaPool.rows[0].dflt, now)).toBeLessThan(5);

    // db.execute keeps the bare text; it must be converted, not new Date()'d.
    const raw = await db.execute(sql`SELECT dflt FROM ${sql.identifier(tableName)} WHERE label = 'orm'`);
    const text = raw.rows[0].dflt as string;
    expect(typeof text).toBe('string');
    expect(ageSeconds(parseNaiveTimestampAsUtc(text), now)).toBeLessThan(5);
  });

  it('a Date passed as a raw sql parameter is stored as the same instant', async () => {
    const now = new Date();
    await db.execute(sql`INSERT INTO ${sql.identifier(tableName)} (label, at) VALUES ('raw', ${now})`);
    const [read] = await db.select().from(probe).where(eq(probe.label, 'raw'));
    expect(ageSeconds(read.at!, now)).toBeLessThan(1);
  });
});
