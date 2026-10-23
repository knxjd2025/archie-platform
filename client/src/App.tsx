import { useState, useEffect } from 'react';
import { api } from './lib/api';
import SearchOverlay from './components/SearchOverlay';
import Dashboard from './pages/dashboard';
import Leads from './pages/leads';
import Integrations from './pages/integrations';
import { useAuth } from './lib/auth';
import { CompanyMark, PRODUCT_NAME, useCompany } from './lib/company';
import { canSeeMoney, type TeamRole } from '../../shared/rbac';
import Login from './pages/Login';
import Team from './pages/Team';
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
import { setBugPage } from './lib/bug-monitor';
import { FEATURES } from '../../shared/features';

type Page = 'meetings' | 'dashboard' | 'inbox' | 'leads' | 'sales' | 'client' | 'canvass' | 'kpis' | 'commission' | 'payouts' | 'cheat-sheet' | 'playbook' | 'sales-journey' | 'commercial-training' | 'chat' | 'conversations' | 'production' | 'claims' | 'documents' | 'schedule' | 'calls' | 'integrations' | 'team' | 'account' | 'assignments' | 'bugs';

/**
 * One source of truth for navigation — it drives the desktop top bar, the
 * desktop "More" panel and the mobile bottom bar and sheet.
 *
 * `primary` items are the five a person touches all day; they sit inline on
 * desktop and take the mobile bottom-bar slots. Everything else is filed under
 * a `group`, because a flat list of seventeen is a list nobody reads — grouped,
 * the same seventeen are four short columns you can scan in one look.
 *
 * `short` is the bottom-bar label: a two-word label wrapped onto two lines at
 * 390px and pushed the row out of alignment.
 */
type NavGroup = 'sell' | 'deliver' | 'money' | 'learn' | 'setup';

const GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'sell', label: 'Sell' },
  { key: 'deliver', label: 'Deliver' },
  { key: 'money', label: 'Money' },
  { key: 'learn', label: 'Learn' },
  { key: 'setup', label: 'Setup' },
];

const NAV: {
  page: Page; label: string; icon: string;
  primary?: boolean; soon?: boolean; group?: NavGroup; short?: string; external?: boolean;
}[] = [
  { page: 'dashboard', label: 'Home', icon: '🏠', primary: true },
  { page: 'leads', label: 'Leads', icon: '👥', primary: true },
  { page: 'conversations', label: 'Messages', icon: '✉️', primary: true },
  // Shown only while the Advisor feature flag is on (canSeePage filters it out otherwise).
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
  { page: 'sales-journey', label: 'Sales Journey', icon: '🧭', group: 'learn', external: true },
  { page: 'commercial-training', label: 'Commercial Training', icon: '🏢', group: 'learn', external: true },

  { page: 'assignments', label: 'Unassigned', icon: '🏷️', group: 'setup' },
  { page: 'team', label: 'Team', icon: '👤', group: 'setup' },
  { page: 'integrations', label: 'Integrations', icon: '🔌', group: 'setup' },
  { page: 'bugs', label: 'Bugs', icon: '🐞', group: 'setup' },
  { page: 'account', label: 'My Account', icon: '🗂️', group: 'setup' },
];

/** The role a person actually is, said the way a person would say it. */
const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  sales_director: 'Sales Director',
  manager: 'Sales Leader',
  customer_service: 'Customer Service',
  sales: 'Sales Rep',
  production: 'Production',
};

function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => {
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

  const { user, loading, offline, signOut } = useAuth();
  const company = useCompany();

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
    };
    document.title = titles[currentPage] ? `${titles[currentPage]} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [currentPage]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  if (!user) return <Login />;

  // Role-based menu: each person only sees tabs that fit their job.
  // admin ▸ manager ▸ sales ▸ production (higher roles are a superset).
  const isAdmin = user.role === 'admin';
  const isManagerPlus = user.role === 'admin' || user.role === 'manager';
  const isSalesPlus = user.role !== 'production'; // admin, manager, sales
  const canSeePage = (page: Page): boolean => {
    if (page === 'team' || page === 'integrations' || page === 'bugs') return isAdmin;
    // Payouts is no longer admin-only: a rep opens it to see what they are
    // owed. The server returns only their own rows and refuses every paying
    // action, so this is about whether the page is worth showing, not about
    // holding anything back. Customer service and production are excluded by
    // canSeeMoney — money must not leak sideways to a higher rank.
    // Commission is the same money: customer service is sales+ by rank but the
    // server refuses it /api/commissions, so the page would only show an error.
    if (page === 'payouts' || page === 'commission') return canSeeMoney(user.role as TeamRole, 'commissions');
    // Assignment decides whose book a job is in, and therefore who is paid for
    // it — a rep must not be able to move one onto themselves.
    if (page === 'assignments') return isManagerPlus;
    // Conversations / Production / Claims / Documents are open to sales+ but their
    // data is rep-scoped server-side (a sales user only sees their own clients) —
    // Claims isn't rep-scoped (whoever's coordinating the claim needs to see it
    // regardless of whose book the job is in), but stays in the same sales+ band.
    if (page === 'conversations' || page === 'calls' || page === 'production' || page === 'claims' || page === 'documents') return isSalesPlus;
    if (page === 'leads' || page === 'inbox' || page === 'sales' || page === 'client' || page === 'canvass' || page === 'kpis' || page === 'cheat-sheet' || page === 'playbook' || page === 'sales-journey' || page === 'commercial-training') return isSalesPlus;
    // The Advisor follows its switch (shared/features.ts): when that is
    // off the page is refused here and so drops out of the nav as well.
    if (page === 'chat') return FEATURES.advisor;
    // Every role may open Meetings; /api/meetings returns only the meetings
    // that role is actually in, so a rep sees the sales meeting and no more.
    return true; // dashboard + schedule + meetings are open to everyone signed in
  };
  const activePage: Page = canSeePage(currentPage) ? currentPage : 'dashboard';
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
    // A standalone static build (its own engine, not a React page) — open it
    // rather than swap SPA state into a page that doesn't exist here.
    if (page === 'sales-journey') { window.open('/sales-journey/', '_blank', 'noopener'); return; }
    if (page === 'commercial-training') { window.open('/commercial-training/', '_blank', 'noopener'); return; }
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
            <nav className="hidden md:flex items-center gap-1 justify-end">
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
            <button
              onClick={() => setSearchOpen(true)}
              className="flex-shrink-0 h-9 rounded-full hover:bg-white/10 flex items-center justify-center gap-1.5 px-2 lg:pr-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title="Search clients (⌘K)"
              aria-label="Search clients"
            >
              <span aria-hidden className="text-lg leading-none">🔍</span>
              <kbd className="hidden lg:inline text-[10px] font-sans font-medium text-white/50 border border-white/25 rounded px-1 py-0.5">⌘K</kbd>
            </button>
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
                      <span className="inline-block mt-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{ROLE_LABEL[user.role] || user.role}</span>
                    </div>
                    {canSeePage('account') && (
                      <button
                        onClick={() => go('account')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <span aria-hidden className="w-5 text-center">🗂️</span>My Account
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

      {/* Main Content */}
      <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-8">
        {activePage === 'meetings' && <Meetings onNavigate={handleNavigate} />}
        {activePage === 'dashboard' && (
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
        {activePage === 'bugs' && <Bugs />}
      </main>

      <BugReportButton page={NAV.find((n) => n.page === activePage)?.label ?? activePage} />

      {/* Mobile bottom nav */}
      <nav
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
      </nav>

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
