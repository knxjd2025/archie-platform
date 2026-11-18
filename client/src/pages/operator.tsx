import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { ROLE_LABEL, type TeamRole } from '../../../shared/rbac';
import { PLAN_LABEL, formatDollars, type Plan } from '../../../shared/billing/pricing';

/**
 * The Operator page: for the people who run Archie (ARCHIE_OPERATOR_EMAILS),
 * not for anyone inside a roofing company. Every company, its numbers, and
 * the everyday jobs that used to need SQL or a script: make a company, pause
 * or resume it, and make a sign-in link for someone. The server checks every
 * request (server/operator/routes.ts); this page only decides what to show.
 */

interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  status: Status;
  createdAt: string;
  trialEndsAt: string | null;
  members: number;
  canSignIn: number;
  lastSignInAt: string | null;
  kynexProConnected: boolean;
  leads30d: number;
  messages30d: number;
  /** What the team costs now (shared/billing/pricing.ts), and Stripe's subscription status. */
  plan: Plan;
  seats: number;
  monthlyTotalCents: number;
  subscriptionStatus: string | null;
  noSubscription: boolean;
  seatSyncFailed: boolean;
}
interface TeamRow { id: number; name: string; email: string; role: string; active: boolean; canSignIn: boolean; hasPassword: boolean; lastSignInAt: string | null }
interface AuditRow { at: string; operatorEmail: string; action: string; details: Record<string, unknown> }
interface CompanyDetail extends CompanySummary { team: TeamRow[]; integrations: string[]; recentActions: AuditRow[] }
type Status = 'trial' | 'active' | 'paused' | 'cancelled';

const PAGE = 50;

const STATUS_STYLE: Record<Status, string> = {
  trial: 'bg-blue-50 text-blue-700 ring-blue-200',
  active: 'bg-green-50 text-green-700 ring-green-200',
  paused: 'bg-amber-50 text-amber-800 ring-amber-200',
  cancelled: 'bg-gray-100 text-gray-600 ring-gray-300',
};
const STATUS_LABEL: Record<Status, string> = { trial: 'Trial', active: 'Active', paused: 'Paused', cancelled: 'Cancelled' };

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${STATUS_STYLE[status] ?? STATUS_STYLE.cancelled}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const DAY = 24 * 60 * 60 * 1000;

const SUBSCRIPTION_LABEL: Record<string, string> = {
  active: 'Paying', trialing: 'Card on file', past_due: 'Past due', unpaid: 'Unpaid', canceled: 'Cancelled',
  incomplete: 'Incomplete', incomplete_expired: 'Payment failed', paused: 'Paused',
};

/** "Team, 5 seats, $397/mo". */
const planText = (c: Pick<CompanySummary, 'plan' | 'seats' | 'monthlyTotalCents'>): string =>
  `${PLAN_LABEL[c.plan] ?? c.plan}, ${c.seats} ${c.seats === 1 ? 'seat' : 'seats'}, ${formatDollars(c.monthlyTotalCents)}/mo`;

/** Stripe's status in plain words, or a "No subscription" flag. */
function SubscriptionBadge({ c }: { c: Pick<CompanySummary, 'subscriptionStatus' | 'noSubscription' | 'seatSyncFailed'> }) {
  const bad = c.subscriptionStatus === 'past_due' || c.subscriptionStatus === 'unpaid' || c.subscriptionStatus === 'canceled' || c.subscriptionStatus === 'incomplete_expired';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {c.noSubscription && !c.subscriptionStatus ? (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap bg-orange-50 text-orange-800 ring-orange-200">No subscription</span>
      ) : (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${bad ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-green-50 text-green-700 ring-green-200'}`}>
          {SUBSCRIPTION_LABEL[c.subscriptionStatus ?? ''] ?? c.subscriptionStatus}
        </span>
      )}
      {c.seatSyncFailed && <span className="text-xs text-red-700" title="The last seat update to Stripe failed. It is retried every hour.">Seats not synced</span>}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Today", "Yesterday", "5 days ago", then a date. */
function ago(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/** "Ends in 9 days", "Ended 3 days ago", or nothing when there is no trial end. */
function trialText(c: Pick<CompanySummary, 'status' | 'trialEndsAt'>): string {
  if (!c.trialEndsAt) return c.status === 'trial' ? 'No end date' : '';
  const days = Math.ceil((new Date(c.trialEndsAt).getTime() - Date.now()) / DAY);
  if (days > 1) return `Ends in ${days} days`;
  if (days === 1) return 'Ends tomorrow';
  if (days === 0) return 'Ends today';
  return `Ended ${-days} day${days === -1 ? '' : 's'} ago`;
}

const ACTION_LABEL: Record<string, string> = {
  'company.create': 'Company created',
  'company.status': 'Status changed',
  'member.reset_link': 'Reset link made',
};

function actionText(a: AuditRow): string {
  const d = a.details || {};
  if (a.action === 'company.status') {
    const to = STATUS_LABEL[d.to as Status] ?? String(d.to);
    const from = STATUS_LABEL[d.from as Status] ?? String(d.from);
    const ended = Number(d.sessionsEnded) || 0;
    return `${from} to ${to}${ended ? `, ${ended} signed out` : ''}`;
  }
  if (a.action === 'member.reset_link') return `For ${String(d.email ?? '')}`;
  if (a.action === 'company.create') return d.adminEmail ? `Admin ${String(d.adminEmail)}` : '';
  return '';
}

/** Copy text, with a fallback for browsers that refuse the clipboard API. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** A sign-in link shown once, with a Copy button and when it stops working. */
function LinkBox({ link, note, label }: { link: string; note: string; label: string }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="text-xs font-medium text-green-900 mb-2">{label}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          readOnly
          value={link}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-green-300 bg-white px-2 py-2 text-xs text-gray-800 font-mono"
        />
        <button
          type="button"
          onClick={async () => setCopied((await copyText(link)) ? 'yes' : 'no')}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-xs text-green-900">{note}</p>
      {copied === 'no' && <p className="mt-1 text-xs text-red-700">Could not copy. Select the link and copy it by hand.</p>}
      <p className="mt-1 text-xs text-green-800/80">This link is shown only now. Send it to the person by text or email.</p>
    </div>
  );
}

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const primaryBtn = 'rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-dark disabled:opacity-50';
const quietBtn = 'rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

/** A centered dialog on a desktop, a sheet from the bottom on a phone. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-m-2 p-2 text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; adminEmail: string; welcomeLink: string; seeded: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ company: { id: string; name: string }; admin: { email: string }; welcomeLink: string; seeded: boolean }>(
        '/api/operator/companies', { companyName, adminName, adminEmail }, { timeoutMs: 120_000 });
      setDone({ id: r.company.id, name: r.company.name, adminEmail: r.admin.email, welcomeLink: r.welcomeLink, seeded: r.seeded });
      onCreated(r.company.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the company. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Dialog title="Company created" onClose={onClose}>
        <p className="text-sm text-gray-700 mb-3">
          <b>{done.name}</b> is ready, on a free trial. Send <b>{done.adminEmail}</b> this link so they can choose a password and sign in.
        </p>
        <LinkBox link={done.welcomeLink} label="Welcome link" note="Works once, expires in 3 days." />
        {!done.seeded && (
          <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            The starter advisors and knowledge base did not finish loading. Archie fills them in on its own within a day.
          </p>
        )}
        <button onClick={onClose} className={`${primaryBtn} w-full mt-4`}>Done</button>
      </Dialog>
    );
  }

  return (
    <Dialog title="New company" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="op-company" className="block text-xs font-medium text-gray-600 mb-1">Company name</label>
          <input id="op-company" required maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={field} placeholder="Acme Roofing" />
        </div>
        <div>
          <label htmlFor="op-admin-name" className="block text-xs font-medium text-gray-600 mb-1">Admin's name</label>
          <input id="op-admin-name" required maxLength={120} value={adminName} onChange={(e) => setAdminName(e.target.value)} className={field} placeholder="Jordan Smith" />
        </div>
        <div>
          <label htmlFor="op-admin-email" className="block text-xs font-medium text-gray-600 mb-1">Admin's email</label>
          <input id="op-admin-email" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={field} placeholder="jordan@acmeroofing.com" />
        </div>
        <p className="text-xs text-gray-500">
          The company starts on a free trial. You get a welcome link to send the admin yourself.
        </p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${quietBtn} sm:flex-1`}>Cancel</button>
          <button type="submit" disabled={busy} className={`${primaryBtn} sm:flex-1`}>{busy ? 'Making the company…' : 'Make company'}</button>
        </div>
      </form>
    </Dialog>
  );
}

type StatusChange = { to: Status; verb: string };

function ConfirmStatusDialog({ company, change, onClose, onDone }: {
  company: CompanyDetail; change: StatusChange; onClose: () => void; onDone: (message: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsTyping = change.to === 'paused' || change.to === 'cancelled';
  const matches = typed.trim().toLowerCase() === company.name.trim().toLowerCase();

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ to: Status; sessionsEnded: number }>(`/api/operator/companies/${company.id}/status`, { status: change.to });
      const out = r.sessionsEnded ? ` ${r.sessionsEnded} ${r.sessionsEnded === 1 ? 'person was' : 'people were'} signed out.` : '';
      const now: Record<Status, string> = { trial: 'back on its trial', active: 'active', paused: 'paused', cancelled: 'cancelled' };
      onDone(`${company.name} is now ${now[r.to]}.${out}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status. Try again.');
      setBusy(false);
    }
  };

  const explain: Record<string, string> = {
    paused: 'Everyone at this company is signed out now and cannot sign in until you resume it. Their data stays as it is. Scheduled jobs stop for them.',
    cancelled: 'Everyone at this company is signed out now and cannot sign in. Their data stays in Archie. You can resume the company later if you need to.',
    active: 'The company can sign in again and its scheduled jobs start again.',
    trial: 'The company can sign in again and its scheduled jobs start again.',
  };

  return (
    <Dialog title={`${change.verb} ${company.name}?`} onClose={onClose}>
      <p className="text-sm text-gray-700 mb-3">{explain[change.to]}</p>
      {needsTyping && (
        <div className="mb-3">
          <label htmlFor="op-confirm" className="block text-xs font-medium text-gray-600 mb-1">
            Type the company name to confirm: <b className="text-gray-900">{company.name}</b>
          </label>
          <input id="op-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={field} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2">
        <button type="button" onClick={onClose} className={`${quietBtn} sm:flex-1`}>Keep as it is</button>
        <button
          type="button"
          onClick={go}
          disabled={busy || (needsTyping && !matches)}
          className={`sm:flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${needsTyping ? 'bg-red-600 hover:bg-red-700' : 'bg-green-700 hover:bg-green-800'}`}
        >
          {busy ? 'Working…' : change.verb}
        </button>
      </div>
    </Dialog>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 truncate" title={hint}>{value}</dd>
    </div>
  );
}

function CompanyPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<StatusChange | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});
  const [linkBusy, setLinkBusy] = useState<number | null>(null);
  const [linkError, setLinkError] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try { setDetail(await api.get<CompanyDetail>(`/api/operator/companies/${id}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the company.'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !change) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, change]);

  const makeLink = async (m: TeamRow) => {
    setLinkBusy(m.id);
    setLinkError((e) => ({ ...e, [m.id]: '' }));
    try {
      const r = await api.post<{ link: string }>(`/api/operator/companies/${id}/members/${m.id}/reset-link`, {});
      setLinks((l) => ({ ...l, [m.id]: r.link }));
      void load();
    } catch (err) {
      setLinkError((e) => ({ ...e, [m.id]: err instanceof Error ? err.message : 'Could not make a link.' }));
    } finally {
      setLinkBusy(null);
    }
  };

  const live = detail && (detail.status === 'trial' || detail.status === 'active');
  const resumeTo: Status = detail?.trialEndsAt && new Date(detail.trialEndsAt).getTime() > Date.now() ? 'trial' : 'active';

  // On document.body, above the app's sticky header and phone tab bar.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        aria-label="Company details"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6 py-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
          <button onClick={onClose} className="text-sm font-medium text-gray-600 hover:text-gray-900">← All companies</button>
          {detail && <StatusPill status={detail.status} />}
        </div>

        <div className="px-4 sm:px-6 py-5 space-y-6">
          {error && (
            <div className="text-sm text-red-600">{error} <button onClick={load} className="underline">Try again</button></div>
          )}
          {!detail && !error && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-5 rounded bg-gray-100 animate-pulse" />)}</div>}

          {detail && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 break-words">{detail.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5 break-all">{detail.slug}</p>
              </div>

              {toast && <p role="status" className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">{toast}</p>}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="Created" value={formatDate(detail.createdAt)} />
                <Fact label="Trial" value={trialText(detail) || 'Not on trial'} hint={detail.trialEndsAt ? formatDate(detail.trialEndsAt) : undefined} />
                <Fact label="People" value={`${detail.canSignIn} of ${detail.members} can sign in`} />
                <Fact label="Last sign-in" value={ago(detail.lastSignInAt)} />
                <Fact label="Leads, last 30 days" value={detail.leads30d} />
                <Fact label="Messages, last 30 days" value={detail.messages30d} />
                <Fact label="Plan" value={planText(detail)} />
                <Fact label="Subscription" value={<SubscriptionBadge c={detail} />} />
                <Fact label="KynexPro" value={detail.kynexProConnected ? 'Connected' : 'Not connected yet'} />
                <Fact label="Connected apps" value={detail.integrations.length ? detail.integrations.join(', ') : 'None yet'} hint={detail.integrations.join(', ')} />
              </dl>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Account</h3>
                <div className="flex flex-wrap gap-2">
                  {live ? (
                    <>
                      <button onClick={() => setChange({ to: 'paused', verb: 'Pause' })} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">Pause</button>
                      {detail.status === 'trial' && (
                        <button onClick={() => setChange({ to: 'active', verb: 'Mark as paying' })} className={quietBtn}>Mark as paying</button>
                      )}
                    </>
                  ) : (
                    <button onClick={() => setChange({ to: resumeTo, verb: 'Resume' })} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">Resume</button>
                  )}
                  {detail.status !== 'cancelled' && (
                    <button onClick={() => setChange({ to: 'cancelled', verb: 'Cancel account' })} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Cancel account</button>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {live ? 'Pausing signs everyone at this company out until you resume it.' : 'Nobody at this company can sign in right now.'}
                </p>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Team ({detail.team.length})</h3>
                {detail.team.length === 0 && <p className="text-sm text-gray-500">Nobody on the team yet.</p>}
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {detail.team.map((m) => (
                    <li key={m.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                          <p className="text-xs text-gray-500 truncate">{m.email}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {ROLE_LABEL[m.role as TeamRole] ?? m.role}
                            {' · '}
                            {m.canSignIn ? (m.hasPassword ? 'Can sign in' : 'Can sign in, no password yet') : 'Cannot sign in'}
                            {' · '}
                            Last sign-in {ago(m.lastSignInAt).toLowerCase()}
                          </p>
                        </div>
                        {m.canSignIn && live && !links[m.id] && (
                          <button
                            onClick={() => makeLink(m)}
                            disabled={linkBusy === m.id}
                            className="flex-shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {linkBusy === m.id ? 'Making…' : 'Make reset link'}
                          </button>
                        )}
                      </div>
                      {linkError[m.id] && <p className="mt-2 text-xs text-red-600">{linkError[m.id]}</p>}
                      {links[m.id] && (
                        <div className="mt-3">
                          <LinkBox link={links[m.id]} label={`Reset link for ${m.name}`} note="Works once, expires in 1 hour." />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">What operators did here</h3>
                {detail.recentActions.length === 0 ? (
                  <p className="text-sm text-gray-500">Nothing yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.recentActions.map((a, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-gray-900">{ACTION_LABEL[a.action] ?? a.action}</span>
                        {actionText(a) && <span className="text-gray-600">: {actionText(a)}</span>}
                        <span className="block text-xs text-gray-500">{new Date(a.at).toLocaleString()} by {a.operatorEmail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      {change && detail && (
        <ConfirmStatusDialog
          company={detail}
          change={change}
          onClose={() => setChange(null)}
          onDone={(msg) => { setChange(null); setToast(msg); setLinks({}); void load(); onChanged(); }}
        />
      )}
    </div>,
    document.body,
  );
}

export default function Operator() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CompanySummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (search) qs.set('q', search);
      const r = await api.get<{ companies: CompanySummary[]; total: number }>(`/api/operator/companies?${qs}`);
      setRows(r.companies);
      setTotal(r.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load companies.');
    }
  }, [search, offset]);
  useEffect(() => { void load(); }, [load]);

  // Search as you type, a moment after the typing stops.
  const onQuery = (v: string) => {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setOffset(0); setSearch(v.trim()); }, 250);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operator</h1>
          <p className="text-sm text-gray-500">Every company on Archie. Only people on the operator list see this page.</p>
        </div>
        <button onClick={() => setCreating(true)} className={`${primaryBtn} w-full sm:w-auto`}>+ New company</button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search by company name"
          aria-label="Search companies"
          className={`${field} sm:max-w-sm`}
        />
        {rows && (
          <p className="text-sm text-gray-500">
            {total} {total === 1 ? 'company' : 'companies'}
            {(['trial', 'active', 'paused', 'cancelled'] as Status[]).filter((s) => counts[s]).map((s) => `, ${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join('')}
            {total > PAGE ? ' on this page' : ''}
          </p>
        )}
      </div>

      {error && <div className="text-sm text-red-600">{error} <button onClick={load} className="underline">Try again</button></div>}

      {/* Phones: one card per company. */}
      <ul className="md:hidden space-y-3">
        {rows === null && !error && [0, 1, 2].map((i) => <li key={i} className="h-28 rounded-xl bg-white border border-gray-200 animate-pulse" />)}
        {rows?.length === 0 && <li className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No companies match.</li>}
        {rows?.map((c) => (
          <li key={c.id}>
            <button onClick={() => setOpenId(c.id)} className="w-full text-left rounded-xl border border-gray-200 bg-white p-4 shadow-sm active:bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-500 truncate">{c.slug}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Fact label="People" value={`${c.canSignIn} of ${c.members} can sign in`} />
                <Fact label="Last sign-in" value={ago(c.lastSignInAt)} />
                <Fact label="Leads, 30 days" value={c.leads30d} />
                <Fact label="Messages, 30 days" value={c.messages30d} />
                <Fact label="KynexPro" value={c.kynexProConnected ? 'Connected' : 'Not yet'} />
                <Fact label="Trial" value={trialText(c) || 'Not on trial'} />
                <Fact label="Plan" value={planText(c)} />
                <Fact label="Subscription" value={<SubscriptionBadge c={c} />} />
              </dl>
            </button>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden md:block rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Trial</th>
                <th className="px-4 py-3 font-medium text-right">People</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Subscription</th>
                <th className="px-4 py-3 font-medium">Last sign-in</th>
                <th className="px-4 py-3 font-medium">KynexPro</th>
                <th className="px-4 py-3 font-medium text-right" title="Leads created in the last 30 days">Leads (30d)</th>
                <th className="px-4 py-3 font-medium text-right" title="Texts and emails in the last 30 days">Messages (30d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows === null && !error && [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={10} className="px-4 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" /></td></tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">No companies match.</td></tr>}
              {rows?.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button onClick={(e) => { e.stopPropagation(); setOpenId(c.id); }} className="text-left font-medium text-gray-900 hover:underline">{c.name}</button>
                    <p className="text-xs text-gray-500">{c.slug} · since {formatDate(c.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap" title={c.trialEndsAt ? formatDate(c.trialEndsAt) : undefined}>{trialText(c) || 'Not on trial'}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap" title={`${c.canSignIn} of ${c.members} can sign in`}>{c.canSignIn} / {c.members}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap" title={`${c.seats} billable ${c.seats === 1 ? 'seat' : 'seats'}`}>{PLAN_LABEL[c.plan] ?? c.plan} {formatDollars(c.monthlyTotalCents)}/mo</td>
                  <td className="px-4 py-3"><SubscriptionBadge c={c} /></td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ago(c.lastSignInAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{c.kynexProConnected ? <span className="text-green-700">Connected</span> : <span className="text-gray-500">Not yet</span>}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.leads30d}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.messages30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className={quietBtn}>Previous</button>
          <span className="text-gray-500">{offset + 1} to {Math.min(offset + PAGE, total)} of {total}</span>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className={quietBtn}>Next</button>
        </div>
      )}

      {openId && <CompanyPanel id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {creating && (
        <NewCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={() => { setOffset(0); void load(); }}
        />
      )}
    </div>
  );
}
