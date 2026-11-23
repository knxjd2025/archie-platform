/**
 * Migration 0020: roof_reports and roof_report_photos, against the real local
 * test database (scripts/test-db.sh) as the app's own role, with row level
 * security on. Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

/** SQLSTATE of a failed query (drizzle wraps pg errors in .cause). */
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

describe.skipIf(!local)('migration 0020: roof reports and their photos', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');

  const tag = `rr20-${process.pid}-${Date.now()}`;
  let a = '';
  let b = '';

  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });

  const insertReport = (company: string, extra: { types?: string; token?: string; legacy?: string; template?: string } = {}) =>
    runAsCompany(company, () => db.execute(sql`
      insert into roof_reports (address, report_types, share_token, legacy_id, template)
      values ('12 Elm Street', ${sql.raw(extra.types ?? "ARRAY['inspection']::text[]")}, ${extra.token ?? null}, ${extra.legacy ?? null}, ${sql.raw(extra.template ? `'${extra.template}'` : 'default')})
      returning id`));

  it('gives a row with only an address and a kind its plain starting values', async () => {
    const { rows } = await insertReport(a);
    const [row] = await runAsCompany(a, async () =>
      (await db.execute(sql`select status, template, email_sent_count, company_id from roof_reports where id = ${(rows[0] as { id: string }).id}`)).rows as any[]);
    expect(row.status).toBe('generating');
    expect(row.template).toBe('full');
    expect(row.email_sent_count).toBe(0);
    expect(row.company_id).toBe(a);
  });

  it('refuses a report with no kind, an unknown kind, or an unknown template', async () => {
    expect(await sqlState(insertReport(a, { types: "'{}'::text[]" }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(insertReport(a, { types: "ARRAY['roof']::text[]" }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(insertReport(a, { template: 'luxury' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(insertReport(a, { types: "ARRAY['storm','measurement','inspection']::text[]" }))).toBeNull();
  });

  it('refuses an unknown status and an unknown visual style', async () => {
    expect(await sqlState(runAsCompany(a, () => db.execute(sql`insert into roof_reports (address, report_types, status) values ('1 Oak', ARRAY['storm']::text[], 'done')`)))).toBe(CHECK_VIOLATION);
    expect(await sqlState(runAsCompany(a, () => db.execute(sql`insert into roof_reports (address, report_types, visual_style) values ('1 Oak', ARRAY['storm']::text[], 'neon')`)))).toBe(CHECK_VIOLATION);
  });

  it('keeps a share token unique across every company', async () => {
    const token = `${tag}-token`;
    expect(await sqlState(insertReport(a, { token }))).toBeNull();
    expect(await sqlState(insertReport(a, { token }))).toBe(UNIQUE_VIOLATION);
    // Another company may not reuse it either, so a link names one report.
    expect(await sqlState(insertReport(b, { token }))).toBe(UNIQUE_VIOLATION);
  });

  it('keeps a copied report\'s old id unique inside one company only', async () => {
    const legacy = `${tag}-legacy`;
    expect(await sqlState(insertReport(a, { legacy }))).toBeNull();
    expect(await sqlState(insertReport(a, { legacy }))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(insertReport(b, { legacy }))).toBeNull();
  });

  it('shows a company only its own reports and lets it change none of another\'s', async () => {
    const mark = `${tag}-iso`;
    const { rows } = await runAsCompany(a, () => db.execute(sql`insert into roof_reports (address, report_types, title) values ('9 Birch Lane', ARRAY['storm']::text[], ${mark}) returning id`));
    const id = (rows[0] as { id: string }).id;
    const seenByB = await runAsCompany(b, async () => (await db.execute(sql`select id from roof_reports where title = ${mark}`)).rows);
    expect(seenByB).toEqual([]);
    const touched = await runAsCompany(b, async () => (await db.execute(sql`update roof_reports set title = 'taken' where id = ${id} returning id`)).rows);
    expect(touched).toEqual([]);
    const gone = await runAsCompany(b, async () => (await db.execute(sql`delete from roof_reports where id = ${id} returning id`)).rows);
    expect(gone).toEqual([]);
    const seenByA = await runAsCompany(a, async () => (await db.execute(sql`select title from roof_reports where id = ${id}`)).rows as any[]);
    expect(seenByA[0].title).toBe(mark);
    // Nothing without a company at all, and nothing planted in another company.
    expect((await db.execute(sql`select id from roof_reports where id = ${id}`)).rows).toEqual([]);
    expect(await sqlState(runAsCompany(b, () => db.execute(sql`insert into roof_reports (company_id, address, report_types) values (${a}, 'x', ARRAY['storm']::text[])`)))).toBe('42501');
  });

  describe('photos', () => {
    const photo = (company: string, workingKey: string, thumbKey: string, reportId: string | null = null) =>
      runAsCompany(company, () => db.execute(sql`insert into roof_report_photos (report_id, working_key, thumb_key) values (${reportId}, ${workingKey}, ${thumbKey}) returning id`));

    it('accepts keys under the company\'s own prefix and refuses any other', async () => {
      const own = `c/${a}/rr/pending/p1`;
      expect(await sqlState(photo(a, `${own}/working.jpg`, `${own}/thumb.jpg`))).toBeNull();
      const other = `c/${b}/rr/pending/p2`;
      expect(await sqlState(photo(a, `${other}/working.jpg`, `${other}/thumb.jpg`))).toBe(CHECK_VIOLATION);
      // One good key and one foreign key is still refused.
      expect(await sqlState(photo(a, `${own}/working.jpg`, `${other}/thumb.jpg`))).toBe(CHECK_VIOLATION);
      // Under the company's job photo prefix is not a report photo.
      expect(await sqlState(photo(a, `c/${a}/p/x.jpg`, `c/${a}/p/y.jpg`))).toBe(CHECK_VIOLATION);
    });

    it('shows a company only its own photos, including through a join to the reports', async () => {
      const { rows } = await insertReport(a);
      const reportId = (rows[0] as { id: string }).id;
      const mine = `c/${a}/rr/${reportId}/m1`;
      await photo(a, `${mine}/w.jpg`, `${mine}/t.jpg`, reportId);
      // Company B has no foreign key to hold it back, so it can name A's report id on its own photo.
      const theirs = `c/${b}/rr/${reportId}/b1`;
      await photo(b, `${theirs}/w.jpg`, `${theirs}/t.jpg`, reportId);

      const joinedByA = await runAsCompany(a, async () => (await db.execute(sql`
        select p.working_key, p.company_id from roof_reports r join roof_report_photos p on p.report_id = r.id where r.id = ${reportId}`)).rows as any[]);
      expect(joinedByA.map((r) => r.working_key)).toEqual([`${mine}/w.jpg`]);
      expect(joinedByA.every((r) => r.company_id === a)).toBe(true);
      // B's join finds A's report nowhere, so B's own photo joins to nothing.
      const joinedByB = await runAsCompany(b, async () => (await db.execute(sql`
        select p.id from roof_reports r join roof_report_photos p on p.report_id = r.id where r.id = ${reportId}`)).rows);
      expect(joinedByB).toEqual([]);
      const aloneByB = await runAsCompany(b, async () => (await db.execute(sql`select id from roof_report_photos where working_key like ${`c/${a}/%`}`)).rows);
      expect(aloneByB).toEqual([]);
    });
  });

  it('is described by the Drizzle tables the app uses', async () => {
    const [row] = await runAsCompany(a, () => db.insert(schema.roofReports).values({ address: '12 Elm Street', city: 'Cedar Falls', reportTypes: ['storm', 'inspection'] }).returning());
    expect(row.companyId).toBe(a);
    expect(row.status).toBe('generating');
    expect(row.template).toBe('full');
    expect(row.emailSentCount).toBe(0);
    const id = randomUUID();
    const prefix = `c/${a}/rr/${row.id}/${id}`;
    const [p] = await runAsCompany(a, () => db.insert(schema.roofReportPhotos).values({ id, reportId: row.id, workingKey: `${prefix}/w.jpg`, thumbKey: `${prefix}/t.jpg` }).returning());
    expect(p.position).toBe(0);
    expect(await runAsCompany(b, () => db.select().from(schema.roofReports).where(eq(schema.roofReports.id, row.id)))).toEqual([]);
  });
});
