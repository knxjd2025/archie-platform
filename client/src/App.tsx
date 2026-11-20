import { useState, useEffect } from 'react';
import { api } from './lib/api';
import SearchOverlay from './components/SearchOverlay';
import Dashboard from './pages/dashboard';
import CrewHome from './pages/crew-home';
import { crewScreensFor } from './lib/crews-view';
import Leads from './pages/leads';
import Integrations from './pages/integrations';
import KynexProBanner from './components/KynexProBanner';
import { useAuth } from './lib/auth';
import { CompanyMark, PRODUCT_NAME, useCompany } from './lib/company';
import { ROLE_LABEL, type TeamRole } from '../../shared/rbac';
import { MENU_GROUPS, MENU_ITEMS, pageVisible, type MenuPage } from '../../shared/menu';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import { isSetPasswordPath } from './lib/password-pages';
import Team from './pages/Team';
import CompanyPage from './pages/company';
import AccountPage from './pages/account';
import Archie from './pages/archie';
import Canvass from './pages/canvass';
import Inbox from './pages/inbox';
import Kpis from './pages/kpis';
import Commission from './pages/commission';
import Payouts from './pages/payouts';
import CheatSheet from './pages/cheat-sheet';
import Playbook from './pages/playbook';
import Conversations from './pages/conversations';
import Production from './pages/production';
import Claims from './pages/claims';
import Sales from './pages/sales';
import Documents from './pages/documents';
import ClientDetail from './pages/client-detail';
import Schedule from './pages/schedule';
import Assignments from './pages/assignments';
import Meetings from './pages/meetings';
import CallsPage from './pages/calls';
import CallBar from './components/CallBar';
import BugReportButton from './components/BugReportButton';
import Bugs from './pages/bugs';
import Operator from './pages/operator';
import BillingPage from './pages/billing';
import BillingBanner from './components/BillingBanner';
import { useBillingStatus } from './lib/billing';
import { setBugPage } from './lib/bug-monitor';

// 'operator' is not on the company menu: it is for the people who run Archie,
// shown from the account menu when /api/auth/me says isOperator.
type Page = MenuPage | 'client' | 'operator';

/**
 * One source of truth for navigation: shared/menu.ts. It drives the desktop
 * top bar, the desktop "More" panel, the mobile bottom bar and sheet, and the
 * Company page's menu grid, and the server checks saved menu choices against it.
 *
 * `primary` items are the five a person touches all day; they sit inline on
 * desktop and take the mobile bottom-bar slots. Everything else is filed under
 * a `group`, because a flat list of seventeen is a list nobody reads; grouped,
 * the same seventeen are four short columns you can scan in one look.
 */
const GROUPS = MENU_GROUPS;
const NAV = MENU_ITEMS;

/** Stripe sends people back to /?billing=success (or cancelled, or portal): open the Billing page. */
const BILLING_RETURNS = ['success', 'cancelled', 'portal'];
function readBillingReturn(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get('billing');
    return v && BILLING_RETURNS.includes(v) ? v : null;
  } catch { return null; }
}

function App() {
  const [billingReturn] = useState<string | null>(readBillingReturn);
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    if (readBillingReturn()) return 'billing';
    try {
      const raw = localStorage.getItem('archie.page');
      // The Meetings page used to be called Monday.
      const saved = (raw === 'monday' ? 'meetings' : raw) as Page | null;
      return saved && saved !== 'client' ? saved : 'dashboard';
    } catch { return 'dashboard'; }
  });
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [pageData, setPageData] = useState<any>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [navMoreOpen, setNavMoreOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newLeads, setNewLeads] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // "← Back" on a client's detail page used to always land on Leads, even when
  // opened from Dashboard, Production, Schedule, Account or Search — this
  // remembers whichever page you actually came from.
  const [clientOrigin, setClientOrigin] = useState<Page>('leads');

  const { user, profile, loading, offline, signOut, isOperator } = useAuth();
  const company = useCompany();
  const billing = useBillingStatus(!!user);

  // Take ?billing=... out of the address bar once read, so a reload does not repeat it.
  useEffect(() => {
    if (!billingReturn) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
  }, [billingReturn]);

  useEffect(() => {
    if (!user) return;
    const load = () => api.get<{ newLeads: number; unreadMessages: number }>('/api/notifications')
      .then((r) => { setNewLeads(r.newLeads || 0); setUnreadMessages(r.unreadMessages || 0); })
      .catch((e) => console.error('[notifications]', e));
    load();
    // A background tab (left open on a desk overnight, etc.) was polling
    // this indefinitely. Skip the tick while hidden and catch up immediately
    // on refocus instead.
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [user]);

  // ⌘K / Ctrl+K opens global search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      // Every menu here could only be dismissed by clicking away from it.
      if (e.key === 'Escape') { setNavMoreOpen(false); setUserMenuOpen(false); setMoreOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // On page change: scroll to top, remember the tab, and update the browser title.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (currentPage !== 'client') {
      try { localStorage.setItem('archie.page', currentPage); } catch { /* ignore */ }
    }
    // Built from NAV so a new page can never quietly fall back to the
    // generic title; only the pages NAV does not list are named here.
    const titles: Record<string, string> = {
      ...Object.fromEntries(NAV.map((n) => [n.page, n.label])),
      client: 'Client',
      inbox: 'Inbox Leads',
      operator: 'Operator',
    };
    document.title = titles[currentPage] ? `${titles[currentPage]} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [currentPage]);

  // An emailed set-password link opens its page whoever is signed in here, and
  // before anything else renders, so the token leaves the address bar at once.
  // A successful set reloads to / and picks up the new session.
  if (isSetPasswordPath(window.location.pathname)) return <SetPassword />;
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  if (!user) return <Login />;

  // Role-based menu: each person only sees tabs that fit their job
  // (shared/menu.ts), less any the company's admin hid from their level on
  // the Company page. Hiding only narrows: a page the role may not see stays
  // out whatever is saved, and a hidden page is not reachable from a stored
  // "last page" either, because activePage falls back to Home.
  const isAdmin = user.role === 'admin';
  const hiddenPages = profile?.hiddenPages ?? [];
  // Billing-locked (server/billing/gate.ts answers 402 everywhere else): admins
  // see only the Billing page, everyone else a page asking them to tell their admin.
  const locked = billing.status.enabled && billing.status.locked;
  const canSeePage = (page: Page): boolean => {
    if (locked) return isAdmin && page === 'billing';
    if (page === 'operator') return isOperator;
    if (page === 'billing' && !billing.status.enabled) return false;
    return pageVisible(user.role as TeamRole, page, hiddenPages);
  };
  const activePage: Page = canSeePage(currentPage) ? currentPage : locked ? 'billing' : 'dashboard';
  // So a bug report, or an error caught on its own, says which screen it came from.
  setBugPage(activePage);

  const handleAgentChat = (agentRole: string) => {
    setSelectedAgent(agentRole);
    setCurrentPage('chat');
  };
  const handleNavigate = (page: string, data?: any) => {
    setCurrentPage(page as Page);
    setPageData(data || null);
  };

  const isActive = (page: Page) => activePage === page;
  const go = (page: Page) => {
    setCurrentPage(page); setMoreOpen(false); setNavMoreOpen(false); setUserMenuOpen(false);
  };
  const badgeFor = (page: Page) => (page === 'leads' ? newLeads : page === 'conversations' ? unreadMessages : 0);
  /** Three digits stretch the pill off the edge of the button; 99+ does not. */
  const badgeLabel = (n: number) => (n > 99 ? '99+' : String(n));
  const openClient = (externalId: string) => {
    setClientOrigin(currentPage);
    setPageData({ externalId }); setCurrentPage('client'); setSearchOpen(false);
  };

  const visible = NAV.filter((n) => canSeePage(n.page));
  const primary = visible.filter((n) => n.primary).slice(0, 5);
  const moreItems = visible.filter((n) => !primary.includes(n));
  const navPrimary = visible.filter((n) => n.primary);        // shown inline on desktop
  const navSecondary = visible.filter((n) => !n.primary);     // tucked under the desktop "More ▾"
  // The same secondary items, filed under their headings. A group with nothing
  // in it for this role simply does not appear.
  const grouped = GROUPS
    .map((g) => ({ key: g.key as string, label: g.label, items: navSecondary.filter((n) => n.group === g.key) }))
    .filter((g) => g.items.length > 0);
  // A page that is neither primary nor filed under a heading would render
  // nowhere — not in the desktop panel, not in the phone sheet — while still
  // counting towards the "More" button. It would simply be gone, and nothing
  // would say so. Anything unfiled lands here instead.
  const unfiled = navSecondary.filter((n) => !n.group);
  if (unfiled.length) grouped.push({ key: 'other', label: 'Other', items: unfiled });
  const activeGroup = grouped.find((g) => g.items.some((n) => isActive(n.page)));
  const initial = (user.name || user.email || '?').trim()[0]?.toUpperCase() || '?';

  return (
    <div className="min-h-screen bg-canvas">
      {/* Keyboard users had to tab the whole navigation on every page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-white focus:text-ink focus:px-3 focus:py-2 focus:rounded-lg focus:shadow-lg focus:ring-2 focus:ring-blue-400"
      >
        Skip to content
      </a>
      {/* The phone, for whoever answers at a computer. Renders nothing for
          everyone else, so a rep on a mobile never sees it and is never asked
          for the microphone. */}
      <CallBar onOpenClient={openClient} />
      {/* Offline: say so plainly. A rep who loses signal used to be shown the
          sign-in screen, which read as "you have been logged out". */}
      {offline && (
        <div
          role="status"
          className="bg-amber-500 text-white text-sm px-4 py-2 text-center flex items-center justify-center gap-2"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
        >
          <span aria-hidden>📡</span>
          <span><b>You're offline.</b> You can still read what's already loaded — anything you change will need a signal to save.</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-ink text-white border-b border-black/20 sticky top-0 z-40 shadow-sm" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-3">
            <button
              onClick={() => go('dashboard')}
              className="flex items-center gap-2.5 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title={`${company.displayName} on ${PRODUCT_NAME}: Home`}
              aria-label="Go to Home"
            >
              {company.logoUrl ? (
                <span className="bg-white rounded-lg px-2 py-1 flex items-center shadow-sm flex-shrink-0">
                  <CompanyMark profile={company} className="h-6 sm:h-7 w-auto max-w-[8rem] object-contain" />
                </span>
              ) : (
                <span className="flex-shrink-0 rounded-lg ring-1 ring-white/20"><CompanyMark profile={company} markSize={32} /></span>
              )}
              <span className="min-w-0 text-left leading-tight">
                {/* Whose app this is, then the product. A company with a logo already shows its name in it. */}
                {!company.logoUrl && company.id && <span className="block text-sm font-semibold text-white truncate max-w-[10rem] sm:max-w-[14rem]">{company.displayName}</span>}
                <span className={`block text-xs font-medium tracking-wide text-white/60 ${company.logoUrl || company.id ? 'hidden sm:block' : ''}`}>{PRODUCT_NAME}</span>
              </span>
            </button>

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            {/* Desktop nav — primary items inline, the rest under "More ▾" */}
            <nav className={`${locked ? 'hidden' : 'hidden md:flex'} items-center gap-1 justify-end`}>
              {navPrimary.map((n) => (
                <button
                  key={n.page}
                  onClick={() => go(n.page)}
                  aria-current={isActive(n.page) ? 'page' : undefined}
                  className={`relative px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                    isActive(n.page) ? 'bg-white text-ink shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {n.label}
                  {badgeFor(n.page) > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center"
                      aria-label={`${badgeFor(n.page)} new`}
                    >
                      {badgeLabel(badgeFor(n.page))}
                    </span>
                  )}
                </button>
              ))}
              {navSecondary.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setNavMoreOpen((v) => !v)}
                    aria-expanded={navMoreOpen}
                    aria-haspopup="true"
                    className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                      activeGroup ? 'bg-white text-ink shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {/* Saying which section you are in beats a bare "More" */}
                    {activeGroup ? activeGroup.label : 'More'} <span aria-hidden className="opacity-60">▾</span>
                  </button>
                  {navMoreOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setNavMoreOpen(false)} />
                      <div
                        role="menu"
                        aria-label="All sections"
                        // Two columns are right for a full menu and absurd for
                        // a production login, who sees one section.
                        className={`absolute right-0 mt-2 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-gray-200 shadow-xl z-50 overflow-hidden p-3 grid gap-x-3 gap-y-1 ${
                          grouped.length > 1 ? 'w-[34rem] grid-cols-2' : 'w-56 grid-cols-1'
                        }`}
                      >
                        {grouped.map((g) => (
                          <div key={g.key} className="break-inside-avoid">
                            <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</p>
                            {g.items.map((n) => (
                              <button
                                key={n.page}
                                role="menuitem"
                                onClick={() => go(n.page)}
                                aria-current={isActive(n.page) ? 'page' : undefined}
                                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                  isActive(n.page) ? 'bg-blue-50 text-ink font-semibold' : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                <span className="text-base w-5 text-center flex-shrink-0" aria-hidden>{n.icon}</span>
                                <span className="truncate">{n.label}</span>
                                {n.external && <span className="ml-auto text-gray-400 text-xs" title="Opens in a new tab" aria-label="opens in a new tab">↗</span>}
                                {n.soon && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Soon</span>}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </nav>

            {/* Search + user menu */}
            {/* The ⌘K shortcut has always worked; nothing ever said so. */}
            {!locked && <button
              onClick={() => setSearchOpen(true)}
              className="flex-shrink-0 h-9 rounded-full hover:bg-white/10 flex items-center justify-center gap-1.5 px-2 lg:pr-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title="Search clients (⌘K)"
              aria-label="Search clients"
            >
              <span aria-hidden className="text-lg leading-none">🔍</span>
              <kbd className="hidden lg:inline text-[10px] font-sans font-medium text-white/50 border border-white/25 rounded px-1 py-0.5">⌘K</kbd>
            </button>}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
                className="flex items-center gap-2 rounded-full hover:bg-white/10 p-1 sm:pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {/* The company color, ringed so it still shows on the header when the
                    company's color is navy like the header. */}
                <span className="w-8 h-8 rounded-full bg-brand text-on-brand ring-2 ring-white/30 text-sm font-semibold flex items-center justify-center">{initial}</span>
                <span className="hidden lg:block text-sm text-white/85 max-w-[9rem] truncate">{user.name || user.email}</span>
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900 truncate">{user.name || user.email}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      <span className="inline-block mt-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{ROLE_LABEL[user.role as TeamRole] || user.role}</span>
                    </div>
                    {canSeePage('account') && (
                      <button
                        onClick={() => go('account')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <span aria-hidden className="w-5 text-center">🗂️</span>My Account
                      </button>
                    )}
                    {isOperator && (
                      <button
                        onClick={() => go('operator')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <span aria-hidden className="w-5 text-center">🛠️</span>Operator
                      </button>
                    )}
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={() => { setUserMenuOpen(false); signOut(); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                    >
                      <span aria-hidden className="w-5 text-center">↩︎</span>Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
            </div>
          </div>
        </div>
      </header>

      {/* Admins only, until the company connects KynexPro. Blocks nothing. */}
      <KynexProBanner isAdmin={isAdmin && !locked} onConnect={() => go('integrations')} />
      {/* Admins only: the trial ends within 5 days, or a payment is past due. */}
      {isAdmin && !locked && <BillingBanner banner={billing.status.banner} onOpen={() => go('billing')} />}

      {/* Main Content */}
      <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-8">
        {locked && !isAdmin && (
          <div className="max-w-md mx-auto mt-10 rounded-xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-lg font-semibold text-gray-900">{billing.status.message || "Your company's Archie account needs attention. Ask your admin."}</p>
            <p className="mt-2 text-sm text-gray-600">Your work is saved. Once your admin sorts it out, Archie opens again.</p>
            <button
              type="button"
              onClick={() => signOut()}
              className="mt-5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        )}
        {activePage === 'billing' && isAdmin && <BillingPage returned={billingReturn} />}
        {activePage === 'meetings' && <Meetings onNavigate={handleNavigate} />}
        {/* A crew member of a company Roof Lee made lands on their crew's jobs. */}
        {activePage === 'dashboard' && crewScreensFor(company.madeByRoofli, user.role).crewHome && <CrewHome />}
        {activePage === 'dashboard' && !crewScreensFor(company.madeByRoofli, user.role).crewHome && (
          <Dashboard
            onAgentChat={handleAgentChat}
            onNavigate={handleNavigate}
            onOpenClient={openClient}
          />
        )}
        {activePage === 'leads' && (
          <Leads
            initialStatus={pageData?.status}
            initialNew={!!pageData?.newLead}
            initialPrefill={pageData?.prefill}
            onOpenClient={openClient}
          />
        )}
        {activePage === 'client' && pageData?.externalId && (
          // Keyed on the client: opening another customer from search while
          // already on a client page must REPLACE this component, not re-use it.
          // Without the key, React keeps the old fiber and every in-flight fetch
          // — and the write handlers below target `lead.externalId` from that
          // stale state, so a slow response could land an edit on the customer
          // the rep just navigated away from.
          <ClientDetail key={pageData.externalId} externalId={pageData.externalId} onBack={() => setCurrentPage(clientOrigin)} onOpenPlaybook={(docId) => handleNavigate('playbook', { docId, externalId: pageData.externalId })} />
        )}
        {activePage === 'canvass' && <Canvass />}
        {activePage === 'kpis' && <Kpis onOpenPlaybook={(docId) => handleNavigate('playbook', { docId })} />}
        {activePage === 'commission' && <Commission onOpenClient={openClient} onNavigate={handleNavigate} />}
        {activePage === 'payouts' && <Payouts onOpenClient={openClient} />}
        {activePage === 'inbox' && <Inbox onNavigate={handleNavigate} onOpenClient={openClient} />}
        {activePage === 'cheat-sheet' && <CheatSheet />}
        {activePage === 'playbook' && <Playbook key={`${pageData?.docId ?? ''}|${pageData?.externalId ?? ''}`} initialDocId={pageData?.docId} initialExternalId={pageData?.externalId} onOpenClient={openClient} />}
        {activePage === 'calls' && <CallsPage onOpenClient={openClient} />}
        {activePage === 'chat' && <Archie />}
        {activePage === 'conversations' && <Conversations />}
        {activePage === 'sales' && <Sales onOpenClient={openClient} />}
        {activePage === 'production' && (
          <Production onOpenClient={openClient} />
        )}
        {activePage === 'claims' && (
          <Claims onOpenClient={openClient} />
        )}
        {activePage === 'documents' && <Documents />}
        {activePage === 'schedule' && <Schedule onOpenClient={openClient} />}
        {activePage === 'assignments' && <Assignments onOpenClient={openClient} />}
        {activePage === 'integrations' && <Integrations />}
        {activePage === 'account' && (
          <AccountPage onOpenClient={openClient} />
        )}
        {activePage === 'team' && <Team />}
        {activePage === 'company' && <CompanyPage />}
        {activePage === 'operator' && <Operator />}
        {activePage === 'bugs' && <Bugs />}
      </main>

      <BugReportButton page={NAV.find((n) => n.page === activePage)?.label ?? activePage} />

      {/* Mobile bottom nav */}
      {!locked && <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.map((n) => (
          <button
            key={n.page}
            onClick={() => go(n.page)}
            aria-current={isActive(n.page) ? 'page' : undefined}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[3.5rem] text-[11px] font-medium transition-colors ${
              isActive(n.page) ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            {/* A bar along the top of the tab: colour alone is a weak signal on
                a small screen, and a weaker one for anyone colour-blind. */}
            {isActive(n.page) && <span aria-hidden className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-blue-600" />}
            {badgeFor(n.page) > 0 && (
              <span
                className="absolute top-1.5 right-1/2 translate-x-4 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center"
                aria-label={`${badgeFor(n.page)} new`}
              >
                {badgeLabel(badgeFor(n.page))}
              </span>
            )}
            <span className="text-xl leading-none" aria-hidden>{n.icon}</span>
            {/* `short` keeps a long name on one line at 390px */}
            <span className="truncate max-w-full px-0.5">{n.short || n.label}</span>
          </button>
        ))}
        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[3.5rem] text-[11px] font-medium transition-colors ${
              moreItems.some((m) => isActive(m.page)) ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            {moreItems.some((m) => isActive(m.page)) && <span aria-hidden className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-blue-600" />}
            <span className="text-xl leading-none" aria-hidden>⋯</span>
            <span>{activeGroup ? activeGroup.label : 'More'}</span>
          </button>
        )}
      </nav>}

      {/* "More" sheet (mobile) */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMoreOpen(false)} />
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-sm font-semibold text-gray-900">Everything else</p>
              <button onClick={() => setMoreOpen(false)} className="text-sm text-gray-500 px-2 py-1 -mr-1">Done</button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto">
              {grouped.map((g) => (
                <div key={g.key} className="mb-1">
                  <p className="px-1 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {g.items.map((n) => (
                      <button
                        key={n.page}
                        onClick={() => go(n.page)}
                        aria-current={isActive(n.page) ? 'page' : undefined}
                        className={`relative flex flex-col items-center gap-1 py-2.5 rounded-xl transition-colors ${
                          isActive(n.page) ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-xl" aria-hidden>{n.icon}</span>
                        <span className="text-[11px] font-medium leading-tight text-center px-1">{n.label}</span>
                        {n.soon && <span className="absolute top-1 right-1 text-[9px] font-semibold uppercase px-1 rounded bg-amber-100 text-amber-700">Soon</span>}
                        {n.external && <span className="absolute top-1 right-1.5 text-[10px] text-gray-400" aria-hidden>↗</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onSelect={openClient} />}
    </div>
  );
}

export default App;
