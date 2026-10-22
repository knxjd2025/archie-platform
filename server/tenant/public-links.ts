/**
 * Public links (a shared report, a signing page, a completion certificate) are
 * opened by homeowners who are not signed in, so the request carries no
 * company. The link's token says which row it is for; this finds that row's
 * company with one narrow system lookup and runs the rest of the request as
 * that company, so the handler sees only that company's data.
 *
 * An unknown token runs the handler with no company at all: every query then
 * finds nothing, and the handler answers "not found" as it always has.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { clientReports, jobCertificates, signatureSigners } from '../../shared/schema';
import { isCompanyId, runAsCompany, runAsSystem } from './context';

type TokenTable = PgTable & { companyId: PgColumn };

/** The company that owns the row whose `column` equals `token`, or null. */
export async function companyForToken(table: TokenTable, column: PgColumn, token: string): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) return null;
  const rows = await runAsSystem('public link: find the company for a token', () =>
    db.select({ companyId: table.companyId }).from(table).where(eq(column, token)).limit(2));
  // Tokens are random and unique; anything else is treated as unknown.
  if (rows.length !== 1) return null;
  const id = (rows[0] as { companyId: unknown }).companyId;
  return isCompanyId(id) ? id : null;
}

/** Middleware: run the rest of the request as the company that owns `req.params[param]`. */
export function companyFromToken(table: TokenTable, column: PgColumn, param = 'token'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    companyForToken(table, column, String(req.params[param] ?? '')).then((companyId) => {
      if (companyId) runAsCompany(companyId, next);
      else next();
    }, next);
  };
}

/** /r/:token — a shared report. */
export const reportLinkCompany = (): RequestHandler => companyFromToken(clientReports as unknown as TokenTable, clientReports.shareToken);
/** /r/sign/:token — a completion certificate. */
export const certificateLinkCompany = (): RequestHandler => companyFromToken(jobCertificates as unknown as TokenTable, jobCertificates.signToken);
/** /r/s/:token — a document out for signature. */
export const signerLinkCompany = (): RequestHandler => companyFromToken(signatureSigners as unknown as TokenTable, signatureSigners.token);
