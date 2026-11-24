/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * A company's own presentation chapters (how its crew works, what its warranty
 * covers) are that company's DATA. They are never code, and never chosen by
 * matching a name, an email domain or a website. This holds, against the real
 * local test database as the app's own role with row level security on:
 *
 *   - a pack is read only for the company in context: company A's pack never
 *     renders for company B, and with no company there is no pack;
 *   - the app role can read only its own company's row and can never write one
 *     (insert, update, delete, move), whoever the company is;
 *   - only the operator script writes, through the system role with a written
 *     reason, and a dry run (the default) writes nothing;
 *   - the loader refuses a pack with problems, in plain sentences, and writes
 *     nothing for it (a phrase it must not say, a bad id, bad minutes, a field
 *     it has no place for, an unknown company, a file inside the repository);
 *   - no `.ts` file under server/ or shared/ holds the test's pack wording, and
 *     no file but the loader writes the table;
 *   - a pack's words are escaped when they are put on a page, and its
 *     {company} and {phone} come only from the company's own record.
 *
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { setPhotoStoreForTests } from '../../photos/store';
import type { ChapterPack } from '../../lib/roof-reports/presentation-chapters';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

/** Wording nobody would write by accident, so a copy of it in code is found. */
const PACK: ChapterPack = {
  chapters: [
    {
      id: 'summit-yard-care', label: 'Yard care', minutes: 2, after: 'condition', onlyWithWork: true,
      heading: 'How the Summit crew leaves the yard',
      ledes: ['Every nail is swept up with a magnet before the truck leaves Cedar Falls.', 'Flowerbeds are covered with tarps, never walked on.'],
      steps: [{ title: 'Tarps go down first', text: 'Before the first shingle comes off.' }],
      questions: [{ q: 'Will my dog be safe?', a: 'Keep the dog inside and the crew will keep the gate shut.' }],
      note: 'Questions at any time to {company}, on {phone}.',
    },
    {
      id: 'summit-aftercare', label: 'Aftercare', minutes: 1, after: 'estimate', onlyWithWork: false,
      heading: 'What happens after the last nail',
      ledes: ['A walk round with the foreman, with a list in your hand.'],
    },
  ],
  mustSay: ['swept up with a magnet'],
  mustNotSay: ['lifetime guarantee'],
};
const WORDS = [PACK.chapters[0].heading, PACK.chapters[0].ledes[0], PACK.chapters[0].questions![0].a, PACK.chapters[1].heading, PACK.chapters[1].ledes[0]];
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe.skipIf(!localDb)('chapter packs are company data (PERMANENT)', async () => {
  const tag = `rrpack-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { packForCurrentCompany } = await import('../packs');
  const { loadPack, parseLoaderArgs } = await import('../pack-loader');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { db, pool } = await import('../../db');
  const { presentationChapterPacks: packs } = await import('../../../shared/schema');

  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => fakeStorm(),
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => ({ findings: [], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
  });
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { deps: fakeDeps }));
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co; let reportA = ''; let reportB = '';
  const GOOD = { reportTypes: ['inspection', 'storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' };
  /** The owner removes a test pack: the system role may not delete one by design, and neither may the app. */
  async function ownerRemoves(...companyIds: string[]): Promise<void> {
    const url = process.env.ARCHIE_TEST_OWNER_URL;
    if (!url) return;
    const owner = new Client({ connectionString: url });
    await owner.connect();
    try {
      for (const id of companyIds) {
        await owner.query("select set_config('app.company_id', $1, false)", [id]);
        await owner.query('delete from presentation_chapter_packs where company_id = $1', [id]);
      }
    } finally { await owner.end(); }
  }
  const rowsOf = (company: string) => runAsCompany(company, () => db.select().from(packs), { loadProfile: false });

  async function makeReport(co: Co): Promise<string> {
    h.as(co, 'rep');
    const photos: string[] = [];
    for (let i = 0; i < 4; i++) photos.push((await h.upload('/api/roof-reports/photos', makeJpeg())).body.id);
    const id = (await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: photos })).body.id;
    await h.put(`/api/roof-reports/${id}`, { visualStyle: 'presentation' });
    return id;
  }

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
    a = await h.company('Summit Ridge Roofing', [['rep', 'sales']]);
    b = await h.company('Cedar Falls Roofing Two', [['rep', 'sales']]);
    reportA = await makeReport(a);
    reportB = await makeReport(b);
  });
  afterAll(async () => {
    await ownerRemoves(a.id, b.id);
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('gives a company with no pack the base presentation, which says none of a pack\'s words', async () => {
    __resetRateLimits();
    h.as(a, 'rep');
    expect(await runAsCompany(a.id, () => packForCurrentCompany())).toBeNull();
    const page = await h.get(`/api/roof-reports/${reportA}/html`);
    expect(page.status).toBe(200);
    for (const w of WORDS) expect(page.text).not.toContain(w);
  });

  it('writes nothing on a dry run, which is what the loader does unless it is told to apply', async () => {
    const r = await loadPack({ companyId: a.id, raw: PACK, apply: false, by: 'tester' });
    expect(r).toMatchObject({ ok: true, applied: false });
    expect(await rowsOf(a.id)).toEqual([]);
  });

  it('writes a pack through the system role, once a company, and says who loaded it', async () => {
    const r = await loadPack({ companyId: a.id, raw: PACK, apply: true, by: 'tester' });
    expect(r).toMatchObject({ ok: true, applied: true, replaced: false });
    const [row] = await rowsOf(a.id);
    expect(row.companyId).toBe(a.id);
    expect(row.loadedBy).toBe('tester');
    expect(row.pack).toEqual(PACK);
    // Again: replaced, still one row.
    const again = await loadPack({ companyId: a.id, raw: { ...PACK, mustSay: [] }, apply: true, by: 'second' });
    expect(again).toMatchObject({ ok: true, applied: true, replaced: true });
    const rows = await rowsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].loadedBy).toBe('second');
    await loadPack({ companyId: a.id, raw: PACK, apply: true, by: 'tester' });
  });

  it('reads a pack only for the company in context: B never sees A\'s, and with no company there is none', async () => {
    expect(await runAsCompany(a.id, () => packForCurrentCompany())).toEqual(PACK);
    expect(await runAsCompany(b.id, () => packForCurrentCompany())).toBeNull();
    expect(await packForCurrentCompany()).toBeNull();
    expect((await rowsOf(a.id)).map((r) => r.companyId)).toEqual([a.id]);
    expect(await rowsOf(b.id)).toEqual([]);
    const none = await pool.query('select count(*)::int as n from presentation_chapter_packs');
    expect(none.rows[0].n).toBe(0); // no company in context: nothing is visible
  });

  it('shows the pack on A\'s presentation, filled from A\'s own record, and on nobody else\'s', async () => {
    __resetRateLimits();
    h.as(a, 'rep');
    const pageA = await h.get(`/api/roof-reports/${reportA}/html`);
    expect(pageA.status).toBe(200);
    expect(pageA.text).toContain('id="summit-yard-care"');
    expect(pageA.text).toContain(PACK.chapters[0].heading);
    expect(pageA.text).toContain('Questions at any time to Summit Ridge Roofing, on ');
    h.as(b, 'rep');
    const pageB = await h.get(`/api/roof-reports/${reportB}/html`);
    expect(pageB.status).toBe(200);
    for (const w of WORDS) expect(pageB.text).not.toContain(w);
    expect(pageB.text).not.toContain('summit-yard-care');
  });

  it('fills each company\'s placeholders from that company\'s own record, never from another\'s', async () => {
    const own = { ...PACK, chapters: [{ ...PACK.chapters[0], id: 'cedar-own', note: 'Written for {company}.' }, PACK.chapters[1]] };
    await loadPack({ companyId: b.id, raw: own, apply: true, by: 'tester' });
    try {
      __resetRateLimits();
      h.as(b, 'rep');
      const pageB = await h.get(`/api/roof-reports/${reportB}/html`);
      expect(pageB.text).toContain('Written for Cedar Falls Roofing Two.');
      expect(pageB.text).not.toContain('Summit Ridge Roofing');
      h.as(a, 'rep');
      const pageA = await h.get(`/api/roof-reports/${reportA}/html`);
      expect(pageA.text).not.toContain('Cedar Falls Roofing Two');
      expect(pageA.text).not.toContain('cedar-own');
    } finally {
      await ownerRemoves(b.id);
    }
  });

  it('lets the app role read its own row and never write one: not insert, update, delete or move, for any company', async () => {
    const before = await rowsOf(a.id);
    expect(before).toHaveLength(1);
    const code = (fn: () => Promise<unknown>, company: string) => sqlState(runAsCompany(company, fn, { loadProfile: false }));
    const insertFor = (company: string) => () => db.execute(sql`insert into presentation_chapter_packs (company_id, pack, loaded_by) values (${company}, '{"chapters":[],"mustSay":[],"mustNotSay":[]}'::jsonb, 'app')`);
    expect(await code(insertFor(b.id), a.id)).toBe('42501');
    expect(await code(insertFor(b.id), b.id)).toBe('42501'); // its own company too: the app never writes a pack
    expect(await code(() => db.update(packs).set({ pack: { chapters: [], mustSay: [], mustNotSay: [] } }).where(eq(packs.companyId, a.id)), a.id)).toBe('42501');
    expect(await code(() => db.update(packs).set({ companyId: b.id }).where(eq(packs.companyId, a.id)), a.id)).toBe('42501');
    expect(await code(() => db.delete(packs).where(eq(packs.companyId, a.id)), a.id)).toBe('42501');
    // Another company's row is not even visible, so touching it changes nothing and errors nothing.
    const touched = await runAsCompany(b.id, () => db.update(packs).set({ loadedBy: 'x' }).where(eq(packs.companyId, a.id)).returning(), { loadProfile: false });
    expect(touched).toEqual([]);
    expect(await rowsOf(a.id)).toEqual(before);
    expect(await rowsOf(b.id)).toEqual([]);
  });

  it('lets the system role read, insert and update a pack but never delete one', async () => {
    const code = await sqlState(runAsSystem('test: a pack is replaced, never deleted', () => db.delete(packs).where(eq(packs.companyId, a.id))));
    expect(code).toBe('42501');
    expect(await rowsOf(a.id)).toHaveLength(1);
  });

  describe('the loader refuses a pack with problems, says why in plain sentences, and writes nothing', () => {
    const refused = async (raw: unknown, company = b.id, expectIn?: string) => {
      const r = await loadPack({ companyId: company, raw, apply: true, by: 'tester' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.problems.length).toBeGreaterThan(0);
      for (const sentence of r.problems) {
        expect(sentence).toMatch(/^[A-Z]/);
        expect(sentence).not.toMatch(/at \w+ \(|node_modules|[0-9a-f]{8}-[0-9a-f]{4}/);
      }
      if (expectIn) expect(r.problems.join(' ')).toContain(expectIn);
      expect(await rowsOf(b.id)).toEqual([]);
    };

    it('a pack that says something it must not say', () => refused({ ...PACK, chapters: [{ ...PACK.chapters[0], ledes: ['We give a lifetime guarantee.'] }, PACK.chapters[1]] }, b.id, 'lifetime guarantee'));
    it('a pack that does not say something it must', () => refused({ ...PACK, mustSay: ['a promise nobody wrote'] }, b.id, 'a promise nobody wrote'));
    it('a bad id', () => refused({ ...PACK, chapters: [{ ...PACK.chapters[0], id: 'Bad Id!' }, PACK.chapters[1]] }));
    it('bad minutes', () => refused({ ...PACK, chapters: [{ ...PACK.chapters[0], minutes: 5000 }, PACK.chapters[1]] }));
    it('a field a pack has no place for', () => refused({ ...PACK, chapters: [{ ...PACK.chapters[0], script: 'x' }, PACK.chapters[1]] }, b.id, '"script"'));
    it('markup in its words', () => refused({ ...PACK, chapters: [{ ...PACK.chapters[0], heading: '<img src=x onerror=1>' }, PACK.chapters[1]] }));
    it('a company that is not there', async () => {
      const r = await loadPack({ companyId: '00000000-0000-4000-8000-000000000000', raw: PACK, apply: true, by: 'tester' });
      expect(r).toEqual({ ok: false, problems: ['There is no company with that id.'] });
    });
    it('something that is not a company id', async () => {
      const r = await loadPack({ companyId: 'summit-ridge', raw: PACK, apply: true, by: 'tester' });
      expect(r.ok).toBe(false);
    });
  });

  describe('the operator script\'s arguments', () => {
    const REPO = path.resolve(__dirname, '../../..');
    it('needs a company and a file, and does a dry run unless told --apply', () => {
      expect(parseLoaderArgs(['--file', '/tmp/pack.json'], REPO)).toMatchObject({ ok: false });
      expect(parseLoaderArgs(['--company', a.id], REPO)).toMatchObject({ ok: false });
      expect(parseLoaderArgs(['--company', 'not-a-uuid', '--file', '/tmp/pack.json'], REPO)).toMatchObject({ ok: false });
      expect(parseLoaderArgs(['--company', a.id, '--file', '/tmp/pack.json'], REPO)).toEqual({ ok: true, companyId: a.id, file: '/tmp/pack.json', apply: false });
      expect(parseLoaderArgs(['--company', a.id, '--file', '/tmp/pack.json', '--apply'], REPO)).toMatchObject({ ok: true, apply: true });
    });
    it('refuses a file inside the repository, however it is written', () => {
      for (const file of [path.join(REPO, 'pack.json'), path.join(REPO, 'server/x/../pack.json'), 'pack.json', './docs/pack.json']) {
        const r = parseLoaderArgs(['--company', a.id, '--file', file], REPO, REPO);
        expect(r, file).toMatchObject({ ok: false });
      }
    });
  });

  it('holds none of a pack\'s wording in code, and lets nothing but the loader write the table', () => {
    const root = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '__tests__') continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(path.join(root, 'server'));
    walk(path.join(root, 'shared'));
    walk(path.join(root, 'client/src'));
    expect(files.length).toBeGreaterThan(300);
    const wording: string[] = []; const writers: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const w of WORDS) if (text.includes(w)) wording.push(`${path.relative(root, f)}: ${w}`);
      if (/(insert|update|delete)\(\s*presentationChapterPacks\b/.test(text) || /(insert into|update|delete from)\s+"?presentation_chapter_packs/i.test(text)) writers.push(path.relative(root, f));
    }
    expect(wording).toEqual([]);
    expect(writers.sort()).toEqual(['server/roof-reports/pack-loader.ts']);
    // And the scripts folder: the only caller of the loader is the operator script.
    const scripts = readdirSync(path.join(root, 'scripts')).filter((n) => n.endsWith('.ts')).filter((n) => /presentationChapterPacks|presentation_chapter_packs/.test(readFileSync(path.join(root, 'scripts', n), 'utf8')));
    expect(scripts).toEqual([]);
  });
});
