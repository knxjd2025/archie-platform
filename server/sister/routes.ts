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
import { SISTER_PREFIX, requireSister, sisterNotFound } from './door';
import { parseCompanyRequest } from './contract';
import { provisionCompany } from './companies';

const COMPANIES = `${SISTER_PREFIX}/v1/companies`;

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

  // Last: whatever no route above answered.
  app.use(SISTER_PREFIX, sisterNotFound());
}
