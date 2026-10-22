/**
 * Neighbor letters (shared/neighbor-letters.ts): the prefill for a job, and
 * the office settings an admin sets once (estimate-tool link, booking link,
 * mailing address). Rep-scoped — a rep can only prefill from a job in their
 * own book, and the fields never carry the customer's name or house number.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { clientReports, leads, settings, teamMembers } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { logWrite } from '../writes/log';
import { currentProfile } from '../tenant/context';
import { warrantyFor } from '../lib/reports/product-warranty';
import { letterCompanyFrom, officeAddressOf, streetOnly, type LetterKind } from '../../shared/neighbor-letters';
import { sendFailure } from '../lib/failure';

const SETTINGS_KEY = 'neighbor_letters';

export interface NeighborLetterSettings { estimateUrl: string; bookingUrl: string; officeAddress: string }

async function loadSettings(): Promise<NeighborLetterSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY));
  const v = (row?.value ?? {}) as Partial<NeighborLetterSettings>;
  // No default links: a letter only offers an estimate tool or a booking
  // page the company has set. The mailing address defaults to its profile.
  return {
    estimateUrl: v.estimateUrl || '',
    bookingUrl: v.bookingUrl || '',
    officeAddress: v.officeAddress || officeAddressOf(currentProfile()),
  };
}

const isHttpUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

/**
 * "What your neighbor is getting" — the template says to copy it from the
 * APPROVED proposal in JobTread. An approved Proposal/Estimate/Presentation
 * wins; failing that the newest one of those, labelled as not yet approved;
 * never an Inspection's default quote. Empty on a repair or when nothing was
 * proposed, and the section drops out of the letter.
 */
async function gettingLinesFor(jobExternalId: string): Promise<{ lines: string[]; source: string | null }> {
  const rows = await db.select({ data: clientReports.data, type: clientReports.reportType, docStatus: clientReports.jobtreadDocStatus })
    .from(clientReports)
    .where(and(eq(clientReports.jobExternalId, jobExternalId), eq(clientReports.status, 'succeeded')))
    .orderBy(desc(clientReports.createdAt)).limit(12);
  const priced = rows.filter((r) => r.type === 'proposal' || r.type === 'estimate' || r.type === 'presentation');
  const ordered = [...priced.filter((r) => r.docStatus === 'approved'), ...priced.filter((r) => r.docStatus !== 'approved')];
  for (const r of ordered) {
    const d: any = r.data;
    const opts: any[] = Array.isArray(d?.replacementOptions) ? d.replacementOptions : [];
    if (!opts.length) continue;
    const sel = opts.find((o) => o.tier === (d.selectedTier ?? 'better')) ?? opts[1] ?? opts[0];
    const product = sel?.product;
    if (!product?.name) continue;
    const w = warrantyFor(product);
    const lines = [w.certainteed ? `A complete CertainTeed Integrity Roof System with ${product.name} shingles` : `A complete new ${product.name} roof system`];
    if (w.manufacturerYears) lines.push(`A ${w.manufacturerYears}-year ${w.manufacturer} product warranty`);
    lines.push('Properly sized attic ventilation to help the roof last longer');
    return { lines, source: r.docStatus === 'approved' ? `approved ${r.type}` : `latest ${r.type} (not yet approved in JobTread — check before using)` };
  }
  return { lines: [], source: null };
}

export function registerNeighborLetterRoutes(app: Express) {
  // Everything the letters can be filled with for this job.
  app.get('/api/clients/:externalId/neighbor-letters/context', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead?.externalId) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      const [me] = await db.select({ name: teamMembers.name, phone: teamMembers.phone, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.email, user.email));
      const [office, getting] = await Promise.all([loadSettings(), gettingLinesFor(lead.externalId).catch(() => ({ lines: [] as string[], source: null as string | null }))]);
      res.json({
        repName: me?.name || user.name,
        repCell: me?.phone || '',
        streetName: streetOnly(lead.address),
        cityStateZip: [lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        insuranceJob: !!lead.insuranceClaim,
        stage: lead.stage,
        company: letterCompanyFrom(currentProfile()),
        gettingLines: getting.lines,
        gettingSource: getting.source,
        ...office,
        canEditSettings: user.role === 'admin',
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/neighbor-letters/context');
    }
  });

  // Admin sets the links and mailing address once; every rep's letters use them.
  app.put('/api/neighbor-letters/settings', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const cur = await loadSettings();
      const next: NeighborLetterSettings = {
        estimateUrl: req.body?.estimateUrl !== undefined ? String(req.body.estimateUrl).trim() : cur.estimateUrl,
        bookingUrl: req.body?.bookingUrl !== undefined ? String(req.body.bookingUrl).trim() : cur.bookingUrl,
        officeAddress: req.body?.officeAddress !== undefined ? String(req.body.officeAddress).trim().slice(0, 200) : cur.officeAddress,
      };
      if ((next.estimateUrl && !isHttpUrl(next.estimateUrl)) || (next.bookingUrl && !isHttpUrl(next.bookingUrl))) return res.status(400).json({ error: 'Links must be full http(s) URLs, or left blank.' });
      if (!next.officeAddress) return res.status(400).json({ error: 'The mailing address is required on the email footer.' });
      await db.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [settings.companyId, settings.key], set: { value: next, updatedAt: new Date() } });
      res.json({ ok: true, ...next });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/neighbor-letters/settings');
    }
  });

  // A rep used a letter (copied or printed) — an audit line, so the office
  // can see canvassing activity per job.
  app.post('/api/clients/:externalId/neighbor-letters/used', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const kind = String(req.body?.kind || '') as LetterKind;
      const how = String(req.body?.how || 'copied').slice(0, 20);
      if (!['leave_behind', 'email', 'mailer'].includes(kind)) return res.status(400).json({ error: 'kind must be leave_behind, email or mailer.' });
      await logWrite({ actor: user.email, system: 'app', action: 'neighbor_letter', targetId: req.params.externalId, summary: `${kind} ${how}`, ok: true, error: null });
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/neighbor-letters/used');
    }
  });
}
