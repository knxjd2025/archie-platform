import type { Request, Response, NextFunction } from 'express';
import { isCompanyId, runAsCompany } from './context';

/**
 * Runs the rest of the request as the signed-in person's company, so every
 * query it makes sees only that company's rows. Registered right after the
 * session middleware. A request with no signed-in company (sign-in pages,
 * public share links, webhooks, crons) carries no company and has to set one
 * itself (runAsCompany) or look one up (runAsSystem) before touching data.
 */
export function tenantFromSession(req: Request, _res: Response, next: NextFunction): void {
  const companyId = req.session?.user?.companyId;
  if (isCompanyId(companyId)) {
    runAsCompany(companyId, next);
    return;
  }
  next();
}
