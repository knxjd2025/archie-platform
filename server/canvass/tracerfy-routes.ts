/**
 * Tracerfy on the canvass map: pull one address's owner + roof facts, or draw
 * an area, filter it for roofing prospects, preview the count and cost for
 * free, then pull every home's contact info in one paid job.
 *
 * Money: every paid call is behind an explicit button that states the credit
 * cost; previews and balance checks are free. A pull is capped at
 * MAX_ROWS_PER_PULL rows. Nothing here runs on a schedule.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { canvassAreas, canvassEnrichment, canvassProperties, canvassPropertyMeta } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import type { SessionUser } from '../access/rep-scope';
import { canSeeOwner, canvassOwner, loadVisibleProperty, ownerWhere, propertyByAddress, visibleOwnersFor, type VisibleOwners } from './access';
import { parseUsAddress } from '../lib/reports/address-utils';
import { logWrite } from '../writes/log';
import { TracerfyClient, TracerfyError, mapLeadRow, mapPropertyLookup, bestCleanPhone, type EnrichedProperty } from '../integrations/tracerfy';
import {
  isAreaShape, pointInShape, tracerfyGeography, tracerfyOverrides, filtersForPreset,
  CREDITS_PER_LEAD_ROW, CREDITS_PER_PROPERTY_LOOKUP, MAX_ROWS_PER_PULL, ROOFING_PRESETS, type AreaFilters, type AreaShape,
} from '../../shared/canvass-areas';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';

const client = () => new TracerfyClient();

function sendError(res: Response, e: any, fallback: string) {
  // A TracerfyError is ours: the status and the wording are both deliberate.
  if (e instanceof TracerfyError) return res.status(e.status === 503 ? 503 : e.status === 402 ? 402 : 502).json({ error: e.message });
  return sendFailure(res, e, 'tracerfy', 500, fallback);
}

/** The filters off a request body, bounded to what the map can send. */
export function parseFilters(b: any): AreaFilters {
  const base = filtersForPreset(String(b?.preset || 'custom'));
  const numOr = (v: any, lo: number, hi: number) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), lo), hi) : null);
  const f: AreaFilters = {
    ...base,
    propertyType: ['SFR', 'MFH', 'CONDO', 'ANY'].includes(b?.propertyType) ? b.propertyType : base.propertyType,
    yearBuiltMin: b?.yearBuiltMin !== undefined ? numOr(b.yearBuiltMin, 1800, 2100) : base.yearBuiltMin ?? null,
    yearBuiltMax: b?.yearBuiltMax !== undefined ? numOr(b.yearBuiltMax, 1800, 2100) : base.yearBuiltMax ?? null,
    valueMin: b?.valueMin !== undefined ? numOr(b.valueMin, 0, 1e8) : base.valueMin ?? null,
    valueMax: b?.valueMax !== undefined ? numOr(b.valueMax, 0, 1e8) : base.valueMax ?? null,
    ownerOccupied: b?.ownerOccupied === true ? true : b?.ownerOccupied === false ? false : b?.ownerOccupied === null ? null : base.ownerOccupied ?? null,
    highEquity: b?.highEquity !== undefined ? !!b.highEquity : !!base.highEquity,
    freeClear: b?.freeClear !== undefined ? !!b.freeClear : !!base.freeClear,
    yearsOwnedMin: b?.yearsOwnedMin !== undefined ? numOr(b.yearsOwnedMin, 0, 100) : base.yearsOwnedMin ?? null,
    excludeListed: b?.excludeListed !== undefined ? !!b.excludeListed : !!base.excludeListed,
    roofScoreMin: b?.roofScoreMin !== undefined ? numOr(b.roofScoreMin, 0, 100) : base.roofScoreMin ?? null,
  };
  return f;
}

/** Upsert the enrichment row for a canvassed home and mirror the owner's best clean contact onto it. */
async function saveEnrichment(propertyId: number, e: EnrichedProperty, opts: { areaId: number | null; inArea: boolean | null; credits: number; by: string; raw?: any }) {
  const best = bestCleanPhone(e.phones);
  const values = {
    canvassPropertyId: propertyId, areaId: opts.areaId, source: 'tracerfy', inArea: opts.inArea,
    ownerName: e.ownerName, owner2Name: e.owner2Name, mailingAddress: e.mailingAddress,
    phones: e.phones, emails: e.emails, litigator: e.litigator, contactClean: e.contactClean,
    propertyType: e.propertyType, yearBuilt: e.yearBuilt, buildingSqft: e.buildingSqft,
    roofMaterial: e.roofMaterial, roofConstruction: e.roofConstruction,
    estimatedValue: e.estimatedValue, equityPercent: e.equityPercent, yearsOwned: e.yearsOwned,
    ownerOccupied: e.ownerOccupied, absenteeOwner: e.absenteeOwner, highEquity: e.highEquity, freeClear: e.freeClear,
    vacant: e.vacant, mlsActive: e.mlsActive, roofScore: e.roofScore, sellScore: e.sellScore,
    raw: opts.raw ?? null, creditsSpent: opts.credits, createdBy: opts.by, updatedAt: new Date(),
  };
  await db.insert(canvassEnrichment).values(values)
    .onConflictDoUpdate({ target: canvassEnrichment.canvassPropertyId, set: values });
  // The rep's hand-typed contact wins; fill only what is empty.
  const [row] = await db.select({ ownerName: canvassProperties.ownerName, phone: canvassProperties.phone, email: canvassProperties.email, lat: canvassProperties.lat, lng: canvassProperties.lng })
    .from(canvassProperties).where(eq(canvassProperties.id, propertyId));
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (row && !row.ownerName && e.ownerName) patch.ownerName = e.ownerName;
  if (row && !row.phone && best) patch.phone = best.number;
  if (row && !row.email && e.emails[0]) patch.email = e.emails[0].email;
  if (row && row.lat == null && e.lat != null && e.lng != null) { patch.lat = e.lat; patch.lng = e.lng; }
  if (Object.keys(patch).length > 1) await db.update(canvassProperties).set(patch).where(eq(canvassProperties.id, propertyId));
}

/**
 * Find-or-create the canvass row for a delivered address (the list keys on the
 * address, case-insensitively). A house another rep already works stays
 * theirs: the puller gets 'taken' rather than that rep's door.
 */
async function propertyForRow(e: EnrichedProperty, by: string, visible: VisibleOwners): Promise<number | 'taken' | null> {
  if (!e.address) return null;
  const full = [e.address, e.city, e.state].filter(Boolean).join(', ');
  const mine = (found: Awaited<ReturnType<typeof propertyByAddress>>): number | 'taken' | null => {
    if (!found) return null;
    return canSeeOwner(visible, canvassOwner(found.row.createdBy, found.meta?.ownerEmail)) ? found.row.id : 'taken';
  };
  const existing = await propertyByAddress(full);
  if (existing) return mine(existing);
  try {
    const [row] = await db.insert(canvassProperties).values({
      address: full, city: e.city, state: e.state, zip: e.zip, lat: e.lat, lng: e.lng,
      status: 'not_knocked', createdBy: by,
    }).returning({ id: canvassProperties.id });
    return row.id;
  } catch (err: any) {
    if (String(err?.code) === '23505') return mine(await propertyByAddress(full));
    throw err;
  }
}

/** When a Tracerfy list is done, bring every row in as a canvassed home. */
/**
 * Paid Tracerfy calls had no ceiling: a stuck button, a retry loop or a
 * curious rep could spend the company's credits as fast as requests go out.
 * An area pull costs up to MAX_ROWS_PER_PULL rows, so it gets a tight limit; a
 * single-address lookup is what a rep taps at every door, so it gets room for
 * a busy afternoon. Keyed per person and per limiter, so one does not eat the
 * other's allowance (the limiter's buckets are shared by key).
 */
const HOUR = 60 * 60 * 1000;
const tracerfyKey = (kind: string) => (req: Request) => `tracerfy:${kind}:${req.session?.user?.email || req.ip || 'anon'}`;
const areaPullLimiter = rateLimit(10, HOUR, undefined, tracerfyKey('area'));
const lookupLimiter = rateLimit(60, HOUR, undefined, tracerfyKey('lookup'));

/** Runs a limiter inline, so a free cached answer never counts against it. False when it refused (and has already responded). */
function withinLimit(limiter: ReturnType<typeof rateLimit>, req: Request, res: Response): boolean {
  let ok = false;
  limiter(req, res, () => { ok = true; });
  return ok;
}

async function importArea(areaId: number, user: SessionUser): Promise<{ delivered: number; inArea: number; taken: number; credits: number | null }> {
  const by = user.email;
  const visible = await visibleOwnersFor(user);
  const [area] = await db.select().from(canvassAreas).where(eq(canvassAreas.id, areaId));
  if (!area?.tracerfyListId) throw new Error('No Tracerfy list on this area.');
  const tf = client();
  const [status, rows] = await Promise.all([tf.listStatus(area.tracerfyListId), tf.listRows(area.tracerfyListId)]);
  const shape = area.shape as AreaShape;
  let inArea = 0, delivered = 0, taken = 0;
  // Every delivered row has already been paid for, so none is thrown away.
  // roofScoreMin used to drop low scorers here, after Tracerfy had charged for
  // them. The area view sorts by roof score, so the best doors still lead.
  for (const raw of rows) {
    const e = mapLeadRow(raw);
    if (!e.address) continue;
    const id = await propertyForRow(e, by, visible);
    if (id === 'taken') { taken++; continue; }
    if (!id) continue;
    const inside = e.lat != null && e.lng != null ? pointInShape({ lat: e.lat, lng: e.lng }, shape) : null;
    if (inside) inArea++;
    delivered++;
    await saveEnrichment(id, e, { areaId, inArea: inside, credits: CREDITS_PER_LEAD_ROW, by, raw });
  }
  const credits = status.credits_deducted ?? null;
  await db.update(canvassAreas).set({
    status: 'complete', deliveredCount: delivered, inAreaCount: inArea, creditsDeducted: credits,
    completedAt: new Date(), updatedAt: new Date(),
  }).where(eq(canvassAreas.id, areaId));
  await logWrite({ actor: by, system: 'tracerfy', action: 'import_area', targetId: String(areaId), summary: `${delivered} homes (${inArea} inside the drawing, ${taken} already another rep's), ${credits ?? '?'} credits`, ok: true, error: null });
  return { delivered, inArea, taken, credits };
}

export function registerTracerfyRoutes(app: Express) {
  // Is Tracerfy connected, and how many credits are left? Free.
  app.get('/api/canvass/tracerfy/status', requireAuth, async (_req: Request, res: Response) => {
    const tf = client();
    if (!tf.configured) return res.json({ configured: false, presets: ROOFING_PRESETS });
    try {
      const a = await tf.analytics();
      res.json({ configured: true, sandbox: tf.sandbox, balance: a.balance, presets: ROOFING_PRESETS, costs: { leadRow: CREDITS_PER_LEAD_ROW, propertyLookup: CREDITS_PER_PROPERTY_LOOKUP, maxRows: MAX_ROWS_PER_PULL } });
    } catch (e: any) { sendError(res, e, 'Could not reach Tracerfy.'); }
  });

  // One address: owner, phones (with DNC/TCPA flags), emails, roof + property facts. 10 credits on a hit.
  app.post('/api/canvass/:id/enrich', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const found = await loadVisibleProperty(user, Number(req.params.id));
      if (!found) return res.status(404).json({ error: 'not found' });
      const { row } = found;
      const [have] = await db.select().from(canvassEnrichment).where(eq(canvassEnrichment.canvassPropertyId, row.id));
      if (have && req.body?.refresh !== true) return res.json({ ok: true, enrichment: have, cached: true });
      if (!withinLimit(lookupLimiter, req, res)) return;

      const p = parseUsAddress(row.address);
      const tf = client();
      const body = await tf.propertyLookup({ address: p.address || row.address, city: p.city || row.city, state: p.state || row.state, zip: p.zip || row.zip });
      const e = mapPropertyLookup(body);
      await logWrite({ actor: user.email, system: 'tracerfy', action: 'property_lookup', targetId: String(row.id), summary: `${row.address}: ${e ? 'hit' : 'miss'}`, ok: true, error: null });
      if (!e) return res.status(404).json({ error: 'Tracerfy has no record for that address (no credits used).' });
      await saveEnrichment(row.id, e, { areaId: null, inArea: null, credits: Number(body?.credits_deducted) || CREDITS_PER_PROPERTY_LOOKUP, by: user.email, raw: body?.property ?? null });
      const [saved] = await db.select().from(canvassEnrichment).where(eq(canvassEnrichment.canvassPropertyId, row.id));
      res.json({ ok: true, enrichment: saved, creditsDeducted: body?.credits_deducted ?? null });
    } catch (e: any) { sendError(res, e, 'Could not look that address up.'); }
  });

  // Draw → filter → count and cost. Free; pins are optional.
  app.post('/api/canvass/areas/preview', requireAuth, async (req: Request, res: Response) => {
    try {
      const shape = req.body?.shape;
      if (!isAreaShape(shape)) return res.status(400).json({ error: 'Draw an area on the map first.' });
      const filters = parseFilters(req.body?.filters);
      const requested = Math.min(Math.max(Number(req.body?.requestedCount) || 100, 1), MAX_ROWS_PER_PULL);
      const geography = tracerfyGeography(shape);
      const tf = client();
      const r = await tf.previewList({ geography, filter_overrides: tracerfyOverrides(filters), requested_count: requested, include_pins: true });
      const pins = Array.isArray(r.pins) ? r.pins.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) : [];
      const inside = pins.filter((p) => pointInShape({ lat: p.latitude, lng: p.longitude }, shape));
      res.json({
        ok: true, geography, filters, overrides: tracerfyOverrides(filters),
        matchesInRadius: r.count, willDeliver: Math.min(r.capped_count ?? requested, requested),
        credits: r.max_credit_cost, usd: r.max_credit_cost_usd,
        pins: pins.map((p) => ({ lat: p.latitude, lng: p.longitude, inside: pointInShape({ lat: p.latitude, lng: p.longitude }, shape) })),
        pinsInside: inside.length, pinsSampled: pins.length,
      });
    } catch (e: any) { sendError(res, e, 'Preview failed.'); }
  });

  // The paid pull. Creates the area, starts the Tracerfy list, returns at once; poll GET /areas/:id.
  app.post('/api/canvass/areas', requireAuth, areaPullLimiter, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const shape = req.body?.shape;
      if (!isAreaShape(shape)) return res.status(400).json({ error: 'Draw an area on the map first.' });
      const filters = parseFilters(req.body?.filters);
      const requested = Math.min(Math.max(Number(req.body?.requestedCount) || 100, 1), MAX_ROWS_PER_PULL);
      const name = String(req.body?.name || '').trim().slice(0, 120) || `Area ${new Date().toLocaleDateString('en-US')}`;
      const geography = tracerfyGeography(shape);
      const tf = client();
      const started = await tf.executeList({ geography, filter_overrides: tracerfyOverrides(filters), requested_count: requested, name: `BRN ${name}` });
      const [area] = await db.insert(canvassAreas).values({
        name, shape, filters, geography, status: 'running', tracerfyListId: started.id,
        previewCount: Number(req.body?.previewCount) || null, requestedCount: requested, createdBy: user.email,
      }).returning();
      await logWrite({ actor: user.email, system: 'tracerfy', action: 'pull_area', targetId: String(area.id), summary: `${name}: up to ${requested} homes, up to ${started.max_credit_cost} credits`, ok: true, error: null });
      res.json({ ok: true, area });
    } catch (e: any) { sendError(res, e, 'Could not start the pull.'); }
  });

  app.get('/api/canvass/areas', requireAuth, async (req: Request, res: Response) => {
    try {
      const visible = await visibleOwnersFor(req.session.user! as SessionUser);
      const rows = (await db.select().from(canvassAreas).orderBy(desc(canvassAreas.createdAt)).limit(300))
        .filter((a) => canSeeOwner(visible, canvassOwner(a.createdBy, null)))
        .slice(0, 100);
      res.json({ areas: rows });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/canvass/areas', 500); }
  });

  // Poll: while Tracerfy is working this reports progress; once done it imports the rows and says so.
  app.get('/api/canvass/areas/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [area] = await db.select().from(canvassAreas).where(eq(canvassAreas.id, Number(req.params.id)));
      if (!area || !canSeeOwner(await visibleOwnersFor(user), canvassOwner(area.createdBy, null))) {
        return res.status(404).json({ error: 'not found' });
      }
      if (area.status !== 'running' || !area.tracerfyListId) return res.json({ ok: true, area });
      const st = await client().listStatus(area.tracerfyListId);
      if (st.status === 'failed' || st.status === 'error') {
        const [failed] = await db.update(canvassAreas).set({ status: 'failed', error: st.error_message || 'Tracerfy reported a failure', updatedAt: new Date() }).where(eq(canvassAreas.id, area.id)).returning();
        return res.json({ ok: true, area: failed });
      }
      if (st.status !== 'complete' && st.status !== 'completed') {
        return res.json({ ok: true, area, progress: { percent: st.progress_percent ?? null, stage: st.progress_stage || st.status } });
      }
      // Claim the import so two polls cannot both do it.
      const [claimed] = await db.update(canvassAreas).set({ status: 'importing', updatedAt: new Date() })
        .where(and(eq(canvassAreas.id, area.id), eq(canvassAreas.status, 'running'))).returning();
      if (!claimed) return res.json({ ok: true, area: { ...area, status: 'importing' } });
      try {
        const result = await importArea(area.id, user);
        const [done] = await db.select().from(canvassAreas).where(eq(canvassAreas.id, area.id));
        res.json({ ok: true, area: done, imported: result });
      } catch (e: any) {
        const [failed] = await db.update(canvassAreas).set({ status: 'failed', error: e?.message || 'import failed', updatedAt: new Date() }).where(eq(canvassAreas.id, area.id)).returning();
        res.json({ ok: true, area: failed });
      }
    } catch (e: any) { sendError(res, e, 'Could not check the pull.'); }
  });

  // Every enriched home for the list/map — joined client-side by canvass id.
  app.get('/api/canvass/enrichment', requireAuth, async (req: Request, res: Response) => {
    try {
      const areaId = Number(req.query.areaId);
      const ids = String(req.query.ids || '').split(',').map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
      const clauses: SQL[] = [];
      // Owner contact data is the most sensitive thing on the map, so it is
      // scoped to the houses this user may see, like the pins themselves.
      const scope = ownerWhere(await visibleOwnersFor(req.session.user! as SessionUser));
      if (scope) clauses.push(scope);
      if (Number.isInteger(areaId) && areaId > 0) clauses.push(eq(canvassEnrichment.areaId, areaId));
      if (ids.length) clauses.push(inArray(canvassEnrichment.canvassPropertyId, ids));
      const rows = await db.select({ e: canvassEnrichment }).from(canvassEnrichment)
        .innerJoin(canvassProperties, eq(canvassProperties.id, canvassEnrichment.canvassPropertyId))
        .leftJoin(canvassPropertyMeta, eq(canvassPropertyMeta.canvassPropertyId, canvassProperties.id))
        .where(clauses.length ? and(...clauses) : undefined)
        .orderBy(desc(canvassEnrichment.roofScore)).limit(2000);
      res.json({ enrichment: rows.map(({ e: { raw, ...r } }) => r) });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/canvass/enrichment', 500); }
  });
}
