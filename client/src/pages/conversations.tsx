import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface ConversationItem {
  id: string;
  source: string;
  channel: string;
  contact: string;
  contactId: string;
  lastMessage: string;
  direction: string;
  date: number;
  unread: number;
}

const CHANNEL_META: Record<string, { icon: string; label: string; color: string }> = {
  sms: { icon: '📱', label: 'Text', color: 'bg-green-100 text-green-700' },
  call: { icon: '📞', label: 'Call', color: 'bg-blue-100 text-blue-700' },
  email: { icon: '✉️', label: 'Email', color: 'bg-purple-100 text-purple-700' },
  chat: { icon: '💬', label: 'Chat', color: 'bg-amber-100 text-amber-700' },
  note: { icon: '📝', label: 'JobTread', color: 'bg-indigo-100 text-indigo-700' },
  other: { icon: '🗨️', label: 'Other', color: 'bg-gray-100 text-gray-600' },
};

const SOURCE_LABEL: Record<string, string> = {
  ghl: 'Texts & calls',
  gmail: 'Email',
  jobtread: 'JobTread',
  imessage: 'iMessage',
};

function timeAgo(ms: number): string {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type SourceStatus = { ok: boolean; count?: number; error?: string };

export default function Conversations() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [sources, setSources] = useState<Record<string, SourceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  // Reply composer state
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyChannel, setReplyChannel] = useState<'sms' | 'email'>('sms');
  const [replyMsg, setReplyMsg] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  // AI assist
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiStatusError, setAiStatusError] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const [instrText, setInstrText] = useState('');
  useEffect(() => {
    api.get<{ configured: boolean }>('/api/assist/status')
      .then((r) => setAiConfigured(!!r.configured))
      .catch(() => setAiStatusError(true));
  }, []);

  // Email security check
  type Risk = { risk: 'safe' | 'suspicious' | 'dangerous'; score: number; reasons: string[] };
  const [secResults, setSecResults] = useState<Record<string, Risk | { error: string } | 'loading'>>({});
  const checkSecurity = async (c: ConversationItem) => {
    setSecResults((s) => ({ ...s, [c.id]: 'loading' }));
    try {
      const r = await api.post<Risk>('/api/assist/email-security', { from: c.contact, subject: '', body: c.lastMessage });
      setSecResults((s) => ({ ...s, [c.id]: r }));
    } catch (e: any) {
      setSecResults((s) => ({ ...s, [c.id]: { error: e?.message || 'failed' } }));
    }
  };

  // Potential-lead detection from email
  type Lead = { isLead: boolean; confidence: number; name: string; service: string; summary: string };
  const [leadResults, setLeadResults] = useState<Record<string, Lead>>({});
  const [scanning, setScanning] = useState(false);
  const [addingLead, setAddingLead] = useState<string | null>(null);

  const scanForLeads = async () => {
    const emails = items.filter((i) => i.channel === 'email').slice(0, 20);
    if (emails.length === 0) { flash('No emails to scan.'); return; }
    setScanning(true);
    try {
      const results = await Promise.allSettled(
        emails.map((c) =>
          api.post<Lead>('/api/assist/lead-check', { from: c.contact, body: c.lastMessage }).then((r) => ({ id: c.id, r })),
        ),
      );
      const found: Record<string, Lead> = {};
      let n = 0;
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.r?.isLead && res.value.r.confidence >= 50) {
          found[res.value.id] = res.value.r;
          n++;
        }
      }
      setLeadResults(found);
      flash(n > 0 ? `Found ${n} possible lead${n > 1 ? 's' : ''} 🎯` : 'No new leads spotted in recent emails.');
    } catch (e: any) {
      flash(`Scan failed: ${e?.message || 'error'}`);
    } finally {
      setScanning(false);
    }
  };

  const addLeadFromEmail = async (c: ConversationItem, lead: Lead) => {
    setAddingLead(c.id);
    try {
      const parts = (lead.name || c.contact || '').trim().split(/\s+/);
      await api.post('/api/leads/create', {
        firstName: parts[0] || lead.name || c.contact,
        lastName: parts.slice(1).join(' '),
        serviceType: lead.service,
      });
      flash(`Added lead: ${lead.name || c.contact}`);
      setLeadResults((s) => { const n = { ...s }; delete n[c.id]; return n; });
    } catch (e: any) {
      flash(`Couldn't add lead: ${e?.message || 'failed'}`);
    } finally {
      setAddingLead(null);
    }
  };

  const runAssist = async (c: ConversationItem, mode: 'draft' | 'instruction' | 'polish' | 'tone', tone?: string) => {
    if ((mode === 'polish' || mode === 'tone') && !replyMsg.trim()) { flash('Write something first, then Polish/Tone.'); return; }
    if (mode === 'instruction' && !instrText.trim()) { flash('Type what to say first.'); return; }
    setAiBusy(true);
    try {
      const res = await api.post<{ text?: string; error?: string }>('/api/assist/message', {
        mode, channel: replyChannel, contactId: c.contactId, contactName: c.contact,
        ...(mode === 'instruction' ? { instruction: instrText.trim() } : {}),
        ...(mode === 'polish' || mode === 'tone' ? { text: replyMsg } : {}),
        ...(mode === 'tone' ? { tone } : {}),
      });
      if (res.text) { setReplyMsg(res.text); setInstrOpen(false); setInstrText(''); }
    } catch (e: any) {
      flash(`AI: ${e?.message || 'failed'}`);
    } finally { setAiBusy(false); }
  };

  const openReply = (c: ConversationItem) => {
    setReplyFor(c.id);
    setReplyChannel(c.channel === 'email' ? 'email' : 'sms');
    setReplyMsg('');
    setReplySubject('');
  };

  const sendReply = async (c: ConversationItem) => {
    if (!c.contactId || !replyMsg.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/conversations/${c.contactId}/reply`, {
        channel: replyChannel,
        message: replyMsg.trim(),
        ...(replyChannel === 'email' ? { subject: replySubject.trim() } : {}),
      });
      flash(`Sent to ${c.contact}`);
      setReplyFor(null); setReplyMsg(''); setReplySubject('');
    } catch (e: any) {
      flash(`Couldn't send: ${e?.message || 'failed'}`);
    } finally {
      setSending(false);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ conversations: ConversationItem[]; sources?: Record<string, SourceStatus> }>('/api/conversations');
      setItems(res.conversations || []);
      setSources(res.sources || {});
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load conversations');
    } finally {
      if (!silent) setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // This page's whole purpose is texts/calls/emails, but it only ever loaded
  // once on mount — stale until a manual Refresh click. Light background
  // polling, paused while the tab is hidden.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 2 * 60 * 1000);
    const onFocus = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onFocus); };
  }, []);

  const failedSources = Object.entries(sources).filter(([, s]) => s && !s.ok);

  const channels = ['all', ...Array.from(new Set(items.map((i) => i.channel)))];
  const shown = filter === 'all' ? items : items.filter((i) => i.channel === filter);
  const unreadTotal = items.reduce((s, i) => s + (i.unread || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Conversations</h2>
          <p className="text-sm text-gray-500 mt-1">
            Texts, calls, email, and JobTread — all in one place{unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiStatusError && !aiConfigured && (
            <span className="text-xs text-gray-400 italic">AI assist unavailable</span>
          )}
          {aiConfigured && (
            <button
              onClick={scanForLeads}
              disabled={scanning}
              className="px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg disabled:opacity-60"
              title="Use AI to spot potential customer leads in the 20 most recent emails"
            >
              {scanning ? 'Scanning…' : '🎯 Scan for leads (last 20)'}
            </button>
          )}
          <button onClick={() => load()} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>
      )}

      {failedSources.length > 0 && !loading && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          Some sources didn't load:{' '}
          {failedSources.map(([key, s], i) => (
            <span key={key}>
              {i > 0 ? ', ' : ''}
              <span className="font-medium">{SOURCE_LABEL[key] || key}</span>
              {s.error ? ` (${s.error})` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {channels.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            aria-pressed={filter === c}
            className={`px-3 py-2 sm:py-1 text-sm rounded-full capitalize transition-colors ${
              filter === c ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {c === 'all'
              ? `All (${items.length})`
              : `${CHANNEL_META[c]?.icon || ''} ${CHANNEL_META[c]?.label || c} (${items.filter((i) => i.channel === c).length})`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                <div className="w-6 h-6 rounded bg-gray-100" />
                <div className="flex-1 space-y-2"><div className="h-3 w-1/3 bg-gray-100 rounded" /><div className="h-3 w-2/3 bg-gray-100 rounded" /></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-600 font-medium">Couldn't load conversations</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
            <button onClick={() => load()} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-400">{filter === 'all' ? 'No conversations found.' : `No ${CHANNEL_META[filter]?.label || filter} conversations yet.`}</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {shown.map((c) => {
              const meta = CHANNEL_META[c.channel] || CHANNEL_META.other;
              const canReply = c.source === 'ghl' && !!c.contactId;
              return (
                <div key={c.id}>
                  <div className="flex items-start gap-3 px-5 py-4 hover:bg-gray-50 transition-colors">
                    <span className="text-xl mt-0.5" title={meta.label}>{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{c.contact}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                        {c.unread > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{c.unread}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        {c.direction === 'outbound' && <span className="text-gray-400">You: </span>}
                        {c.lastMessage || <span className="italic text-gray-400">(no preview)</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(c.date)}</p>
                      {canReply && replyFor !== c.id && (
                        <button onClick={() => openReply(c)} className="text-xs text-blue-600 hover:underline">Reply</button>
                      )}
                      {aiConfigured && c.channel === 'email' && !secResults[c.id] && (
                        <button onClick={() => checkSecurity(c)} className="text-xs text-gray-500 hover:text-red-600" title="Rate this email's security risk" aria-label="Check email security">🛡 Check</button>
                      )}
                    </div>
                  </div>
                  {leadResults[c.id] && (
                    <div className="px-5 pb-3 -mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">🎯 Potential lead · {leadResults[c.id].confidence}%</span>
                      <span className="text-xs text-gray-600">
                        {leadResults[c.id].name || c.contact}
                        {leadResults[c.id].service ? ` · ${leadResults[c.id].service}` : ''}
                        {leadResults[c.id].summary ? ` — ${leadResults[c.id].summary}` : ''}
                      </span>
                      <button
                        onClick={() => addLeadFromEmail(c, leadResults[c.id])}
                        disabled={addingLead === c.id}
                        className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                      >
                        {addingLead === c.id ? 'Adding…' : '＋ Add lead'}
                      </button>
                    </div>
                  )}
                  {secResults[c.id] && (
                    <div className="px-5 pb-3 -mt-1">
                      {secResults[c.id] === 'loading' ? (
                        <span className="text-xs text-gray-400">🛡 Checking…</span>
                      ) : 'error' in (secResults[c.id] as any) ? (
                        <span className="text-xs text-gray-400">Couldn't check: {(secResults[c.id] as any).error}</span>
                      ) : (() => {
                        const r = secResults[c.id] as Risk;
                        const meta = r.risk === 'safe'
                          ? { c: 'bg-green-100 text-green-700', l: 'Safe' }
                          : r.risk === 'dangerous'
                            ? { c: 'bg-red-100 text-red-700', l: 'Dangerous' }
                            : { c: 'bg-amber-100 text-amber-700', l: 'Suspicious' };
                        return (
                          <div className="text-xs">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${meta.c}`}>🛡 {meta.l} · {r.score}/100</span>
                            {r.reasons.length > 0 && <span className="text-gray-500 ml-2">{r.reasons.join(' · ')}</span>}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {canReply && replyFor === c.id && (
                    <div className="px-5 pb-4 -mt-1 bg-gray-50/60">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => setReplyChannel('sms')}
                          className={`text-xs px-2 py-1 rounded ${replyChannel === 'sms' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                        >📱 Text</button>
                        <button
                          onClick={() => setReplyChannel('email')}
                          className={`text-xs px-2 py-1 rounded ${replyChannel === 'email' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                        >✉️ Email</button>
                        <span className="text-xs text-gray-400">to {c.contact}</span>
                      </div>
                      {replyChannel === 'email' && (
                        <input
                          value={replySubject}
                          onChange={(e) => setReplySubject(e.target.value)}
                          placeholder="Subject"
                          className="w-full text-sm border border-gray-200 rounded p-2 mb-2 focus:ring-1 focus:ring-blue-400"
                        />
                      )}
                      <textarea
                        autoFocus
                        value={replyMsg}
                        onChange={(e) => setReplyMsg(e.target.value)}
                        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && replyMsg.trim() && !sending) { e.preventDefault(); sendReply(c); } }}
                        rows={3}
                        placeholder={`Write a ${replyChannel === 'sms' ? 'text' : 'email'} to ${c.contact}…`}
                        className="w-full text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400"
                      />
                      {replyChannel === 'sms' && replyMsg.length > 0 && (
                        <p className="text-[11px] text-gray-400 mt-0.5">{replyMsg.length} chars · {Math.ceil(replyMsg.length / 160)} SMS</p>
                      )}
                      {aiConfigured && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-purple-500 font-medium">✨ AI</span>
                          <button onClick={() => runAssist(c, 'draft')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-purple-50 text-purple-700 border border-purple-100 disabled:opacity-50">Draft reply</button>
                          <button onClick={() => setInstrOpen((v) => !v)} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-purple-50 text-purple-700 border border-purple-100 disabled:opacity-50">Write from note</button>
                          <button onClick={() => runAssist(c, 'polish')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-purple-50 text-purple-700 border border-purple-100 disabled:opacity-50">Polish</button>
                          <button onClick={() => runAssist(c, 'tone', 'friendlier')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-white text-gray-600 border border-gray-200 disabled:opacity-50">Friendlier</button>
                          <button onClick={() => runAssist(c, 'tone', 'shorter')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-white text-gray-600 border border-gray-200 disabled:opacity-50">Shorter</button>
                          <button onClick={() => runAssist(c, 'tone', 'formal')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-white text-gray-600 border border-gray-200 disabled:opacity-50">Formal</button>
                          {aiBusy && <span className="text-[11px] text-gray-400">thinking…</span>}
                        </div>
                      )}
                      {aiConfigured && instrOpen && (
                        <div className="mt-1.5 flex gap-1.5">
                          <input
                            value={instrText}
                            onChange={(e) => setInstrText(e.target.value)}
                            placeholder="e.g. tell them we can start Tuesday"
                            className="flex-1 text-xs border border-gray-200 rounded p-1.5 focus:ring-1 focus:ring-purple-400"
                          />
                          <button onClick={() => runAssist(c, 'instruction')} disabled={aiBusy} className="text-[11px] px-2 py-1 rounded bg-purple-600 text-white disabled:opacity-50">Write it</button>
                        </div>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => sendReply(c)}
                          disabled={sending || !replyMsg.trim()}
                          className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50"
                        >{sending ? 'Sending…' : 'Send'}</button>
                        <button onClick={() => setReplyFor(null)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button>
                        <span className="hidden sm:inline text-[11px] text-gray-400 self-center ml-auto">⌘↵ to send</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
