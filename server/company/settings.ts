/**
 * What an admin can change on the Company page: the main and accent colors,
 * the logo (server/company/logo.ts) and which menu items each user level sees.
 *
 * A company may read its own companies row but not write it (row level
 * security, migrations/0002), so the write here is system work, kept as
 * narrow as it can be: one UPDATE for exactly the signed-in admin's company
 * (from the request's tenant context, never from the request body), touching
 * only the named keys inside branding and settings. Every other key in those
 * two columns stays as it was.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { companies } from '../../shared/schema';
import { requireCompanyId, runAsSystem } from '../tenant/context';
import { getCurrentCompany } from '../tenant/companies';
import { clearProfileCache } from '../tenant/profile';
import { MIN_ACCENT_CONTRAST, isHexColor, readableWithWhite } from '../../shared/contrast';
import { hiddenPagesFor, validateMenuHidden, type MenuHidden } from '../../shared/menu';
import { ALL_ROLES } from '../../shared/rbac';

/** The keys PUT /api/company/settings accepts. Anything else is refused. */
export const CUSTOMIZATION_KEYS = ['primaryColor', 'accentColor', 'menuHidden'] as const;

export interface CompanyCustomization {
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  menuHidden: MenuHidden;
}

export interface CustomizationPatch {
  /** A color to save, or null to go back to Archie's. Absent: unchanged. */
  primaryColor?: string | null;
  accentColor?: string | null;
  menuHidden?: MenuHidden;
}

export type ValidatedCustomization =
  | { ok: true; patch: CustomizationPatch; adjusted: ColorAdjustments | null }
  | { ok: false; error: string };

/** Colors darkened so they stay readable, by key: what was sent and what was saved. */
export type ColorAdjustments = Partial<Record<'primaryColor' | 'accentColor', { from: string; to: string }>>;

const LABEL: Record<string, string> = { primaryColor: 'main color', accentColor: 'accent color' };

function color(key: 'primaryColor' | 'accentColor', v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === '') return { ok: true, value: null };
  if (!isHexColor(v)) return { ok: false, error: `The ${LABEL[key]} must be a hex color like #1F3A5F.` };
  return { ok: true, value: v.toUpperCase() };
}

/**
 * Check what the Company page sent. The main color carries white text in the
 * top bar and on buttons, so one too light for that is darkened until it
 * reads (4.5:1); the accent is small text on white, so it must reach 3:1.
 * `adjusted` says which were changed.
 */
export function validateCustomization(body: unknown): ValidatedCustomization {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Nothing to save.' };
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(CUSTOMIZATION_KEYS as readonly string[]).includes(key)) return { ok: false, error: `"${key}" cannot be changed here.` };
  }
  const patch: CustomizationPatch = {};
  const adjusted: ColorAdjustments = {};
  if ('primaryColor' in input) {
    const c = color('primaryColor', input.primaryColor);
    if (!c.ok) return c;
    if (c.value) {
      const readable = readableWithWhite(c.value);
      if (readable.adjusted) adjusted.primaryColor = { from: c.value, to: readable.color };
      patch.primaryColor = readable.color;
    } else patch.primaryColor = null;
  }
  if ('accentColor' in input) {
    const c = color('accentColor', input.accentColor);
    if (!c.ok) return c;
    if (c.value) {
      const readable = readableWithWhite(c.value, MIN_ACCENT_CONTRAST);
      if (readable.adjusted) adjusted.accentColor = { from: c.value, to: readable.color };
      patch.accentColor = readable.color;
    } else patch.accentColor = null;
  }
  if ('menuHidden' in input) {
    const m = validateMenuHidden(input.menuHidden);
    if (!m.ok) return m;
    patch.menuHidden = m.value;
  }
  return { ok: true, patch, adjusted: Object.keys(adjusted).length ? adjusted : null };
}

/** The current company's customization, as the Company page shows it. */
export async function readCustomization(): Promise<CompanyCustomization> {
  const company = await getCurrentCompany();
  if (!company) throw new Error('No company in context');
  const b = company.branding ?? {};
  const menuHidden: MenuHidden = {};
  for (const role of ALL_ROLES) {
    const pages = hiddenPagesFor(company.settings?.menuHidden, role);
    if (pages.length) menuHidden[role] = pages;
  }
  return {
    primaryColor: isHexColor(b.primaryColor) ? b.primaryColor.toUpperCase() : null,
    accentColor: isHexColor(b.accentColor) ? b.accentColor.toUpperCase() : null,
    logoUrl: typeof b.logoUrl === 'string' && b.logoUrl.trim() ? b.logoUrl.trim() : null,
    menuHidden,
  };
}

/** Keys to set or remove inside the current company's branding and settings. */
export interface CompanyJsonPatch {
  brandingSet?: Record<string, unknown>;
  brandingRemove?: string[];
  settingsSet?: Record<string, unknown>;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Apply a patch to the current company's branding and settings, as one
 * UPDATE of exactly that company's row. Unnamed keys are untouched: the
 * database merges the change into the stored jsonb rather than this code
 * writing back a copy it read earlier.
 *
 * `alongside` runs in the same transaction, for exactly the same company id
 * (the logo's bytes), so the row and its companion write land together or
 * not at all.
 */
export async function patchCurrentCompany(patch: CompanyJsonPatch, alongside?: (tx: Tx, companyId: string) => Promise<void>): Promise<void> {
  const companyId = requireCompanyId();
  let branding: SQL = sql`${companies.branding}`;
  for (const key of patch.brandingRemove ?? []) branding = sql`(${branding} - ${key}::text)`;
  if (patch.brandingSet && Object.keys(patch.brandingSet).length) branding = sql`(${branding} || ${JSON.stringify(patch.brandingSet)}::jsonb)`;
  const settings: SQL | undefined = patch.settingsSet && Object.keys(patch.settingsSet).length
    ? sql`(${companies.settings} || ${JSON.stringify(patch.settingsSet)}::jsonb)`
    : undefined;
  await runAsSystem('save the signed-in admin\'s own company branding and menu', () =>
    db.transaction(async (tx) => {
      if (alongside) await alongside(tx, companyId);
      const rows = await tx.update(companies)
        .set({ branding, ...(settings ? { settings } : {}), updatedAt: new Date() })
        .where(eq(companies.id, companyId))
        .returning({ id: companies.id });
      // Throwing rolls the companion write back too.
      if (rows.length !== 1) throw new Error('The company could not be updated.');
    }));
  clearProfileCache(companyId);
}

/** Save what validateCustomization returned. */
export async function saveCustomization(patch: CustomizationPatch): Promise<void> {
  const brandingSet: Record<string, unknown> = {};
  const brandingRemove: string[] = [];
  for (const key of ['primaryColor', 'accentColor'] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v) brandingSet[key] = v;
    else brandingRemove.push(key);
  }
  await patchCurrentCompany({
    brandingSet,
    brandingRemove,
    settingsSet: patch.menuHidden ? { menuHidden: patch.menuHidden } : undefined,
  });
}
