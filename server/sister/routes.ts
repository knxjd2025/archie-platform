/**
 * Roof Lee's endpoints in Archie (docs/archie/02-roof-lee-link.md). The
 * agreement they implement is docs/sisters/contract-v2.md in the Roof Lee
 * repository. Everything here sits behind the signed door (./door.ts) and is
 * shut until SISTERS_ARCHIE_SECRET is set.
 *
 * An answer never carries detail about a failure: a database error names
 * queries and people, and Roof Lee only needs to know to try again.
 */
import type { Express, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { runAsCompany } from '../tenant/context';
import { seedCompany } from '../seed';
import { IDEMPOTENCY_HEADER, SISTER_PREFIX, requireSister, sisterNotFound } from './door';
import { isCloseMode, isUuid, namesCompany, parseActing, parseCompanyRequest, parseMembers } from './contract';
import { closeCompany, findRoofLeeCompany, mayCloseCompany, provisionCompany, sisterStatus } from './companies';
import { syncMembers } from './members';
import { isIdempotencyKey, once } from './idempotency';

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
  logFailure(what, err);
  if (!res.headersSent) res.status(500).json({ error: 'Archie could not finish this request. Send it again.' });
}

export function registerSisterRoutes(app: Express): void {
  // Make the company, or bring it up to date. Version 1 signature (the body names the company).
  app.post(COMPANIES, requireSister(1), async (req: Request, res: Response) => {
    try {
      const parsed = parseCompanyRequest(req.sister?.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const done = await provisionCompany(parsed.value);
      res.status(done.created ? 201 : 200).json({ companyId: done.companyId, ...(done.skipped.length ? { skipped: done.skipped } : {}) });
      // The slow part (the company's advisors and knowledge base) comes after
      // the answer. It only fills in what is missing, so a repeat costs little.
      if (done.live) {
        waitUntil(runAsCompany(done.companyId, () => seedCompany()).catch((e) => logFailure('setting up a new company', e)));
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
      res.status(answer.status).json(answer.body);
    } catch (e) {
      failed(res, 'DELETE company', e);
    }
  });

  // Last: whatever no route above answered.
  app.use(SISTER_PREFIX, sisterNotFound());
}
