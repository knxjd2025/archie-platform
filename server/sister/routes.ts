/**
 * Roof Lee's endpoints in Archie (docs/archie/02-roof-lee-link.md). The
 * agreement they implement is docs/sisters/contract-v2.md in the Roof Lee
 * repository. Everything here sits behind the signed door (./door.ts) and is
 * shut until SISTERS_ARCHIE_SECRET is set.
 *
 * An answer never carries detail about a failure: a database error names
 * queries and people, and Roof Lee only needs to know to try again.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { runAsCompany } from '../tenant/context';
import { BUSY_MESSAGE, BUSY_RETRY_AFTER_SECONDS, findDatabaseBusy } from '../lib/db-busy';
import { setUpCompany } from './setup';
import { IDEMPOTENCY_HEADER, SISTER_PREFIX, requireSister, sisterNotFound } from './door';
import { isCloseMode, isUuid, namesCompany, parseActing, parseActingQuery, parseCompanyRequest, parseLeadChange, parseMembers, parseNewLead, parseNote, parseRecordId, type Acting } from './contract';
import { closeCompany, findRoofLeeCompany, mayCloseCompany, provisionCompany, sisterStatus } from './companies';
import { syncMembers } from './members';
import { isIdempotencyKey, once, type SisterAnswer } from './idempotency';
import { startSignedInSession } from '../auth/routes';
import { SSO_REFUSED_PAGE, signInFromTicket } from './sso';
import type { Company } from '../../shared/schema';
import { isLiveCompany } from '../../shared/company';
import { findActingMember, mayWorkLeads, type ActingMember } from './acting';
import { capabilitiesFor, type Capability } from './capabilities';
import { addNote, createLead, getJob, jobPhotoFile, listJobs, moveJob, updateLead } from './leads';
import { photoStore } from '../photos/store';
import { PHOTO_STORE_OFF } from '../photos/native';
import { runEventDelivery } from './events';
import { timingSafeEqualStr } from '../security-config';

const COMPANIES = `${SISTER_PREFIX}/v1/companies`;
/** Whether Archie is fit for Roof Lee's customers to be sent into. Off unless set to true. */
export const SISTER_READY_ENV = 'SISTERS_ARCHIE_READY';

/**
 * The company a request's address names, by Roof Lee's id and nothing else.
 * Anything that is not such a company, including Archie's own id for one, is
 * simply not found.
 */
async function companyInAddress(req: Request) {
  const id = req.params.roofliCompanyId;
  return isUuid(id) ? findRoofLeeCompany(id.toLowerCase()) : null;
}

/** One line for the log: what failed and the database's own code, never the query or its values. */
function logFailure(what: string, err: unknown): void {
  const e = err as { name?: string; code?: string; cause?: { code?: string } } | null;
  console.error(`[sister] ${what} failed: ${e?.name ?? 'error'}${e?.cause?.code ?? e?.code ? ` (${e?.cause?.code ?? e?.code})` : ''}`);
}

function failed(res: Response, what: string, err: unknown): void {
  // A full database is an answer, not a fault (server/lib/db-busy.ts): 503 and
  // when to come back, the same as every other route. Roof Lee sends again
  // whatever it got no clear answer to. The key is let go of if the database
  // allows it; if not, the repeat is told to come back too (./idempotency.ts).
  if (findDatabaseBusy(err)) {
    console.warn(`[sister] ${what}: database busy, answered 503`);
    if (!res.headersSent) res.status(503).set('Retry-After', String(BUSY_RETRY_AFTER_SECONDS)).json({ error: BUSY_MESSAGE });
    return;
  }
  logFailure(what, err);
  if (!res.headersSent) res.status(500).json({ error: 'Archie could not finish this request. Send it again.' });
}

/** Sends what a write answered, with when to come back if it said so. */
function send(res: Response, answer: SisterAnswer): void {
  if (answer.retryAfter !== undefined) res.set('Retry-After', String(answer.retryAfter));
  if (answer.body === null) res.status(answer.status).end();
  else res.status(answer.status).json(answer.body);
}

/** A file a read hands over: the bytes themselves, never a link to somewhere else. */
interface SisterFile { status: 200; file: Buffer; contentType: string }

function sendFile(res: Response, f: SisterFile): void {
  res.status(f.status);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Length', String(f.file.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(f.file);
}

/** Every refused sign-in: one status, one plain sentence, no session and no reason. */
function refuseSignIn(res: Response): void {
  if (res.headersSent) return;
  res.status(401).set('cache-control', 'no-store').type('html').send(SSO_REFUSED_PAGE);
}

/** The form a browser posts. A body that cannot be read is refused like any other bad ticket. */
function ticketForm() {
  const parse = express.urlencoded({ extended: false, limit: '16kb' });
  return (req: Request, res: Response, next: NextFunction) => parse(req, res, (err?: unknown) => (err ? refuseSignIn(res) : next()));
}

/** Where the scheduler knocks to send waiting news to Roof Lee (vercel.json). */
export const SISTER_EVENTS_CRON = '/api/cron/sister-events';

// Constant-time, and shut when CRON_SECRET is unset (the same rule as every other cron here).
const cronAuthorized = (req: Request): boolean =>
  !!process.env.CRON_SECRET && timingSafeEqualStr(String(req.headers['authorization'] || ''), `Bearer ${process.env.CRON_SECRET}`);

export function registerSisterRoutes(app: Express): void {
  // Sends news that is waiting to go to Roof Lee, and tries again what failed
  // before (./events.ts). Does nothing at all unless the link's settings are there.
  app.get(SISTER_EVENTS_CRON, async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    try {
      res.json({ ok: true, ...(await runEventDelivery()) });
    } catch (e) {
      failed(res, 'sending news to Roof Lee', e);
    }
  });

  // One sign-in. Posted by the person's browser, so it carries no signature
  // headers: the ticket is its own proof (./sso.ts). The ticket is in the body
  // and is never logged. Shut, like everything else here, until the pair
  // secret is set.
  app.post(`${SISTER_PREFIX}/v1/sso`, ticketForm(), async (req: Request, res: Response) => {
    try {
      const user = await signInFromTicket((req.body as { ticket?: unknown } | undefined)?.ticket);
      if (!user) return refuseSignIn(res);
      // A brand-new session id: never the one the browser arrived with.
      await startSignedInSession(req, user);
      res.set('cache-control', 'no-store').redirect(303, '/');
    } catch (e) {
      logFailure('sign-in from Roof Lee', e);
      refuseSignIn(res);
    }
  });

  // Make the company, or bring it up to date. Version 1 signature (the body names the company).
  app.post(COMPANIES, requireSister(1), async (req: Request, res: Response) => {
    try {
      const parsed = parseCompanyRequest(req.sister?.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const done = await provisionCompany(parsed.value);
      res.status(done.created ? 201 : 200).json({ companyId: done.companyId, ...(done.skipped.length ? { skipped: done.skipped } : {}) });
      // The slow part (the company's advisors and knowledge base) comes after
      // the answer, once: it is recorded the way the seed-companies cron
      // records it (./setup.ts), so a repeat of this request reads one row and
      // seeds nothing. If it fails here, that cron seeds the company later.
      if (done.live) {
        waitUntil(setUpCompany(done.companyId).catch((e) => logFailure('setting up a new company', e)));
      }
    } catch (e) {
      failed(res, 'POST companies', e);
    }
  });

  // Replace the company's team. Version 1 signature: it covers only the body,
  // so the body must name the same company as the address.
  app.put(`${COMPANIES}/:roofliCompanyId/members`, requireSister(1), async (req: Request, res: Response) => {
    try {
      const body = req.sister?.body;
      if (!namesCompany(body, req.params.roofliCompanyId)) return res.status(400).json({ error: 'The company in the body is not the company in the address.' });
      const team = parseMembers(body?.members);
      if (!team.ok) return res.status(400).json({ error: team.error });
      const company = await companyInAddress(req);
      if (!company) return res.status(404).end();
      const skipped = [...team.value.skipped, ...(await syncMembers(company.id, team.value.members))];
      res.json({ ok: true, ...(skipped.length ? { skipped } : {}) });
    } catch (e) {
      failed(res, 'PUT members', e);
    }
  });

  // Is Archie fit for Roof Lee's customers? A switch for the whole product,
  // off until the owner turns it on.
  app.get(`${SISTER_PREFIX}/v1/ready`, requireSister(1), (_req: Request, res: Response) => {
    res.json({ ready: /^(1|true|yes)$/i.test((process.env[SISTER_READY_ENV] ?? '').trim()) });
  });

  // Roof Lee's health check for one company.
  app.get(`${COMPANIES}/:roofliCompanyId`, requireSister(2), async (req: Request, res: Response) => {
    try {
      const company = await companyInAddress(req);
      if (!company) return res.status(404).end();
      res.json({ companyId: company.id, status: sisterStatus(company.status) });
    } catch (e) {
      failed(res, 'GET company', e);
    }
  });

  // Pause or close a company. Never a deletion.
  app.delete(`${COMPANIES}/:roofliCompanyId`, requireSister(2), async (req: Request, res: Response) => {
    try {
      const body = req.sister?.body;
      if (!namesCompany(body, req.params.roofliCompanyId)) return res.status(400).json({ error: 'The company in the body is not the company in the address.' });
      const mode = body?.mode;
      if (!isCloseMode(mode)) return res.status(400).json({ error: 'Say whether to pause or to close.' });
      const acting = parseActing(body?.acting);
      if (!acting.ok) return res.status(400).json({ error: acting.error });
      const key = req.get(IDEMPOTENCY_HEADER);
      if (key !== undefined && !isIdempotencyKey(key)) return res.status(400).json({ error: 'The idempotency key could not be read.' });
      const company = await companyInAddress(req);
      if (!company) return res.status(404).end();
      const answer = await once(company.id, key, async () => {
        // Archie's own check on the person named, made when the work is about
        // to be done. A repeat of work already done is answered as before and
        // never reaches here. A refusal is not kept: Roof Lee's team list may
        // simply not have arrived yet.
        if (!(await mayCloseCompany(company, acting.value))) {
          return { status: 403, body: { error: 'This person may not pause or close this company.' }, remember: false };
        }
        return { status: 200, body: { companyId: company.id, status: await closeCompany(company, mode, acting.value) } };
      });
      send(res, answer);
    } catch (e) {
      failed(res, 'DELETE company', e);
    }
  });

  // ---- Read and write for Lee, Roof Lee's assistant ------------------------
  //
  // Every one of these finds the company from the address, by Roof Lee's id,
  // then does its work as that company and nothing wider. A record that
  // belongs to another company is not found. A person is named by Roof Lee
  // (in the address for a read, in the body for a write) and Archie applies
  // its own role rules to them (./acting.ts).

  const NOT_ALLOWED = { status: 403, body: { error: 'This person may not do that in Archie.' }, remember: false } as const;
  const NO_SUCH = { status: 404, body: null, remember: false } as const;

  /**
   * The live company an address names, or an answer already sent: 404 for a
   * company Roof Lee never made, 409 for one that is paused or closed (Archie
   * does nothing for it until it is brought back).
   */
  async function liveCompany(req: Request, res: Response): Promise<Company | null> {
    const company = await companyInAddress(req);
    if (!company) { res.status(404).end(); return null; }
    if (!isLiveCompany(company)) { res.status(409).json({ error: 'This company is paused or closed in Archie.' }); return null; }
    return company;
  }

  /**
   * One write for a named person, done once. Reads the three things every
   * write must carry (the company in the address, who it is for, and a key),
   * then runs `work` as the company with the person Archie found.
   *
   * `needs` names what Archie must be able to say about the company for this
   * write to be made at all (the agreement's "Only when ... is reported").
   * Roof Lee holds itself to the same rule from what it last heard; Archie
   * holds to it here from what is true now, so a write that slips through
   * after something changed is still refused. Not kept, so it can be sent
   * again.
   */
  function leeWrite(what: string, needs: Capability[], work: (member: ActingMember, req: Request, key: string) => Promise<SisterAnswer>) {
    return async (req: Request, res: Response) => {
      try {
        const body = req.sister?.body;
        // A body that repeats the company must name the one in the address (rule 2).
        if (body?.roofliCompanyId !== undefined && !namesCompany(body, req.params.roofliCompanyId)) {
          return res.status(400).json({ error: 'The company in the body is not the company in the address.' });
        }
        const acting = parseActing(body?.acting);
        if (!acting.ok || !acting.value) return res.status(400).json({ error: 'Say who this request is for.' });
        const key = req.get(IDEMPOTENCY_HEADER);
        if (!isIdempotencyKey(key)) return res.status(400).json({ error: 'This request needs an idempotency key.' });
        const company = await liveCompany(req, res);
        if (!company) return;
        const who: Acting = acting.value;
        if (needs.length) {
          const can = await capabilitiesFor(company);
          if (!needs.every((n) => can.includes(n))) return res.status(409).json({ error: 'Archie is not set up to take this for this company yet.' });
        }
        const answer = await once(company.id, key, () => runAsCompany(company.id, async () => {
          const member = await findActingMember(who);
          // Not kept: the team list may simply not have arrived yet.
          if (!member || !mayWorkLeads(member)) return NOT_ALLOWED;
          return work(member, req, key);
        }, { loadProfile: false }));
        send(res, answer);
      } catch (e) {
        failed(res, what, e);
      }
    };
  }

  /**
   * One read. `work` is given the person it is for, or undefined when Roof
   * Lee named nobody. It answers JSON, or a file sent as its own bytes.
   */
  function leeRead(what: string, work: (member: ActingMember | undefined, req: Request) => Promise<SisterAnswer | SisterFile>, opts: { needsPerson: boolean }) {
    return async (req: Request, res: Response) => {
      try {
        const acting = parseActingQuery(req.query as Record<string, unknown>);
        if (!acting.ok) return res.status(400).json({ error: acting.error });
        if (opts.needsPerson && !acting.value) return res.status(400).json({ error: 'Say who this request is for.' });
        const company = await liveCompany(req, res);
        if (!company) return;
        const who = acting.value;
        const answer = await runAsCompany(company.id, async (): Promise<SisterAnswer | SisterFile> => {
          if (!who) return work(undefined, req);
          const member = await findActingMember(who);
          if (!member) return NOT_ALLOWED;
          return work(member, req);
        }, { loadProfile: false });
        if ('file' in answer) sendFile(res, answer);
        else send(res, answer);
      } catch (e) {
        failed(res, what, e);
      }
    };
  }

  // What Archie can do for this company. Asked by Roof Lee's scheduled run, for nobody in particular.
  app.get(`${COMPANIES}/:roofliCompanyId/capabilities`, requireSister(2), async (req: Request, res: Response) => {
    try {
      const company = await liveCompany(req, res);
      if (!company) return;
      res.json({ capabilities: await capabilitiesFor(company) });
    } catch (e) {
      failed(res, 'GET capabilities', e);
    }
  });

  // Leads and jobs this person may see. Someone who may not see leads at all is shown none.
  app.get(`${COMPANIES}/:roofliCompanyId/jobs`, requireSister(2), leeRead('GET jobs', async (member, req) => {
    if (!member || !mayWorkLeads(member)) return { status: 200, body: { jobs: [] } };
    const text = typeof req.query.text === 'string' ? req.query.text : undefined;
    return { status: 200, body: { jobs: await listJobs(member, { text }) } };
  }, { needsPerson: true }));

  // One lead or job. Named nobody (the scheduled run): the company's own record, if it has one.
  app.get(`${COMPANIES}/:roofliCompanyId/jobs/:id`, requireSister(2), leeRead('GET job', async (member, req) => {
    const id = parseRecordId(req.params.id);
    if (id === null || (member && !mayWorkLeads(member))) return NO_SUCH;
    const job = await getJob(id, member);
    return job ? { status: 200, body: { job } } : NO_SUCH;
  }, { needsPerson: false }));

  // A new lead, kept in Archie only: no JobTread, no KynexPro, no message to anyone.
  // Only while Archie sends this company's customers nothing by itself.
  app.post(`${COMPANIES}/:roofliCompanyId/leads`, requireSister(2), leeWrite('POST leads', ['messages.quiet'], async (member, req, key) => {
    const lead = parseNewLead(req.sister?.body);
    if (!lead.ok) return { status: 400, body: { error: lead.error }, remember: false };
    return createLead(member, lead.value, key);
  }));

  // Change a lead's status, standing note or contact details.
  app.patch(`${COMPANIES}/:roofliCompanyId/leads/:id`, requireSister(2), leeWrite('PATCH lead', ['messages.quiet'], async (member, req) => {
    const change = parseLeadChange(req.sister?.body);
    if (!change.ok) return { status: 400, body: { error: change.error }, remember: false };
    const id = parseRecordId(req.params.id);
    if (id === null || !(await updateLead(member, id, change.value))) return NO_SUCH;
    return { status: 200, body: { ok: true } };
  }));

  // Add a note to a lead or job.
  app.post(`${COMPANIES}/:roofliCompanyId/leads/:id/notes`, requireSister(2), leeWrite('POST note', [], async (member, req, key) => {
    const text = parseNote(req.sister?.body);
    if (!text.ok) return { status: 400, body: { error: text.error }, remember: false };
    const id = parseRecordId(req.params.id);
    return (id === null ? null : await addNote(member, id, text.value, key)) ?? NO_SUCH;
  }));

  // Move a job along the production board. A lead is put on the board, under
  // a job identity Archie makes, the first time it is moved. The board's own
  // rules decide whether the move may be made.
  app.post(`${COMPANIES}/:roofliCompanyId/jobs/:id/stage`, requireSister(2), leeWrite('POST job stage', ['messages.quiet', 'jobs.native'], async (member, req) => {
    const id = parseRecordId(req.params.id);
    return (id === null ? null : await moveJob(member, id, req.sister?.body?.stage)) ?? NO_SUCH;
  }));

  // One photo of a job Archie keeps, as a file: its working copy, a JPEG with
  // no location or other metadata in it, sent as its own bytes and never as
  // a link to somewhere else. Only once a person recorded the customer's
  // agreement (./leads.ts jobPhotoFile). A deleted photo, another job's or
  // company's, a job with no consent and anything this person may not see
  // are all simply not found. Named nobody (the scheduled run): the
  // company's own job. With the photo store switched off: said plainly.
  app.get(`${COMPANIES}/:roofliCompanyId/jobs/:id/photos/:photoId`, requireSister(2), leeRead('GET job photo', async (member, req) => {
    const id = parseRecordId(req.params.id);
    if (id === null || (member && !mayWorkLeads(member))) return NO_SUCH;
    const photo = await jobPhotoFile(id, req.params.photoId, member, photoStore());
    if (photo.found) return { status: 200, file: photo.jpeg, contentType: 'image/jpeg' };
    return photo.storeOff ? { status: 503, body: { error: PHOTO_STORE_OFF }, remember: false } : NO_SUCH;
  }, { needsPerson: false }));

  // Last: whatever no route above answered.
  app.use(SISTER_PREFIX, sisterNotFound());
}
