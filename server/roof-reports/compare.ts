/**
 * GET /api/roof-reports/compare?a=<id>&b=<id>
 *
 * Two finished reports, side by side. No model is called and nothing is counted.
 *
 * Each id goes through exactly the check of opening a report (`roofReportFor`):
 * a report the person may not see, another company's, an archived one, one that
 * is not there and an id that is not an id are all the same answer, "one of those
 * two reports could not be found", and that answer carries nothing of the other
 * report. The two are read before anything is said, so there is never half a
 * comparison. What goes back is only what a comparison needs (`summaryOf`): no
 * customer, no notes, no photos, no link.
 */
import type { Router } from 'express';
import { COMPARE_FAILED, COMPARE_NOT_FOUND, COMPARE_NOT_READY, COMPARE_PICK_TWO } from '../../shared/roof-reports';
import { sendFailure } from '../lib/failure';
import { roofReportFor, roofReportUser } from './access';
import { summaryOf } from './compare-summary';
import { effectiveState } from './store';

export function registerCompareRoute(router: Router): void {
  router.get('/compare', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const a = req.query.a;
      const b = req.query.b;
      // Two different ids, each given once, as text. Anything else is not a request for two reports.
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a.toLowerCase() === b.toLowerCase()) {
        res.status(400).json({ error: COMPARE_PICK_TWO });
        return;
      }
      const [first, second] = [await roofReportFor(user, a), await roofReportFor(user, b)];
      // Either one missing is the same plain answer, said before anything of the other is read.
      if (!first || !second) {
        res.status(404).json({ error: COMPARE_NOT_FOUND });
        return;
      }
      const ready = (row: typeof first) => effectiveState(row).status === 'ready' && row.reportJson !== null;
      if (!ready(first) || !ready(second)) {
        res.status(409).json({ error: COMPARE_NOT_READY });
        return;
      }
      res.json({ a: summaryOf(first), b: summaryOf(second) });
    } catch (error) {
      sendFailure(res, error, 'GET /api/roof-reports/compare', 500, COMPARE_FAILED);
    }
  });
}
