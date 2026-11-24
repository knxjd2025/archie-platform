/**
 * Rewriting one finding or the summary with a model:
 *
 *   POST /api/roof-reports/:id/rewrite-finding   { index }
 *   POST /api/roof-reports/:id/rewrite-summary   {}
 *
 * Behind the switch and the sign-in, with the same right as editing the report
 * (`rewrite` in ROOF_REPORT_RULES). Only a person's click calls a model.
 *
 * Each call goes through the metered caller, so it writes one cost row for the
 * company that caused it, tagged with the report; the model id is the `rewrite`
 * role in models.ts and nowhere else. The model is asked only about that
 * report's own finding (or findings, for the summary) and the roof facts
 * (`promptFacts`), under ONE deadline. What it writes is cleaned and cut
 * (`cleanRewrite`) and stored only through the same normalizer a hand edit goes
 * through, and only if the report has not changed since it was read: an edit made
 * in the meantime wins and nothing is overwritten. A failure of any kind is one
 * plain sentence and changes nothing; no provider words, no error text, no id.
 *
 * A report and a company each have a daily limit, counted and taken in one locked
 * step (uses.ts), so requests that arrive together cannot overrun it. A rewrite
 * that reached the model counts even if it did not work (it may have cost money);
 * one that could not start (no model set up) uses nothing up.
 */
import type { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { roofReports } from '../../shared/schema';
import {
  MAX_REWRITES_PER_COMPANY_PER_DAY, MAX_REWRITES_PER_REPORT_PER_DAY, NOT_FOUND, REWRITE_CHANGED, REWRITE_COMPANY_CAPPED, REWRITE_FAILED, REWRITE_NOT_AVAILABLE,
  REWRITE_NOT_READY, REWRITE_NO_SUCH, REWRITE_REPORT_CAPPED, REWRITE_TOO_FAST,
} from '../../shared/roof-reports';
import { teamMemberIdByEmail } from '../access/rep-scope';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { createDeadline } from '../lib/roof-reports/deadline.js';
import { providerCaller, type ModelCaller } from '../lib/roof-reports/model-call.js';
import { regenerateSummaryWithClaude, rewriteFindingWithClaude } from '../lib/roof-reports/claude-report-narrator.js';
import type { NarrativeFinding, StormSummarySection } from '../lib/roof-reports/comprehensive-roof-report.js';
import { logWrite } from '../writes/log';
import { decisionFor, roofReportFor, roofReportUser } from './access';
import { kindOf } from './failure-kind';
import { modelKeysFromEnv } from './generate';
import { meteredModelCaller } from './metered';
import { photosOfReport } from './photos';
import { MAX_FINDING_TEXT, MAX_SUMMARY_TEXT, applyRewrite, cleanRewrite, parseRewriteBody, promptFacts, type RewriteTarget } from './rewrite-text';
import { effectiveState } from './store';
import { finishUse, reserveUse } from './uses';
import { sanitizeReportJson } from './validate';

export interface RewriteCaps { perReport: number; perCompany: number }

export interface RewriteOptions {
  /** The model to ask, for a report; null when none is set up. Only a test replaces the real one. */
  model?: (reportId: string) => ModelCaller | null;
  caps?: () => RewriteCaps;
  /** The one deadline, in milliseconds. */
  deadlineMs?: number;
}

const DEFAULT_CAPS = (): RewriteCaps => ({ perReport: MAX_REWRITES_PER_REPORT_PER_DAY, perCompany: MAX_REWRITES_PER_COMPANY_PER_DAY });
const DEFAULT_DEADLINE_MS = 60_000;

/** The real model: the rewrite role is Anthropic's, so without that key there is nothing to ask. */
function realModel(): ModelCaller | null {
  const keys = modelKeysFromEnv();
  return keys.anthropic ? providerCaller(keys) : null;
}

export function registerRewriteRoutes(router: Router, options: RewriteOptions = {}): void {
  const modelFor = options.model ?? (() => realModel());
  const caps = options.caps ?? DEFAULT_CAPS;
  const limiter = rateLimit(30, 10 * 60 * 1000, (_req, res) => { res.json({ error: REWRITE_TOO_FAST }); });

  async function handle(kind: 'finding' | 'summary', req: import('express').Request, res: import('express').Response): Promise<void> {
    const where = kind === 'finding' ? 'POST /api/roof-reports/:id/rewrite-finding' : 'POST /api/roof-reports/:id/rewrite-summary';
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row || decisionFor(user.role, 'rewrite') === 'no') { res.status(404).json({ error: NOT_FOUND }); return; }
      if (effectiveState(row).status !== 'ready' || row.reportJson === null) { res.status(409).json({ error: REWRITE_NOT_READY }); return; }
      const saved = row.reportJson as Record<string, unknown>;
      const facts = promptFacts(saved);

      let target: RewriteTarget;
      if (kind === 'finding') {
        const parsed = parseRewriteBody(req.body, facts.findings.length);
        if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
        target = { kind: 'finding', index: parsed.index };
      } else {
        if (req.body !== undefined && req.body !== null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length > 0)) { res.status(400).json({ error: REWRITE_NO_SUCH }); return; }
        target = { kind: 'summary' };
      }

      const base = modelFor(row.id);
      if (!base) { res.status(503).json({ error: REWRITE_NOT_AVAILABLE }); return; }

      const limit = caps();
      const reserved = await reserveUse({ kind: 'rewrite', reportId: row.id, memberId: await teamMemberIdByEmail(user.email), perReport: limit.perReport, perCompany: limit.perCompany });
      if (reserved.kind === 'report_capped') { res.status(429).json({ error: REWRITE_REPORT_CAPPED }); return; }
      if (reserved.kind === 'company_capped') { res.status(429).json({ error: REWRITE_COMPANY_CAPPED }); return; }
      if (reserved.kind !== 'reserved') { res.status(409).json({ error: REWRITE_FAILED }); return; }
      const useId = reserved.id;

      let reachedModel = false;
      try {
        const opts = { call: meteredModelCaller(base, { operation: 'rewrite', ref: row.id }), signal: createDeadline(options.deadlineMs ?? DEFAULT_DEADLINE_MS) };
        reachedModel = true;
        const asked = target.kind === 'finding'
          ? await rewriteFindingWithClaude(facts.findings[target.index] as NarrativeFinding, undefined, opts)
          : await regenerateSummaryWithClaude(facts.findings as NarrativeFinding[], facts.roofDetails, facts.stormHistory as StormSummarySection | undefined, opts);
        const text = cleanRewrite(asked, target.kind === 'finding' ? MAX_FINDING_TEXT : MAX_SUMMARY_TEXT);
        if (!text) { await finishUse(useId, 'failed'); res.status(502).json({ error: REWRITE_FAILED }); return; }

        // Only through the normalizer, and only if nobody changed the report while the model was thinking.
        const own = (await photosOfReport(row.id)).map((p) => p.id);
        const checked = sanitizeReportJson(applyRewrite(saved, target, text), row.id, own);
        if (!checked.ok) { await finishUse(useId, 'failed'); res.status(502).json({ error: REWRITE_FAILED }); return; }
        const [stored] = await db.update(roofReports).set({ reportJson: checked.value as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(and(eq(roofReports.id, row.id), eq(roofReports.status, 'ready'), sql`date_trunc('milliseconds', ${roofReports.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`)).returning({ id: roofReports.id });
        if (!stored) { await finishUse(useId, 'failed'); res.status(409).json({ error: REWRITE_CHANGED }); return; }
        await finishUse(useId, 'done');
        await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_rewrite', targetId: row.id, summary: target.kind === 'finding' ? 'roof report finding rewritten' : 'roof report summary rewritten', ok: true, error: null });
        res.json({ status: 'rewritten', text, report: checked.value });
      } catch (error) {
        try { await finishUse(useId, reachedModel ? 'failed' : 'unused'); } catch { /* the place is let go of after ten minutes anyway */ }
        console.error('[roof-reports] a rewrite did not finish:', kindOf(error));
        await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_rewrite', targetId: row.id, summary: 'roof report rewrite did not finish', ok: false, error: kindOf(error) });
        res.status(502).json({ error: REWRITE_FAILED });
      }
    } catch (error) {
      sendFailure(res, error, where, 500, REWRITE_FAILED);
    }
  }

  router.post('/:id/rewrite-finding', limiter, (req, res) => handle('finding', req, res));
  router.post('/:id/rewrite-summary', limiter, (req, res) => handle('summary', req, res));
}
