/**
 * Crews and install dates (Stage D), through the real request path against
 * the local test database: docs/archie/02-roof-lee-link.md, "Crews and
 * install dates".
 *
 * Holds: the office of a company Roof Lee made sets up crews, books an
 * install from the job and sees it on the crew week in the company's own
 * dates; a crew member sees only their crew's jobs, starts one, ticks a
 * trade, adds a During photo and finishes it, and each step is recorded as a
 * milestone; the homeowner's phone reaches the crew only for its own job and
 * only on install days, from the first to the end of the last,
 * in the company's dates (D9), and the homeowner's email never; another crew's job, another company's job and every route that
 * opens a job through ownsLead stay 404 for a crew; a salesperson cannot book
 * crews; and a company Roof Lee did not make gets 404 on every one of these,
 * with its production board unchanged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { localDb, startCrewApp, type Co } from './harness';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  const { throwingClient } = await import('./harness');
  return { ...real, JobTreadClient: throwingClient('jobtread') };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  const { throwingClient } = await import('./harness');
  return { ...real, GoHighLevelClient: throwingClient('kynexPro') };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

/** SQLSTATE of a failed query (drizzle wraps pg errors in .cause). */
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe.skipIf(!localDb)('crews and install dates', async () => {
  const tag = `crews-${process.pid}-${Date.now()}`;
  const h = await startCrewApp(tag);
  const { db, schema, runAsCompany, as, get, post, put, patch, del } = h;
  const { and, eq } = await import('drizzle-orm');
  const { setPhotoStoreForTests } = await import('../../photos/store');
  const { isNativeJobId } = await import('../../production/native-jobs');
  const { ONLY_CREW_PEOPLE, CREW_NAME_TAKEN, STARTED_CANNOT_CLEAR, CREW_STEP_NOT_ALLOWED, CREW_IN_USE } = await import('../store');
  const { CREW_PHOTO_PHASE, CREW_NOT_ON_BOARD } = await import('../routes');
  const { PICK_CREW } = await import('../../../shared/crews');

  const stored = new Map<string, Buffer>();
  const fakeStore = {
    put: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); },
    get: async (key: string) => { const b = stored.get(key); return b ? { body: Readable.from(b), length: b.length } : null; },
  };

  let a: Co; let b: Co; let original: Co;
  let outside: string[] = [];

  beforeAll(async () => {
    // Far from Eastern time on purpose: every date below must be this company's own.
    a = await company('Summit Ridge Roofing', true, [
      ['owner', 'admin'], ['office', 'customer_service'], ['rep', 'sales'], ['crew', 'production'], ['crew2', 'production'], ['idle', 'production'],
    ], { timeZone: 'Pacific/Kiritimati' });
    b = await company('Cedar Falls Roofing', true, [['owner', 'admin'], ['office', 'customer_service'], ['rep', 'sales'], ['crew', 'production']]);
    original = await company('Cedar Falls Exteriors', false, [['owner', 'admin'], ['office', 'customer_service'], ['crew', 'production']]);
    setPhotoStoreForTests(fakeStore);
  });
  afterAll(() => { setPhotoStoreForTests(null); h.server.close(); });
  beforeEach(() => { outside = h.blockOutside(); });
  afterEach(() => { expect(outside).toEqual([]); vi.restoreAllMocks(); });

  function company(...args: Parameters<typeof h.company>) { return h.company(...args); }

  /** A native lead made on the lead form by the company's rep, put on the production board. */
  async function nativeJob(c: Co = a, phone = '(319) 555-0142'): Promise<string> {
    as(c, 'rep');
    const r = await post('/api/leads/create', { firstName: 'Pat', lastName: 'Hollis', phone, email: 'pat.hollis@example.test', address: '12 Main St', city: 'Cedar Falls', state: 'IA' });
    expect(r.status).toBe(200);
    expect(isNativeJobId(r.body.jobId)).toBe(true);
    // A price on the job, so a crew could only fail to see it.
    await runAsCompany(c.id, () => db.update(schema.leads).set({ projectedValue: '18450.00' }).where(eq(schema.leads.externalId, r.body.jobId)));
    as(c, 'office');
    expect((await post(`/api/production/${r.body.jobId}/pipeline/stage`, { stage: 'approved' })).status).toBe(200);
    return r.body.jobId;
  }

  async function crewWith(c: Co, name: string, people: string[]): Promise<string> {
    as(c, 'office');
    const made = await post('/api/crews', { name });
    expect(made.status).toBe(200);
    const set = await put(`/api/crews/${made.body.crew.id}/members`, { memberIds: people.map((p) => c.people[p].id) });
    expect(set.status).toBe(200);
    return made.body.crew.id;
  }

  const milestones = (c: Co, key: string) => runAsCompany(c.id, () =>
    db.select().from(schema.jobMilestones).where(eq(schema.jobMilestones.jobKey, key)).orderBy(schema.jobMilestones.occurredAt));

  // ---------------------------------------------------------------- the tables

  it('lets a crew member or an install name only a crew of the same company', async () => {
    const crewA = await crewWith(a, `Iso ${tag}`, []);
    const key = await nativeJob(b);
    expect(await sqlState(runAsCompany(b.id, () => db.insert(schema.crewMembers).values({ crewId: crewA, teamMemberId: b.people.crew.id })))).toBe('23503');
    expect(await sqlState(runAsCompany(b.id, () => db.insert(schema.crewAssignments).values({ crewId: crewA, jobKey: key, installDate: '2026-11-23' })))).toBe('23503');
    // And company B cannot see company A's crew at all.
    expect(await runAsCompany(b.id, () => db.select().from(schema.crews).where(eq(schema.crews.id, crewA)))).toEqual([]);
  });

  // ---------------------------------------------------------------- the office

  it('sets up crews from Production people only, one crew each', async () => {
    as(a, 'office');
    const red = await crewWith(a, `Red ${tag}`, ['crew']);
    const blue = await crewWith(a, `Blue ${tag}`, ['crew2']);
    expect((await post('/api/crews', { name: `red ${tag}` }))).toMatchObject({ status: 409, body: { error: CREW_NAME_TAKEN } });
    expect(await put(`/api/crews/${red}/members`, { memberIds: [a.people.rep.id] })).toMatchObject({ status: 400, body: { error: ONLY_CREW_PEOPLE } });
    // Another company's person is not there for this company.
    expect(await put(`/api/crews/${red}/members`, { memberIds: [b.people.crew.id] })).toMatchObject({ status: 400, body: { error: ONLY_CREW_PEOPLE } });
    // Moving a person to another crew takes them off the first.
    expect((await put(`/api/crews/${blue}/members`, { memberIds: [a.people.crew2.id, a.people.crew.id] })).status).toBe(200);
    const list = await get('/api/crews');
    expect(list.status).toBe(200);
    const byId = new Map(list.body.crews.map((c: any) => [c.id, c]));
    expect((byId.get(red) as any).members).toEqual([]);
    expect((byId.get(blue) as any).members.map((m: any) => m.id).sort()).toEqual([a.people.crew.id, a.people.crew2.id].sort());
    expect(list.body.people.map((p: any) => p.id)).toEqual(expect.arrayContaining([a.people.crew.id, a.people.crew2.id, a.people.idle.id]));
    expect(list.body.people.map((p: any) => p.id)).not.toContain(a.people.rep.id);
    // Put them back for the tests below.
    expect((await put(`/api/crews/${red}/members`, { memberIds: [a.people.crew.id] })).status).toBe(200);
  });

  it('books an install from the job, shows it on the crew week in company dates, and records each scheduling', async () => {
    const red = await crewWith(a, `Week ${tag}`, ['idle']);
    const key = await nativeJob();
    as(a, 'office');

    const before = await get(`/api/crews/week?week=2026-11-25`);
    expect(before.status).toBe(200);
    expect(before.body.weekStart).toBe('2026-11-23');
    expect(before.body.days).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(before.body.unbooked.map((u: any) => u.jobKey)).toContain(key);
    // "Today" is the company's own date, not the server's or Eastern time.
    const kiritimati = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Kiritimati' });
    expect(before.body.today).toBe(kiritimati);

    expect(await put(`/api/jobs/${key}/install`, { installDate: '2026-11-24' })).toMatchObject({ status: 400, body: { error: PICK_CREW } });
    const booked = await put(`/api/jobs/${key}/install`, { crewId: red, installDate: '2026-11-24', endDate: '2026-11-25', startTime: '07:30', notes: 'Tear off and dry in.' });
    expect(booked.status).toBe(200);
    expect(booked.body.install).toMatchObject({ jobKey: key, crewId: red, installDate: '2026-11-24', endDate: '2026-11-25', startTime: '07:30', status: 'scheduled' });
    expect((await get(`/api/jobs/${key}/install`)).body.install).toMatchObject({ installDate: '2026-11-24' });

    const week = await get(`/api/crews/week?week=2026-11-23`);
    const mine = week.body.installs.find((i: any) => i.jobKey === key);
    expect(mine).toEqual({ id: expect.any(String), crewId: red, jobKey: key, customer: 'Pat Hollis', jobName: 'Pat Hollis', city: 'Cedar Falls',
      installDate: '2026-11-24', endDate: '2026-11-25', startTime: '07:30', status: 'scheduled' });
    expect(week.body.unbooked.map((u: any) => u.jobKey)).not.toContain(key);
    // The week carries no price and no location, whatever the job holds.
    expect(week.text).not.toContain('18450');
    expect(week.text).not.toMatch(/"(lat|lng|projectedValue|approvedPrice)"/);
    // Nor is it on the week after.
    expect((await get(`/api/crews/week?week=2026-11-30`)).body.installs.map((i: any) => i.jobKey)).not.toContain(key);

    // A note alone is not scheduling again; a new day is.
    await put(`/api/jobs/${key}/install`, { crewId: red, installDate: '2026-11-24', endDate: '2026-11-25', startTime: '07:30', notes: 'Bring the long ladder.' });
    await put(`/api/jobs/${key}/install`, { crewId: red, installDate: '2026-11-26', startTime: '07:30' });
    expect((await milestones(a, key)).map((m) => [m.kind, m.installDate])).toEqual([['install_scheduled', '2026-11-24'], ['install_scheduled', '2026-11-26']]);

    // It can come off the schedule while the crew has not started.
    expect((await del(`/api/jobs/${key}/install`)).status).toBe(200);
    expect((await get(`/api/jobs/${key}/install`)).body.install).toBeNull();
  });

  it('does not let a salesperson or a crew book crews', async () => {
    const key = await nativeJob();
    for (const who of ['rep', 'crew']) {
      as(a, who);
      expect((await get('/api/crews')).status).toBe(404);
      expect((await get('/api/crews/week')).status).toBe(404);
      expect((await post('/api/crews', { name: `Nope ${who} ${tag}` })).status).toBe(404);
      expect((await get(`/api/jobs/${key}/install`)).status).toBe(404);
      expect((await put(`/api/jobs/${key}/install`, { crewId: '7d1f7c2e-4a1b-4c3d-9e8f-0a1b2c3d4e5f', installDate: '2026-11-24' })).status).toBe(404);
    }
  });

  // ---------------------------------------------------------------- the crew

  describe('on the crew\'s phone', () => {
    let red = ''; let blue = ''; let mine = ''; let theirs = ''; let elsewhere = '';

    beforeAll(async () => {
      red = await crewWith(a, `Phone red ${tag}`, ['crew']);
      blue = await crewWith(a, `Phone blue ${tag}`, ['crew2']);
      mine = await nativeJob();
      theirs = await nativeJob();
      as(a, 'office');
      expect((await put(`/api/jobs/${mine}/install`, { crewId: red, installDate: '2026-11-24', startTime: '07:00', notes: 'Tear off and dry in.' })).status).toBe(200);
      expect((await put(`/api/jobs/${theirs}/install`, { crewId: blue, installDate: '2026-11-24' })).status).toBe(200);
      as(a, 'office');
      expect((await post(`/api/production/${mine}/pipeline/trades`, { trades: ['roofing', 'gutters'] })).status).toBe(200);
      const redB = await crewWith(b, `Phone b ${tag}`, ['crew']);
      elsewhere = await nativeJob(b);
      as(b, 'office');
      expect((await put(`/api/jobs/${elsewhere}/install`, { crewId: redB, installDate: '2026-11-24' })).status).toBe(200);
    });

    it('lists only the crew\'s own jobs, with the address and the work and no money', async () => {
      as(a, 'crew');
      const list = await get('/api/crew/jobs');
      expect(list.status).toBe(200);
      expect(list.body.crewName).toBe(`Phone red ${tag}`);
      const keys = list.body.jobs.map((j: any) => j.jobKey);
      expect(keys).toContain(mine);
      expect(keys).not.toContain(theirs);
      expect(keys).not.toContain(elsewhere);
      const job = list.body.jobs.find((j: any) => j.jobKey === mine);
      expect(job).toMatchObject({ customer: 'Pat Hollis', address: '12 Main St', city: 'Cedar Falls', state: 'IA', installDate: '2026-11-24', startTime: '07:00',
        status: 'scheduled', notes: 'Tear off and dry in.', currentTrade: 'roofing' });
      expect(job.trades.map((t: any) => t.key)).toEqual(['roofing', 'gutters']);
      expect(list.text).not.toContain('18450');
      expect(list.text).not.toContain('pat.hollis@example.test');
    });

    it('starts, ticks a trade, adds a During photo and finishes, recording each milestone', async () => {
      as(a, 'crew');
      expect(await post(`/api/crew/jobs/${mine}/status`, { status: 'done' })).toMatchObject({ status: 409, body: { error: CREW_STEP_NOT_ALLOWED } });
      const started = await post(`/api/crew/jobs/${mine}/status`, { status: 'in_progress' });
      expect(started.status).toBe(200);
      expect(started.body.job).toMatchObject({ status: 'in_progress', statusLabel: 'Working on it' });
      // A second tap records nothing more.
      expect((await post(`/api/crew/jobs/${mine}/status`, { status: 'in_progress' })).status).toBe(200);

      const ticked = await post(`/api/crew/jobs/${mine}/trade-done`, { trade: 'roofing' });
      expect(ticked.status).toBe(200);
      expect(ticked.body).toMatchObject({ completed: true, job: { currentTrade: 'gutters' } });
      expect(ticked.text).not.toContain('18450');

      expect(await post(`/api/crew/jobs/${mine}/photos`, { base64: makeJpeg({ exif: true }).toString('base64'), contentType: 'image/jpeg', phase: 'before' }))
        .toMatchObject({ status: 400, body: { error: CREW_PHOTO_PHASE } });
      const photo = await post(`/api/crew/jobs/${mine}/photos`, { base64: makeJpeg({ exif: true }).toString('base64'), contentType: 'image/jpeg', caption: 'Ridge vent in' });
      expect(photo.status).toBe(200);
      const [row] = await runAsCompany(a.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.id, photo.body.fileId)));
      expect(row).toMatchObject({ jobKey: mine, phase: 'during', status: 'ready', uploadedBy: a.people.crew.email });
      expect(stored.get(row.workingKey!)!.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
      const photos = await get(`/api/crew/jobs/${mine}/photos`);
      expect(photos.status).toBe(200);
      expect(photos.body.photos.map((p: any) => p.id)).toContain(photo.body.fileId);
      // The crew can open the copy of a photo on its own job.
      expect((await fetch(`${h.base}/api/photos/${photo.body.fileId}/thumb`)).status).toBe(200);

      const done = await post(`/api/crew/jobs/${mine}/status`, { status: 'done' });
      expect(done.body.job).toMatchObject({ status: 'done', statusLabel: 'Done' });
      expect((await milestones(a, mine)).map((m) => m.kind)).toEqual(['install_scheduled', 'install_started', 'install_done']);
      const [booking] = await runAsCompany(a.id, () => db.select().from(schema.crewAssignments).where(eq(schema.crewAssignments.jobKey, mine)));
      expect(booking.startedAt).toBeInstanceOf(Date);
      expect(booking.doneAt).toBeInstanceOf(Date);
      // Started work cannot come off the schedule, and the crew's photo is logged.
      as(a, 'office');
      expect(await del(`/api/jobs/${mine}/install`)).toMatchObject({ status: 409, body: { error: STARTED_CANNOT_CLEAR } });
      expect(await patch(`/api/crews/${red}`, { active: false })).toMatchObject({ status: 200 });
      const logs = await runAsCompany(a.id, () => db.select().from(schema.writeLog).where(and(eq(schema.writeLog.targetId, mine), eq(schema.writeLog.action, 'upload_photo'))));
      expect(logs.map((l) => l.actor)).toContain(a.people.crew.email);
      // Back on for the tests below.
      expect((await patch(`/api/crews/${red}`, { active: true })).status).toBe(200);
    });

    it('never puts a job on the board from a crew\'s tick', async () => {
      as(a, 'rep');
      const made = await post('/api/leads/create', { firstName: 'Lee', lastName: 'Ames', address: '4 Elm St', city: 'Cedar Falls', state: 'IA' });
      as(a, 'office');
      expect((await put(`/api/jobs/${made.body.jobId}/install`, { crewId: red, installDate: '2026-11-27' })).status).toBe(200);
      as(a, 'crew');
      expect(await post(`/api/crew/jobs/${made.body.jobId}/trade-done`, { trade: 'roofing' })).toMatchObject({ status: 409, body: { error: CREW_NOT_ON_BOARD } });
      const rows = await runAsCompany(a.id, () => db.select().from(schema.productionPipeline).where(eq(schema.productionPipeline.jobExternalId, made.body.jobId)));
      expect(rows).toEqual([]);
    });

    it('refuses to switch off a crew with work ahead of it', async () => {
      as(a, 'office');
      expect(await patch(`/api/crews/${blue}`, { active: false })).toMatchObject({ status: 409, body: { error: CREW_IN_USE } });
    });

    it('gives a crew 404 on another crew\'s job and another company\'s job, on every crew route', async () => {
      as(a, 'crew');
      for (const key of [theirs, elsewhere, 'archie-0123456789abcdef0123456789abcdef', 'not-a-key']) {
        expect((await get(`/api/crew/jobs/${key}`)).status).toBe(404);
        expect((await post(`/api/crew/jobs/${key}/status`, { status: 'in_progress' })).status).toBe(404);
        expect((await post(`/api/crew/jobs/${key}/trade-done`, { trade: 'roofing' })).status).toBe(404);
        expect((await get(`/api/crew/jobs/${key}/photos`)).status).toBe(404);
        expect((await post(`/api/crew/jobs/${key}/photos`, { base64: makeJpeg().toString('base64') })).status).toBe(404);
      }
      // Another crew's photo stays shut too.
      as(a, 'crew2');
      const theirPhoto = await post(`/api/crew/jobs/${theirs}/photos`, { base64: makeJpeg().toString('base64'), phase: 'after' });
      expect(theirPhoto.status).toBe(200);
      as(a, 'crew');
      expect((await fetch(`${h.base}/api/photos/${theirPhoto.body.fileId}/thumb`)).status).toBe(404);
    });

    it('never opens a job to a crew through the routes that check only ownsLead', async () => {
      as(a, 'crew');
      for (const path of [`/api/clients/${mine}`, `/api/clients/${mine}/estimates`, `/api/clients/${mine}/daily-logs`, `/api/clients/${mine}/photos`,
        `/api/production/${mine}/pipeline/history`]) {
        expect((await get(path)).status, path).toBe(404);
      }
      // Commission is refused by rank before the job is looked at.
      expect([403, 404]).toContain((await get(`/api/clients/${mine}/commission`)).status);
      expect((await post(`/api/production/${mine}/pipeline/trade-done`, { trade: 'gutters' })).status).toBe(404);
      expect((await post(`/api/clients/${mine}/photos`, { base64: makeJpeg().toString('base64') })).status).toBe(404);
      const board = await get('/api/production');
      expect(board.body.jobs.map((j: any) => j.externalId)).not.toContain(mine);
    });

    it('shows a crew member who is on no crew an empty list', async () => {
      as(a, 'idle');
      // 'idle' was put on a crew earlier in this file; take them off first.
      const r = await get('/api/crews');
      expect(r.status).toBe(404); // a crew cannot read the office list
      as(a, 'office');
      const crewsNow = (await get('/api/crews')).body.crews as any[];
      for (const c of crewsNow.filter((x) => x.members.some((m: any) => m.id === a.people.idle.id))) {
        await put(`/api/crews/${c.id}/members`, { memberIds: c.members.filter((m: any) => m.id !== a.people.idle.id).map((m: any) => m.id) });
      }
      as(a, 'idle');
      expect(await get('/api/crew/jobs')).toMatchObject({ status: 200, body: { crewName: null, jobs: [] } });
    });

    it('shows the homeowner\'s phone only around the install days, in the company\'s dates, and never the email', async () => {
      const { addDays } = await import('../../../shared/crews');
      as(a, 'crew');
      // The company is in Kiritimati: "today" is that company's date, not the server's.
      const today: string = (await get('/api/crew/jobs')).body.today;
      expect(today).toBe(new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Kiritimati' }));
      const cases = [
        { phone: '(319) 555-0201', booking: { installDate: today }, shown: true }, // install day
        { phone: '(319) 555-0202', booking: { installDate: addDays(today, 1) }, shown: false }, // not yet: tomorrow
        { phone: '(319) 555-0203', booking: { installDate: addDays(today, -1), endDate: addDays(today, 1) }, shown: true }, // mid-job
        { phone: '(319) 555-0204', booking: { installDate: addDays(today, -2), endDate: today }, shown: true }, // its last day
        { phone: '(319) 555-0205', booking: { installDate: addDays(today, -3), endDate: addDays(today, -1) }, shown: false }, // finished
        { phone: '(319) 555-0206', booking: { installDate: addDays(today, -1) }, shown: false }, // one day, yesterday
      ];
      const keys: string[] = [];
      for (const c of cases) {
        const key = await nativeJob(a, c.phone);
        as(a, 'office');
        expect((await put(`/api/jobs/${key}/install`, { crewId: red, ...c.booking })).status).toBe(200);
        keys.push(key);
      }
      as(a, 'crew');
      const list = await get('/api/crew/jobs');
      expect(list.status).toBe(200);
      cases.forEach((c, i) => {
        const job = list.body.jobs.find((j: any) => j.jobKey === keys[i]);
        expect(job, c.phone).toBeTruthy();
        if (c.shown) expect(job.homeownerPhone, c.phone).toBe(c.phone);
        else expect(job, c.phone).not.toHaveProperty('homeownerPhone');
      });
      expect(list.text).not.toContain('pat.hollis@example.test');
      expect(list.text).not.toContain('18450');
      // The single job and a crew's own write carry it the same way.
      const one = await get(`/api/crew/jobs/${keys[0]}`);
      expect(one.body.job.homeownerPhone).toBe('(319) 555-0201');
      expect((await get(`/api/crew/jobs/${keys[1]}`)).body.job).not.toHaveProperty('homeownerPhone');
      const started = await post(`/api/crew/jobs/${keys[2]}/status`, { status: 'in_progress' });
      expect(started.body.job.homeownerPhone).toBe('(319) 555-0203');
      // Another crew of the same company never reaches it.
      as(a, 'crew2');
      expect((await get(`/api/crew/jobs/${keys[0]}`)).status).toBe(404);
      expect((await get('/api/crew/jobs')).text).not.toContain('555-0201');
    });
  });

  // ---------------------------------------------------------------- everyone else unchanged

  it('changes nothing for a company Roof Lee did not make', async () => {
    for (const who of ['owner', 'office', 'crew']) {
      as(original, who);
      for (const path of ['/api/crews', '/api/crews/week', '/api/crew/jobs', '/api/crew/jobs/archie-0123456789abcdef0123456789abcdef',
        '/api/jobs/archie-0123456789abcdef0123456789abcdef/install']) {
        expect((await get(path)).status, `${who} ${path}`).toBe(404);
      }
      expect((await post('/api/crews', { name: `Original ${tag}` })).status).toBe(404);
    }
    // Its production board answers as before, with the money its office has always seen.
    const [lead] = await runAsCompany(original.id, () => db.insert(schema.leads).values({
      source: 'jobtread', externalId: `jt-${tag}`, firstName: 'Lee Ames', stage: 'Buyer Approved', projectedValue: '9100.00',
    }).returning());
    as(original, 'owner');
    const board = await get('/api/production');
    expect(board.status).toBe(200);
    expect(board.body.jobs.find((j: any) => j.externalId === lead.externalId)).toMatchObject({ projectedValue: 9100 });
    const rows = await runAsCompany(original.id, () => db.select().from(schema.crews));
    expect(rows).toEqual([]);
  });
});
