import type { Express, Request, Response } from 'express';
import { and, or, eq, isNotNull, inArray, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { deals } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { isScoped, repJobNames } from '../access/rep-scope';
import { sendFailure } from '../lib/failure';

export interface ApprovedDoc {
  id: number;
  customer: string | null;
  jobRef: string | null;
  type: string | null;
  amount: number | null;
  status: string | null;
  issueDate: string | null;
  signedAt: string | null;
}

export function registerDocumentRoutes(app: Express) {
  // Per-client signed/approved customer proposals & contracts (from synced deals
  // = JobTread customerOrder docs). Rep-scoped for sales users by job.
  app.get('/api/documents/approved', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      // "Approved" = the customer signed it, or the doc status is approved.
      const approvedClause = or(isNotNull(deals.signedAt), eq(deals.status, 'approved')) as SQL;

      let where: SQL = approvedClause;
      if (isScoped(user)) {
        const jobNames = await repJobNames(user);
        if (!jobNames || jobNames.length === 0) {
          return res.json({ documents: [] }); // rep owns no jobs → no docs
        }
        where = and(approvedClause, inArray(deals.jobRef, jobNames)) as SQL;
      }

      const rows = await db
        .select()
        .from(deals)
        .where(where)
        // Newest first by signed date, else issue date. Plain DESC would put
        // NULL signed_at rows ahead of everything (and push the newest signed
        // docs past the 500 cap), so compare one combined day key, nulls last.
        .orderBy(
          sql`coalesce(to_char(${deals.signedAt}, 'YYYY-MM-DD'), ${deals.issueDate}) desc nulls last`,
          sql`${deals.signedAt} desc nulls last`,
          desc(deals.id),
        )
        .limit(500);

      const documents: ApprovedDoc[] = rows.map((d) => ({
        id: d.id,
        customer: d.customer,
        jobRef: d.jobRef,
        type: d.type,
        amount: d.amount != null ? Number(d.amount) : null,
        status: d.status,
        issueDate: d.issueDate,
        signedAt: d.signedAt ? d.signedAt.toISOString() : null,
      }));

      res.json({ documents });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/documents/approved', 500, 'could not load documents');
    }
  });
}
