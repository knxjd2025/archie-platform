/**
 * Inbox Leads — the emails in my mailbox that are leads, customers writing in,
 * or things the team must not miss. Scan looks back 72 hours the first time,
 * then only what arrived since the last scan; a cron also scans every half hour.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Item {
  id: number; messageId: string; threadId: string | null; fromName: string | null; fromEmail: string | null; subject: string | null; snippet: string | null;
  receivedAt: string | null; category: 'lead' | 'customer' | 'important' | 'other'; score: number; reason: string | null;
  matchedExternalId: string | null; matchedName: string | null; status: 'new' | 'handled' | 'dismissed'; unread: boolean | null; followUpId: number | null;
}
interface Scan { id: number; fromAt: string; toAt: string; messagesSeen: number; itemsAdded: number; flagged: number; startedBy: string | null }
interface Summary { mailbox: string; canScan: boolean; lastScanAt: string | null; nextWindow: { from: string; to: string; firstScan: boolean; hours: number }; counts: Record<string, number> }

const CAT: Record<string, { label: string; chip: string; icon: string }> = {
  lead: { label: 'Lead', chip: 'bg-emerald-100 text-emerald-700', icon: '🌟' },
  customer: { label: 'Customer', chip: 'bg-blue-100 text-blue-700', icon: '🏠' },
  important: { label: 'Important', chip: 'bg-amber-100 text-amber-700', icon: '❗' },
  other: { label: 'Other', chip: 'bg-gray-100 text-gray-500', icon: '·' },
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const gmailUrl = (threadId: string | null, mailbox: string) => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#inbox/${threadId || ''}`;

export default function Inbox({ onNavigate, onOpenClient }: { onNavigate: (page: string, data?: any) => void; onOpenClient: (externalId: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [tab, setTab] = useState<'new' | 'handled' | 'dismissed'>('new');
  const [cat, setCat] = useState<'all' | 'lead' | 'customer' | 'important'>('all');
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  // A failed load used to render "Nothing waiting — every flagged email has
  // been handled", which reads as good news. An empty inbox and a broken inbox
  // must not look the same.
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSummary = () => api.get<Summary>('/api/inbox/summary').then(setSummary).catch(() => {});
  // Switching tabs quickly fires overlapping loads with no ordering guarantee —
  // a slower "handled" response could land after "new" and show the wrong
  // list under the wrong tab. Only the most recently issued load may apply.
  const loadRequestId = useRef(0);
  const loadItems = (status = tab) => {
    const id = ++loadRequestId.current;
    return api.get<{ items: Item[]; scans: Scan[] }>(`/api/inbox?status=${status}`)
      .then((r) => { if (id !== loadRequestId.current) return; setItems(r.items || []); setScans(r.scans || []); setLoadError(null); })
      .catch((e: any) => { if (id !== loadRequestId.current) return; setLoadError(e?.message || "Couldn't load the inbox."); });
  };
  // The tab effect below also runs on mount, so the items load lives there
  // alone — loading them here too fetched the same list twice on every open.
  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { loadItems(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.post<{ seen: number; added: number; flagged: number; window: { firstScan: boolean; from: string } }>('/api/inbox/scan', {});
      flash(`${r.window.firstScan ? 'First scan: ' : ''}looked at ${r.seen} email${r.seen === 1 ? '' : 's'} since ${fmt(r.window.from)} — ${r.flagged} worth your attention.`);
      await Promise.all([loadSummary(), loadItems('new')]); setTab('new');
    } catch (e: any) { flash(e?.message || 'Scan failed.'); }
    finally { setScanning(false); }
  };

  const setStatus = async (it: Item, status: Item['status']) => {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    try { await api.patch(`/api/inbox/${it.id}`, { status }); loadSummary(); } catch { flash("Couldn't save that."); loadItems(); }
  };
  const followUp = async (it: Item) => {
    try { await api.post(`/api/inbox/${it.id}/follow-up`, {}); setItems((xs) => xs.filter((x) => x.id !== it.id)); flash('Follow-up added to your list.'); loadSummary(); }
    catch (e: any) { flash(e?.message || "Couldn't add the follow-up."); }
  };
  const makeLead = (it: Item) => {
    const [firstName, ...rest] = (it.fromName || '').split(/\s+/).filter(Boolean);
    onNavigate('leads', { newLead: true, prefill: { firstName: firstName || '', lastName: rest.join(' '), email: it.fromEmail || '', notes: `Emailed: ${it.subject || ''} — ${(it.snippet || '').slice(0, 160)}` } });
    api.patch(`/api/inbox/${it.id}`, { status: 'handled' }).catch(() => {});
  };

  const shown = items.filter((i) => (cat === 'all' ? i.category !== 'other' || tab !== 'new' : i.category === cat));
  const count = (c: string) => items.filter((i) => i.category === c).length;
  const nextWindow = summary?.nextWindow;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbox Leads</h1>
          <p className="text-sm text-gray-500 mt-1">
            Leads, customers writing in, and email you must not miss — pulled from {summary?.mailbox || 'your mailbox'}.
            {summary?.lastScanAt ? ` Last scanned ${fmt(summary.lastScanAt)}.` : ' Not scanned yet.'} A watcher also checks every 30 minutes.
          </p>
        </div>
        <div className="text-right">
          <button onClick={scan} disabled={scanning || summary?.canScan === false} className="px-4 py-2.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
            {scanning ? 'Scanning…' : '🔍 Scan for leads'}
          </button>
          {nextWindow && <p className="text-[11px] text-gray-400 mt-1">{nextWindow.firstScan ? 'First scan: the past 72 hours' : `Only what's new since ${fmt(nextWindow.from)} (${nextWindow.hours}h)`}</p>}
        </div>
      </div>

      {summary?.canScan === false && <p className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-2">Inbox watch works on company mailboxes only.</p>}
      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(['all', 'lead', 'customer', 'important'] as const).map((c) => (
            <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={`px-3 py-1 text-sm rounded-full ${cat === c ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {c === 'all' ? `All (${items.filter((i) => i.category !== 'other').length})` : `${CAT[c].icon} ${CAT[c].label} (${count(c)})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-full p-0.5">
          {(['new', 'handled', 'dismissed'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`px-3 py-1 text-sm rounded-full capitalize ${tab === t ? 'bg-ink text-white' : 'text-gray-600'}`}>{t}</button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="px-6 py-8 text-center bg-white rounded-xl border border-gray-200">
          <p className="text-sm text-red-600 font-medium">Couldn't load the inbox</p>
          <p className="text-xs text-gray-500 mt-1">{loadError}</p>
          <button onClick={() => loadItems(tab)} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          {tab === 'new' ? (summary?.lastScanAt ? 'Nothing waiting — every flagged email has been handled.' : 'Tap "Scan for leads" to check the past 72 hours.') : `Nothing ${tab}.`}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((it) => {
            const meta = CAT[it.category] || CAT.other;
            return (
              <div key={it.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${meta.chip}`}>{meta.icon} {meta.label} · {it.score}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${it.unread ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{it.subject || '(no subject)'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {it.fromName || it.fromEmail}{it.fromName && it.fromEmail ? ` <${it.fromEmail}>` : ''} · {fmt(it.receivedAt)}
                      {it.matchedName && <> · <button onClick={() => it.matchedExternalId && onOpenClient(it.matchedExternalId)} className="text-blue-600 hover:underline">{it.matchedName} (client)</button></>}
                    </p>
                    {it.snippet && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{it.snippet}</p>}
                    {it.reason && <p className="text-[11px] text-gray-400 mt-1">Why: {it.reason}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <a href={gmailUrl(it.threadId, summary?.mailbox || '')} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">✉️ Open in Gmail</a>
                  {tab === 'new' && (
                    <>
                      {!it.matchedExternalId && it.category !== 'other' && <button onClick={() => makeLead(it)} className="text-xs px-2.5 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark">＋ Make it a lead</button>}
                      <button onClick={() => followUp(it)} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">🔔 Follow-up tomorrow</button>
                      <button onClick={() => setStatus(it, 'handled')} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">✅ Handled</button>
                      <button onClick={() => setStatus(it, 'dismissed')} className="text-xs px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Not important</button>
                    </>
                  )}
                  {tab !== 'new' && <button onClick={() => setStatus(it, 'new')} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700">↩ Back to new</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scans.length > 0 && (
        <div className="text-[11px] text-gray-400">
          Recent scans: {scans.map((s) => `${fmt(s.fromAt)} → ${fmt(s.toAt)}: ${s.messagesSeen} seen, ${s.flagged} flagged${s.startedBy === 'cron' ? ' (auto)' : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
