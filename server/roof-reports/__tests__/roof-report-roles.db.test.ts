/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * Who may see and do what with a roof report: one written decision for every
 * action and every role Archie has, held by a hand-written table below, so a
 * new action or a new role fails here until somebody decides it. Reports carry
 * prices, so crew (the Production role) never see one. A salesperson reaches
 * only reports on their own jobs. A report that is not yours, in another
 * company, archived or not there at all is the same "not found", never
 * "forbidden". The role is read from the signed-in session, never from the
 * request.
 *
 * The first block needs no database. The second runs on the local test
 * database (scripts/test-db.sh) as the app's own role, with row level security
 * on. Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { ALL_ROLES, dataScope, type TeamRole } from '../../../shared/rbac';
import {
  ROOF_REPORT_ACTIONS, ROOF_REPORT_RULES, NOT_FOUND, type RoofReportAction, type RoofReportDecision,
} from '../../../shared/roof-reports';
import { ROLE_MAP, ROOFLI_ROLES } from '../../sister/contract';
import { roofReportsOn, requireRoofReportsOn } from '../switch';
import { decisionFor, mayUseRoofReports, requireRoofReportUser } from '../access';

// What every role may do with a report, written out by hand. 'all' is every
// report in the company, 'team' the person's own and their direct reports',
// 'own' only the person's own, 'no' never. For change_job (move a report to
// another job, or take it off its job) 'all' is any report the role may see and
// 'own' is only a report the person made themselves, a leader's team included.
// share and unshare (making a customer link for a report, and turning it off) reach exactly as far as send.
// rewrite (asking a model to rewrite one finding or the summary, which changes the report's words) is exactly the right to edit it.
// measure (asking for the roof to be found from a satellite picture while a report is being made, which spends money) is exactly the right to make a report.
const D: Record<TeamRole, Record<RoofReportAction, RoofReportDecision>> = {
  admin:            { see: 'all',  make: 'all',  edit: 'all', rewrite: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', measure: 'all' },
  sales_director:   { see: 'all',  make: 'all',  edit: 'all', rewrite: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', measure: 'all' },
  customer_service: { see: 'all',  make: 'all',  edit: 'all', rewrite: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', measure: 'all' },
  manager:          { see: 'team', make: 'team', edit: 'team', rewrite: 'team', send: 'team', archive: 'team', see_archived: 'no',  change_job: 'own', remove_photo: 'own', share: 'team', unshare: 'team', measure: 'team' },
  sales:            { see: 'own',  make: 'own',  edit: 'own', rewrite: 'own',  send: 'own',  archive: 'own',  see_archived: 'no',  change_job: 'own', remove_photo: 'own', share: 'own', unshare: 'own', measure: 'own' },
  production:       { see: 'no',   make: 'no',   edit: 'no', rewrite: 'no',   send: 'no',   archive: 'no',   see_archived: 'no',  change_job: 'no', remove_photo: 'no', share: 'no', unshare: 'no', measure: 'no' },
};

describe('who may do what with a roof report (the written decisions)', () => {
  it('decides every action for every role Archie has, and nothing else', () => {
    expect([...ROOF_REPORT_ACTIONS].sort()).toEqual(['archive', 'change_job', 'edit', 'make', 'measure', 'remove_photo', 'rewrite', 'see', 'see_archived', 'send', 'share', 'unshare']);
    expect(Object.keys(ROOF_REPORT_RULES).sort()).toEqual([...ALL_ROLES].sort());
    expect(Object.keys(D).sort()).toEqual([...ALL_ROLES].sort());
    for (const role of ALL_ROLES) {
      expect(Object.keys(ROOF_REPORT_RULES[role]).sort(), role).toEqual([...ROOF_REPORT_ACTIONS].sort());
      for (const action of ROOF_REPORT_ACTIONS) {
        expect(ROOF_REPORT_RULES[role][action], `${role} / ${action}`).toBe(D[role][action]);
        expect(decisionFor(role, action)).toBe(D[role][action]);
      }
    }
  });

  it('follows each role\'s data scope in Archie\'s own role rules', () => {
    const word = { all: 'all', team: 'team', self: 'own' } as const;
    for (const role of ALL_ROLES) {
      for (const action of ROOF_REPORT_ACTIONS) {
        if (action === 'see_archived' || role === 'production') continue;
        // Making a customer link and turning it off reach exactly as far as the role's own scope, like send.
        if (action === 'share' || action === 'unshare') { expect(decisionFor(role, action), `${role} / ${action}`).toBe(word[dataScope(role)]); expect(decisionFor(role, action), `${role} / ${action}`).toBe(decisionFor(role, 'send')); continue; }
        // Taking back a photo that is not in a report yet: a role that sees everything may for anyone's, every narrower one only for a photo it uploaded itself.
        if (action === 'remove_photo') { expect(decisionFor(role, action), role).toBe(dataScope(role) === 'all' ? 'all' : 'own'); continue; }
        // Moving a report off its job reaches only as far as the role's own scope, and never past the
        // person's own reports: a role that sees everything may; every narrower one may only for a report it made.
        if (action === 'change_job') { expect(decisionFor(role, action), role).toBe(dataScope(role) === 'all' ? 'all' : 'own'); continue; }
        expect(decisionFor(role, action), `${role} / ${action}`).toBe(word[dataScope(role)]);
      }
    }
  });

  it('gives rewriting exactly the right to edit, for every role', () => {
    for (const role of ALL_ROLES) expect(decisionFor(role, 'rewrite'), role).toBe(decisionFor(role, 'edit'));
    expect(decisionFor('owner' as TeamRole, 'rewrite')).toBe('no');
  });

  it('gives finding the roof from a satellite picture exactly the right to make a report, for every role, and crew never', () => {
    for (const role of ALL_ROLES) expect(decisionFor(role, 'measure'), role).toBe(decisionFor(role, 'make'));
    expect(decisionFor('production', 'measure')).toBe('no');
    expect(decisionFor('owner' as TeamRole, 'measure')).toBe('no');
    for (const r of ROOFLI_ROLES) expect(decisionFor(ROLE_MAP[r], 'measure'), r).toBe(r === 'crew' ? 'no' : decisionFor(ROLE_MAP[r], 'make'));
  });

  it('lets every role but crew use roof reports, and an unknown role nothing', () => {
    for (const role of ALL_ROLES) expect(mayUseRoofReports(role), role).toBe(role !== 'production');
    expect(mayUseRoofReports('owner' as TeamRole)).toBe(false);
    expect(mayUseRoofReports(undefined as unknown as TeamRole)).toBe(false);
    expect(decisionFor('owner' as TeamRole, 'see')).toBe('no');
  });

  it('decides every Roof Lee role through the role Archie gives it', () => {
    expect([...ROOFLI_ROLES].sort()).toEqual(['admin', 'crew', 'office', 'owner', 'sales_manager', 'salesperson']);
    const expected: Record<string, RoofReportDecision> = { owner: 'all', admin: 'all', office: 'all', sales_manager: 'all', salesperson: 'own', crew: 'no' };
    for (const r of ROOFLI_ROLES) {
      expect(decisionFor(ROLE_MAP[r], 'see'), r).toBe(expected[r]);
      expect(mayUseRoofReports(ROLE_MAP[r]), r).toBe(r !== 'crew');
    }
  });
});

describe('the switch', () => {
  it('is off unless it is exactly "on"', () => {
    expect(roofReportsOn({})).toBe(false);
    for (const v of ['', 'ON', 'On', 'true', '1', 'yes', ' on', 'on ', 'off']) expect(roofReportsOn({ ARCHIE_ROOF_REPORTS: v }), JSON.stringify(v)).toBe(false);
    expect(roofReportsOn({ ARCHIE_ROOF_REPORTS: 'on' })).toBe(true);
  });

  it('answers a bare 404 on every route behind it while off, and lets through when on', async () => {
    const app = express();
    app.use('/api/roof-reports', requireRoofReportsOn, (_req, res) => res.json({ reached: true }));
    const server: Server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const saved = process.env.ARCHIE_ROOF_REPORTS;
    try {
      delete process.env.ARCHIE_ROOF_REPORTS;
      for (const path of ['/api/roof-reports', '/api/roof-reports/status', '/api/roof-reports/anything/photos/x/thumb']) {
        const res = await fetch(base + path);
        expect(res.status, path).toBe(404);
        expect(await res.text()).toBe('');
      }
      process.env.ARCHIE_ROOF_REPORTS = 'on';
      expect((await fetch(base + '/api/roof-reports/status')).status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = saved;
      server.close();
    }
  });
});

describe('the role comes from the session, never from the request', () => {
  async function ask(sessionRole: TeamRole | null, extra: { body?: object; query?: string; headers?: Record<string, string> } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.session = { user: sessionRole ? { email: 'x@example.test', name: 'X', role: sessionRole } : undefined }; next(); });
    app.post('/r/:id', requireRoofReportUser, (req: any, res) => res.json({ role: req.session.user.role }));
    const server: Server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/r/${extra.query ?? ''}1`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(extra.headers ?? {}) }, body: JSON.stringify(extra.body ?? {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { server.close(); }
  }

  it('answers crew the same "not found" as a report that is not there', async () => {
    const crew = await ask('production');
    expect(crew).toEqual({ status: 404, body: { message: NOT_FOUND } });
  });

  it('ignores a role named in the body, the address or a header', async () => {
    const spoof = { body: { role: 'admin', user: { role: 'admin' } }, headers: { 'x-role': 'admin', 'x-user-role': 'admin' } };
    expect((await ask('production', spoof)).status).toBe(404);
    const rep = await ask('sales', spoof);
    expect(rep).toEqual({ status: 200, body: { role: 'sales' } });
  });

  it('asks nobody who is not signed in to pretend: that is a 401, from the sign-in check before it', async () => {
    expect((await ask(null)).status).toBe(401);
  });
});

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('who sees which report (database)', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { visibleRoofReportWhere, roofReportFor, mayAttachJob, mayChangeJob } = await import('../access');
  const { and } = await import('drizzle-orm');

  const tag = `rr-roles-${process.pid}-${Date.now()}`;
  type Who = 'admin' | 'director' | 'csr' | 'manager' | 'repA' | 'repB' | 'crew';
  const roleOf: Record<Who, TeamRole> = { admin: 'admin', director: 'sales_director', csr: 'customer_service', manager: 'manager', repA: 'sales', repB: 'sales', crew: 'production' };
  const email = (w: Who) => `${tag}-${w}@example.test`;
  const user = (w: Who) => ({ email: email(w), name: w, role: roleOf[w] });

  let a = ''; let b = '';
  const ids: Record<string, string> = { jobA: '', jobB: '', addrA: '', addrM: '', archived: '', other: '' };
  const label = new Map<string, string>();

  /** The reports a person sees in a list: the scope, archived left out. */
  async function listFor(w: Who): Promise<string[]> {
    const rows = await runAsCompany(a, async () => db.select({ id: schema.roofReports.id }).from(schema.roofReports).where(await visibleRoofReportWhere(user(w))));
    return rows.map((r) => label.get(r.id) ?? r.id).sort();
  }
  /** The reports a person can open one by one, trying every id there is. */
  async function openFor(w: Who): Promise<string[]> {
    const opened: string[] = [];
    for (const [name, id] of Object.entries(ids)) {
      const r = await runAsCompany(a, () => roofReportFor(user(w), id));
      if (r) opened.push(name);
    }
    return opened.sort();
  }

  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
    const member: Record<string, number> = {};
    await runAsCompany(a, async () => {
      const make = async (w: Who, extra: object = {}) => {
        const [m] = await db.insert(schema.teamMembers).values({ name: w, email: email(w), role: roleOf[w], canLogin: true, active: true, ...extra } as any).returning();
        member[w] = m.id;
      };
      await make('admin'); await make('director'); await make('csr'); await make('crew');
      await make('manager');
      await make('repA', { jobtreadSalesRep: 'Rep Alpha', reportsTo: member.manager });
      await make('repB', { jobtreadSalesRep: 'Rep Bravo' });
      await db.insert(schema.leads).values([
        { externalId: `${tag}-jobA`, source: 'jobtread', firstName: 'Dana', jtSalesRep: 'Rep Alpha' },
        { externalId: `${tag}-jobB`, source: 'jobtread', firstName: 'Lee', jtSalesRep: 'Rep Bravo' },
      ] as any);
      const base = { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'] };
      const add = async (name: string, v: object) => {
        const [r] = await db.insert(schema.roofReports).values({ ...base, title: name, ...v } as any).returning();
        ids[name] = r.id; label.set(r.id, name);
      };
      await add('jobA', { jobExternalId: `${tag}-jobA`, createdByMemberId: member.csr, status: 'ready' });
      await add('jobB', { jobExternalId: `${tag}-jobB`, createdByMemberId: member.csr, status: 'ready' });
      await add('addrA', { createdByMemberId: member.repA, status: 'ready' });
      await add('addrM', { createdByMemberId: member.manager, status: 'ready' });
      await add('archived', { jobExternalId: `${tag}-jobA`, createdByMemberId: member.repA, status: 'archived' });
      // Only for the job-change rule: these two are not in the lists above (they are added below, after the lists are read).
    });
    await runAsCompany(b, async () => {
      // The other company has a job with the very same key, and a report on it.
      await db.insert(schema.leads).values({ externalId: `${tag}-jobA`, source: 'jobtread', firstName: 'Other', jtSalesRep: 'Rep Alpha' } as any);
      await db.insert(schema.leads).values({ externalId: `${tag}-bjob`, source: 'jobtread', firstName: 'Other', jtSalesRep: 'Rep Alpha' } as any);
      const [r] = await db.insert(schema.roofReports).values({ address: '1 Oak Road', reportTypes: ['storm'], jobExternalId: `${tag}-jobA`, status: 'ready' } as any).returning();
      ids.other = r.id; label.set(r.id, 'other');
    });
  });

  // What each person sees. The second company's report and the archived one are in nobody's list.
  const SEES: Array<[Who, string[]]> = [
    ['admin', ['addrA', 'addrM', 'jobA', 'jobB']],
    ['director', ['addrA', 'addrM', 'jobA', 'jobB']],
    ['csr', ['addrA', 'addrM', 'jobA', 'jobB']],
    ['manager', ['addrA', 'addrM', 'jobA']],   // leading rep A: rep A's two and their own
    ['repA', ['addrA', 'jobA']],
    ['repB', ['jobB']],
    ['crew', []],
  ];

  for (const [who, expected] of SEES) {
    it(`${roleOf[who]} (${who}) sees ${expected.length ? expected.join(', ') : 'no report'}, in a list and one by one`, async () => {
      expect(await listFor(who)).toEqual(expected);
      expect(await openFor(who)).toEqual(expected);
    });
  }

  it('shows the same through each of Roof Lee\'s six roles, by the role Archie gives them', async () => {
    const through: Array<[string, Who, string[]]> = [
      ['owner', 'admin', ['addrA', 'addrM', 'jobA', 'jobB']],
      ['admin', 'director', ['addrA', 'addrM', 'jobA', 'jobB']],
      ['office', 'csr', ['addrA', 'addrM', 'jobA', 'jobB']],
      ['sales_manager', 'csr', ['addrA', 'addrM', 'jobA', 'jobB']],
      ['salesperson', 'repA', ['addrA', 'jobA']],
      ['salesperson', 'repB', ['jobB']],
      ['crew', 'crew', []],
    ];
    for (const [rooflee, who, expected] of through) {
      expect(ROLE_MAP[rooflee as keyof typeof ROLE_MAP], rooflee).toBe(roleOf[who] === 'sales_director' ? 'admin' : roleOf[who]);
      expect(await listFor(who), rooflee).toEqual(expected);
      expect(await openFor(who), rooflee).toEqual(expected);
    }
  });

  it('keeps the archived report out of everybody\'s sight, the person who made it included', async () => {
    for (const w of ['admin', 'director', 'csr', 'manager', 'repA', 'repB', 'crew'] as Who[]) {
      expect(await runAsCompany(a, () => roofReportFor(user(w), ids.archived)), w).toBeNull();
      expect(await listFor(w), w).not.toContain('archived');
    }
  });

  it('lists archived reports only to a role that sees everything, and only when asked', async () => {
    const archivedFor = async (w: Who) => (await runAsCompany(a, async () => db.select({ id: schema.roofReports.id }).from(schema.roofReports)
      .where(await visibleRoofReportWhere(user(w), { archived: true })))).map((r) => label.get(r.id));
    for (const w of ['admin', 'director', 'csr'] as Who[]) expect(await archivedFor(w), w).toEqual(['archived']);
    for (const w of ['manager', 'repA', 'repB', 'crew'] as Who[]) expect(await archivedFor(w), w).toEqual([]);
  });

  it('never shows the other company\'s report, whatever the role, even on a job with the same key', async () => {
    for (const w of ['admin', 'director', 'csr', 'manager', 'repA', 'repB', 'crew'] as Who[]) {
      expect(await runAsCompany(a, () => roofReportFor(user(w), ids.other)), w).toBeNull();
    }
    // And from the other company's side, nothing of company A's.
    expect(await runAsCompany(b, () => roofReportFor({ email: email('admin'), name: 'x', role: 'admin' }, ids.jobA))).toBeNull();
    const seenByB = await runAsCompany(b, async () => db.select({ id: schema.roofReports.id }).from(schema.roofReports).where(await visibleRoofReportWhere({ email: email('admin'), name: 'x', role: 'admin' })));
    expect(seenByB.map((r) => r.id)).toEqual([ids.other]);
  });

  it('answers the same nothing for an id that is not an id, one that is not there, and no company at all', async () => {
    for (const bad of ['', 'abc', '../etc/passwd', "1' or '1'='1", '00000000-0000-0000-0000-000000000000', ids.jobA.toUpperCase().slice(0, 10)]) {
      expect(await runAsCompany(a, () => roofReportFor(user('admin'), bad)), bad).toBeNull();
    }
    expect(await roofReportFor(user('admin'), ids.jobA)).toBeNull();
  });

  it('follows a job reassigned inside Archie, not the name in the job system', async () => {
    // Rep Alpha's job is handed to rep B by an override: now rep B sees it and rep A does not.
    await runAsCompany(a, async () => {
      const [repB] = await db.select().from(schema.teamMembers).where(sql`${schema.teamMembers.email} = ${email('repB')}`);
      await db.insert(schema.leads).values({ externalId: `${tag}-jobC`, source: 'jobtread', firstName: 'Kim', jtSalesRep: 'Rep Alpha' } as any);
      await db.insert(schema.repAssignments).values({ jobExternalId: `${tag}-jobC`, teamMemberId: repB.id, role: 'primary', source: 'manual' } as any);
      const [r] = await db.insert(schema.roofReports).values({ address: '3 Pine Court', reportTypes: ['inspection'], jobExternalId: `${tag}-jobC`, status: 'ready' } as any).returning();
      label.set(r.id, 'jobC');
      ids.jobC = r.id;
    });
    expect(await listFor('repB')).toEqual(['jobB', 'jobC']);
    expect(await listFor('repA')).toEqual(['addrA', 'jobA']);
    expect(await listFor('manager')).toEqual(['addrA', 'addrM', 'jobA']);
    expect(await openFor('repB')).toEqual(['jobB', 'jobC']);
  });

  describe('changing or removing a report\'s job', () => {
    // Reports made for this block only, so the lists above are not changed.
    const made: Record<string, { jobExternalId: string | null; createdByMemberId: number | null }> = {};
    beforeAll(async () => {
      const members = await runAsCompany(a, async () => db.select().from(schema.teamMembers));
      const id = (w: Who) => members.find((m) => m.email === email(w))!.id;
      made.byCsrOnA = { jobExternalId: `${tag}-jobA`, createdByMemberId: id('csr') };
      made.byRepAOnA = { jobExternalId: `${tag}-jobA`, createdByMemberId: id('repA') };
      // Made by rep A on a job that was handed to rep B afterwards: rep A no longer sees that job.
      made.byRepAOnB = { jobExternalId: `${tag}-jobB`, createdByMemberId: id('repA') };
      made.addrByRepA = { jobExternalId: null, createdByMemberId: id('repA') };
      made.addrByCsr = { jobExternalId: null, createdByMemberId: id('csr') };
      // A second job of rep A's, so "move it to another job they may see" can be asked.
      await runAsCompany(a, async () => { await db.insert(schema.leads).values({ externalId: `${tag}-jobA2`, source: 'jobtread', firstName: 'Kim', jtSalesRep: 'Rep Alpha' } as any); });
    });
    const can = (w: Who, report: string, to: string | null) => runAsCompany(a, () => mayChangeJob(user(w), made[report], to));

    it('lets a role that sees everything change or remove any report\'s job, onto a job that exists in the company', async () => {
      for (const w of ['admin', 'director', 'csr'] as Who[]) {
        expect(await can(w, 'byRepAOnA', null), w).toBe(true);
        expect(await can(w, 'byRepAOnA', `${tag}-jobB`), w).toBe(true);
        expect(await can(w, 'byCsrOnA', null), w).toBe(true);
        expect(await can(w, 'byRepAOnB', `${tag}-jobA`), w).toBe(true);
        expect(await can(w, 'byRepAOnA', `${tag}-no-such-job`), w).toBe(false);
        expect(await can(w, 'byRepAOnA', `${tag}-bjob`), `${w} / the other company's job`).toBe(false);
      }
    });

    it('lets a salesperson change or remove the job only of a report they made, and only while they may see that job', async () => {
      expect(await can('repA', 'byRepAOnA', null)).toBe(true);
      expect(await can('repA', 'byRepAOnA', `${tag}-jobA2`)).toBe(true);
      // Asking for the job it already has changes nothing.
      expect(await can('repA', 'byCsrOnA', `${tag}-jobA`)).toBe(true);
      // Not onto a job they may not see, however it is asked.
      expect(await can('repA', 'byRepAOnA', `${tag}-jobB`)).toBe(false);
      // A colleague's report, or the office's, even on their own job.
      expect(await can('repA', 'byCsrOnA', null)).toBe(false);
      expect(await can('repA', 'byCsrOnA', `${tag}-jobA2`)).toBe(false);
      expect(await can('repB', 'byRepAOnA', null)).toBe(false);
      // Their own report on a job they no longer see: no.
      expect(await can('repA', 'byRepAOnB', null)).toBe(false);
      expect(await can('repA', 'byRepAOnB', `${tag}-jobA`)).toBe(false);
    });

    it('lets a manager change the job only of a report they made, not of a report of their team', async () => {
      expect(await can('manager', 'byRepAOnA', null)).toBe(false);
      expect(await can('manager', 'byRepAOnA', `${tag}-jobA2`)).toBe(false);
      expect(await can('manager', 'byCsrOnA', null)).toBe(false);
    });

    it('does not count putting a report on a job when it had none as changing one: only the job itself is checked', async () => {
      expect(await can('repA', 'addrByRepA', `${tag}-jobA`)).toBe(true);
      expect(await can('repA', 'addrByRepA', `${tag}-jobB`)).toBe(false);
      expect(await can('manager', 'addrByRepA', `${tag}-jobA`)).toBe(true);
      expect(await can('csr', 'addrByCsr', `${tag}-jobB`)).toBe(true);
      expect(await can('crew', 'addrByCsr', `${tag}-jobA`)).toBe(false);
    });

    it('lets crew change nothing', async () => {
      for (const report of Object.keys(made)) { expect(await can('crew', report, null), report).toBe(false); expect(await can('crew', report, `${tag}-jobA`), report).toBe(false); }
    });
  });

  describe('attaching a report to a job', () => {
    const may = (w: Who, job: string) => runAsCompany(a, () => mayAttachJob(user(w), job));
    it('lets a person attach only a job they may see, and only one that exists in their company', async () => {
      expect(await may('repA', `${tag}-jobA`)).toBe(true);
      expect(await may('repA', `${tag}-jobB`)).toBe(false);
      expect(await may('repB', `${tag}-jobA`)).toBe(false);
      expect(await may('manager', `${tag}-jobA`)).toBe(true);
      expect(await may('manager', `${tag}-jobB`)).toBe(false);
      for (const w of ['admin', 'director', 'csr'] as Who[]) {
        expect(await may(w, `${tag}-jobA`), w).toBe(true);
        expect(await may(w, `${tag}-jobB`), w).toBe(true);
        expect(await may(w, `${tag}-no-such-job`), w).toBe(false);
        expect(await may(w, `${tag}-bjob`), `${w} / the other company's job`).toBe(false);
      }
      expect(await may('crew', `${tag}-jobA`)).toBe(false);
      expect(await may('admin', '')).toBe(false);
    });
  });
});
