/**
 * My Account → iMessage bridge: make a token, see whether the bridge on my
 * Mac is online, and copy the one-line command to run it.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Status { configured: boolean; online: boolean; lastSeenAt: string | null; createdAt: string | null; messages: number; all: boolean }

export default function ImessageBridge() {
  const [st, setSt] = useState<Status | null>(null);
  const [token, setToken] = useState<{ token: string; command: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get<Status>('/api/imessage/status').then(setSt).catch(() => {});
  // Skip the 30s poll while the page is in the background — a phone with the
  // app parked on My Account kept waking the radio for a badge nobody saw —
  // and catch up the moment it is visible again.
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const make = async () => {
    if (st?.configured && !window.confirm('Make a new token? The bridge running with the old one will stop working until you update it.')) return;
    setBusy(true);
    try { setToken(await api.post<{ token: string; command: string }>('/api/imessage/bridge/token', {})); await load(); }
    catch (e: any) { alert(e?.message || 'Could not make a token.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Disconnect the iMessage bridge? Synced messages stay; nothing new comes in until you set it up again.')) return;
    await api.delete('/api/imessage/bridge/token').catch(() => {}); setToken(null); load();
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">💬 iMessage on my Mac</h2>
          <p className="text-xs text-gray-500 mt-0.5">Your iMessage threads with clients show on their pages and in Messages, and you can reply from the app. Only you see them.</p>
        </div>
        {st && (
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${st.online ? 'bg-emerald-100 text-emerald-700' : st.configured ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
            {st.online ? '● Bridge online' : st.configured ? `○ Offline · last seen ${fmt(st.lastSeenAt) || 'never'}` : 'Not set up'}
          </span>
        )}
      </div>
      {st?.configured && <p className="text-xs text-gray-500">{st.messages.toLocaleString()} messages synced{st.all ? ' · syncing every thread' : ' · client threads only'}.</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={make} disabled={busy} className="text-sm px-3 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">{st?.configured ? 'New token' : 'Set up the bridge'}</button>
        {st?.configured && <button onClick={remove} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600">Disconnect</button>}
      </div>
      {token && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700 space-y-2">
          <p className="font-medium text-gray-900">On the Mac that is signed into Messages:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>System Settings → Privacy &amp; Security → <b>Full Disk Access</b> → turn on Terminal (the bridge reads the Messages database; it never changes it).</li>
            <li>In the app's folder, run this once (it keeps running; close the window to stop):</li>
          </ol>
          <pre className="whitespace-pre-wrap break-all bg-white border border-gray-200 rounded p-2 select-all">{token.command}</pre>
          <p>To have it start at login: <code>scripts/imessage-bridge/install.sh</code> with the same token. Add <code>--all</code> to sync every thread instead of just clients on file.</p>
          <p className="text-amber-700">This token is shown once. Keep it private — it lets that Mac push and send iMessages as you.</p>
        </div>
      )}
    </div>
  );
}
