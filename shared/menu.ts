/**
 * The app's menu: every page a person can open from it, which roles may ever
 * see each one, and the pages a company has chosen to hide from a level.
 *
 * One list for the client (client/src/App.tsx draws the menu from it; the
 * Company page draws its grid from it) and the server (it checks what an
 * admin saves against it), so a page key can never mean one thing in one
 * place and something else in another.
 *
 * Hiding is about the menu only: it can narrow what a level sees, never widen
 * it. What a role may actually read is still decided by the server on every
 * request (shared/rbac.ts and each route's own checks).
 */
import { FEATURES } from './features';
import { ALL_ROLES, ROLE_LABEL, canSeeMoney, type TeamRole } from './rbac';

export type MenuGroup = 'sell' | 'deliver' | 'money' | 'learn' | 'setup';

export const MENU_GROUPS: { key: MenuGroup; label: string }[] = [
  { key: 'sell', label: 'Sell' },
  { key: 'deliver', label: 'Deliver' },
  { key: 'money', label: 'Money' },
  { key: 'learn', label: 'Learn' },
  { key: 'setup', label: 'Setup' },
];

export const MENU_PAGES = [
  'dashboard', 'leads', 'conversations', 'chat', 'schedule',
  'calls', 'meetings', 'inbox', 'canvass', 'sales',
  'production', 'claims', 'documents',
  'commission', 'payouts', 'kpis',
  'cheat-sheet', 'playbook',
  'assignments', 'team', 'company', 'billing', 'integrations', 'bugs', 'account',
] as const;

export type MenuPage = (typeof MENU_PAGES)[number];

export interface MenuItem {
  page: MenuPage;
  label: string;
  icon: string;
  /** The five a person touches all day: inline on desktop, the phone's bottom bar. */
  primary?: boolean;
  group?: MenuGroup;
  /** Bottom-bar label, when the full one wraps at 390px. */
  short?: string;
  soon?: boolean;
  external?: boolean;
}

/**
 * The menu, in order. `primary` items sit inline on desktop and take the
 * mobile bottom-bar slots; everything else is filed under a `group`.
 */
export const MENU_ITEMS: MenuItem[] = [
  { page: 'dashboard', label: 'Home', icon: '🏠', primary: true },
  { page: 'leads', label: 'Leads', icon: '👥', primary: true },
  { page: 'conversations', label: 'Messages', icon: '✉️', primary: true },
  // Shown only while the Advisor feature flag is on (roleCanSeePage filters it out otherwise).
  { page: 'chat', label: 'Archie Advisor', icon: '✨', primary: true, short: 'Advisor' },
  { page: 'schedule', label: 'Schedule', icon: '📅', primary: true },

  { page: 'calls', label: 'Calls', icon: '📞', group: 'sell' },
  { page: 'meetings', label: 'Meetings', icon: '🗓️', group: 'sell' },
  { page: 'inbox', label: 'Inbox Leads', icon: '📬', group: 'sell' },
  { page: 'canvass', label: 'Canvass', icon: '🚪', group: 'sell' },
  { page: 'sales', label: 'Sales Pipeline', icon: '📈', group: 'sell' },

  { page: 'production', label: 'Production', icon: '🏗️', group: 'deliver' },
  { page: 'claims', label: 'Claims', icon: '🧾', group: 'deliver' },
  { page: 'documents', label: 'Documents', icon: '📄', group: 'deliver' },

  { page: 'commission', label: 'Commission', icon: '💰', group: 'money' },
  { page: 'payouts', label: 'Payouts', icon: '💵', group: 'money' },
  { page: 'kpis', label: 'KPIs', icon: '📊', group: 'money' },

  { page: 'cheat-sheet', label: 'Cheat Sheet', icon: '📋', group: 'learn' },
  { page: 'playbook', label: 'Playbook', icon: '📚', group: 'learn' },

  { page: 'assignments', label: 'Unassigned', icon: '🏷️', group: 'setup' },
  { page: 'team', label: 'Team', icon: '👤', group: 'setup' },
  { page: 'company', label: 'Company', icon: '🎨', group: 'setup' },
  // Shown only while billing is on (STRIPE_SECRET_KEY set); App.tsx asks /api/billing/status.
  { page: 'billing', label: 'Billing', icon: '💳', group: 'setup' },
  { page: 'integrations', label: 'Integrations', icon: '🔌', group: 'setup' },
  { page: 'bugs', label: 'Bugs', icon: '🐞', group: 'setup' },
  { page: 'account', label: 'My Account', icon: '🗂️', group: 'setup' },
];

export const isMenuPage = (v: unknown): v is MenuPage => typeof v === 'string' && (MENU_PAGES as readonly string[]).includes(v);
export const isTeamRole = (v: unknown): v is TeamRole => typeof v === 'string' && (ALL_ROLES as string[]).includes(v);

/**
 * Whether a role may ever have this page in its menu, before any company
 * choice. Each person only sees the pages that fit their job.
 */
export function roleCanSeePage(role: TeamRole, page: MenuPage | 'client'): boolean {
  const isAdmin = role === 'admin';
  const isManagerPlus = role === 'admin' || role === 'manager';
  const isSalesPlus = role !== 'production'; // everyone but production
  if (page === 'team' || page === 'integrations' || page === 'bugs' || page === 'company' || page === 'billing') return isAdmin;
  // Payouts is no longer admin-only: a rep opens it to see what they are
  // owed. The server returns only their own rows and refuses every paying
  // action, so this is about whether the page is worth showing, not about
  // holding anything back. Customer service and production are excluded by
  // canSeeMoney: money must not leak sideways to a higher rank.
  // Commission is the same money: customer service is sales+ by rank but the
  // server refuses it /api/commissions, so the page would only show an error.
  if (page === 'payouts' || page === 'commission') return canSeeMoney(role, 'commissions');
  // Assignment decides whose book a job is in, and therefore who is paid for
  // it: a rep must not be able to move one onto themselves.
  if (page === 'assignments') return isManagerPlus;
  // Conversations / Production / Claims / Documents are open to sales+ but their
  // data is rep-scoped server-side (a sales user only sees their own clients).
  // Claims isn't rep-scoped (whoever's coordinating the claim needs to see it
  // regardless of whose book the job is in), but stays in the same sales+ band.
  if (page === 'conversations' || page === 'calls' || page === 'production' || page === 'claims' || page === 'documents') return isSalesPlus;
  if (page === 'leads' || page === 'inbox' || page === 'sales' || page === 'client' || page === 'canvass' || page === 'kpis' || page === 'cheat-sheet' || page === 'playbook') return isSalesPlus;
  // The Advisor follows its switch (shared/features.ts).
  if (page === 'chat') return FEATURES.advisor;
  // Every role may open Meetings; /api/meetings returns only the meetings
  // that role is actually in, so a rep sees the sales meeting and no more.
  return true; // dashboard, schedule, meetings and account are open to everyone signed in
}

/** Home is where the app lands, and where a hidden page falls back to, so no level can lose it. */
export const ALWAYS_SHOWN_PAGES: readonly MenuPage[] = ['dashboard'];

/** An admin cannot hide these from admins: it would lock the company out of putting things back. */
export const ADMIN_PROTECTED_PAGES: readonly MenuPage[] = ['company', 'team', 'billing', 'integrations'];

export type MenuCell = 'never' | 'locked_on' | 'switch';

/** What the Company page shows for one level and one page. */
export function menuCell(role: TeamRole, page: MenuPage): MenuCell {
  if (!roleCanSeePage(role, page)) return 'never';
  if (ALWAYS_SHOWN_PAGES.includes(page)) return 'locked_on';
  if (role === 'admin' && ADMIN_PROTECTED_PAGES.includes(page)) return 'locked_on';
  return 'switch';
}

/** Pages hidden per level. Stored on companies.settings.menuHidden. */
export type MenuHidden = Partial<Record<TeamRole, MenuPage[]>>;

/**
 * Check a menuHidden map an admin sent. Unknown levels, unknown pages, pages
 * the level never sees and the locked cells are all refused, with a sentence
 * that says which. Returns the cleaned map (sorted, no duplicates, no empty lists).
 */
export function validateMenuHidden(input: unknown): { ok: true; value: MenuHidden } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'The menu settings are not in the right shape.' };
  const out: MenuHidden = {};
  for (const [role, pages] of Object.entries(input as Record<string, unknown>)) {
    if (!isTeamRole(role)) return { ok: false, error: `"${role}" is not a user level.` };
    if (!Array.isArray(pages)) return { ok: false, error: 'Each level needs a list of pages.' };
    const seen = new Set<MenuPage>();
    for (const page of pages) {
      if (!isMenuPage(page)) return { ok: false, error: `"${String(page)}" is not a menu item.` };
      const cell = menuCell(role, page);
      if (cell === 'never') return { ok: false, error: `${labelFor(page)} is never on the ${roleName(role)} menu, so it cannot be hidden.` };
      if (cell === 'locked_on') {
        return {
          ok: false,
          error: role === 'admin'
            ? `${labelFor(page)} cannot be hidden from Admin, or nobody could change these settings back.`
            : `${labelFor(page)} cannot be hidden.`,
        };
      }
      seen.add(page);
    }
    if (seen.size) out[role] = MENU_PAGES.filter((p) => seen.has(p));
  }
  return { ok: true, value: out };
}

/**
 * The pages to leave out of one person's menu, from what the company saved.
 * Anything stale (a page that no longer exists, a locked cell) is ignored, so
 * a saved setting can only ever narrow the menu.
 */
export function hiddenPagesFor(menuHidden: unknown, role: TeamRole): MenuPage[] {
  if (!menuHidden || typeof menuHidden !== 'object') return [];
  const list = (menuHidden as Record<string, unknown>)[role];
  if (!Array.isArray(list)) return [];
  return MENU_PAGES.filter((p) => list.includes(p) && menuCell(role, p) === 'switch');
}

/** Whether this person's menu shows the page: their role allows it and the company has not hidden it. */
export function pageVisible(role: TeamRole, page: MenuPage | 'client', hidden: readonly string[] = []): boolean {
  if (page !== 'client' && !isMenuPage(page)) return false; // a stale "last page" from an older version
  if (!roleCanSeePage(role, page)) return false;
  if (page === 'client') return true;
  return menuCell(role, page) !== 'switch' || !hidden.includes(page);
}

const labelFor = (page: MenuPage) => MENU_ITEMS.find((m) => m.page === page)?.label ?? page;
const roleName = (role: TeamRole) => ROLE_LABEL[role];
