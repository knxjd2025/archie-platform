import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { isNativeApp } from '../lib/native';
import {
  PLAYBOOK, PLAYBOOK_GROUPS, fillTemplate, subjectOf, type FillContext, type PlaybookDoc, type PlaybookGroup,
} from '../../../shared/playbook';
import { PLAYBOOK_DOC_CSS, checklistTotal, renderPlaybookDocument, renderPlaybookPrintPage } from '../../../shared/playbook-document';

interface Ctx extends FillContext {
  customerExternalId?: string | null; customerLabel?: string | null; insuranceJob?: boolean; stage?: string | null; canEditSettings: boolean;
}
interface LeadHit { externalId: string | null; firstName: string | null; lastName: string | null; jobName: string | null; address: string | null; city: string | null }

const KIND_LABEL: Record<PlaybookDoc['kind'], string> = { checklist: 'Checklist', guide: 'Guide', script: 'Script', letter: 'Letter', email: 'Email', reference: 'Reference' };
const KIND_COLOR: Record<PlaybookDoc['kind'], string> = {
  checklist: 'bg-emerald-50 text-emerald-700', guide: 'bg-indigo-50 text-indigo-700', script: 'bg-blue-50 text-blue-700',
  letter: 'bg-amber-50 text-amber-700', email: 'bg-purple-50 text-purple-700', reference: 'bg-gray-100 text-gray-700',
};
const FILLABLE = new Set<PlaybookDoc['kind']>(['letter', 'email', 'script']);

/**
 * The Sales Playbook: every checklist, script, letter, email and training
 * guide, searchable, with letters/emails/scripts filled in for the rep and
 * (when one is picked) the customer. Copy, print on letterhead, or email
 * straight through GHL.
 */
export default function Playbook({ initialDocId, initialExternalId, onOpenClient }: { initialDocId?: string; initialExternalId?: string; onOpenClient?: (externalId: string) => void }) {
  const [group, setGroup] = useState<PlaybookGroup | 'all'>('all');
  const [q, setQ] = useState('');
  const [docId, setDocId] = useState<string | null>(initialDocId ?? null);
  const [externalId, setExternalId] = useState<string | null>(initialExternalId ?? null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // Switching customer while the last one's details were still loading let
  // the slower, older reply land last — the letter then showed customer A
  // and "Email via GHL" sent to A. Only the newest request may set ctx.
  const ctxRequestId = useRef(0);
  useEffect(() => {
    const id = ++ctxRequestId.current;
    setCtxError(null);
    api.get<Ctx>(`/api/playbook/context${externalId ? `?externalId=${encodeURIComponent(externalId)}` : ''}`)
      .then((c) => { if (id === ctxRequestId.current) setCtx(c); })
      .catch((e: any) => { if (id === ctxRequestId.current) setCtxError(e?.message || 'Could not load your details.'); });
  }, [externalId]);
  // ctx still describes the previous customer until the new reply arrives.
  const ctxCurrent = !!ctx && (ctx.customerExternalId ?? null) === (externalId ?? null);

  const docs = useMemo(() => {
    const term = q.trim().toLowerCase();
    return PLAYBOOK.filter((d) => (group === 'all' || d.group === group) && (!term || `${d.title} ${d.summary} ${d.audience ?? ''} ${d.tags.join(' ')} ${d.body}`.toLowerCase().includes(term)));
  }, [group, q]);
  const doc = docId ? PLAYBOOK.find((d) => d.id === docId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📚 Sales Playbook</h1>
          <p className="text-sm text-gray-500 mt-1">Every checklist, script, letter and email in the system. Letters and emails fill themselves in for you and your customer.</p>
        </div>
        {ctx?.customerLabel && (
          <div className="text-xs bg-blue-50 text-blue-800 border border-blue-100 rounded-lg px-3 py-2 flex items-center gap-2">
            <span>Filling for <b>{ctx.customerLabel}</b>{ctx.stage ? ` · ${ctx.stage}` : ''}</span>
            {onOpenClient && ctx.customerExternalId && <button className="underline" onClick={() => onOpenClient(ctx.customerExternalId!)}>Open profile</button>}
            <button className="text-blue-500 hover:text-blue-800" onClick={() => setExternalId(null)} title="Clear customer">✕</button>
          </div>
        )}
      </div>
      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}
      {ctxError && <p className="text-sm text-red-600">{ctxError}</p>}

      <div className="flex gap-2 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: objection, 12 pack, referral, insurance agent…" className="flex-1 min-w-[200px] text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <Chip active={group === 'all'} onClick={() => setGroup('all')}>All ({PLAYBOOK.length})</Chip>
        {PLAYBOOK_GROUPS.map((g) => <Chip key={g.key} active={group === g.key} onClick={() => setGroup(g.key)} title={g.blurb}>{g.label} ({PLAYBOOK.filter((d) => d.group === g.key).length})</Chip>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_2fr] gap-4">
        <div className={`space-y-1.5 ${doc ? 'hidden lg:block' : ''}`}>
          {group !== 'all' && <p className="text-xs text-gray-500 px-1 pb-1">{PLAYBOOK_GROUPS.find((g) => g.key === group)?.blurb}</p>}
          {docs.length === 0 && <p className="text-sm text-gray-400 px-1 py-6 text-center">Nothing matches. Try a different word.</p>}
          {docs.map((d) => (
            <button key={d.id} onClick={() => setDocId(d.id)} className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${docId === d.id ? 'border-ink bg-blue-50/60' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${KIND_COLOR[d.kind]}`}>{KIND_LABEL[d.kind]}</span>
                {d.audience && <span className="text-[10px] text-gray-400 capitalize">{d.audience}</span>}
              </div>
              <p className="text-sm font-medium text-gray-900 mt-1">{d.title}</p>
              <p className="text-xs text-gray-500 line-clamp-2">{d.summary}</p>
            </button>
          ))}
        </div>
        <div>
          {!doc && <div className="hidden lg:flex h-full min-h-[300px] items-center justify-center text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">Pick something on the left.</div>}
          {doc && <DocView key={doc.id + (externalId ?? '')} doc={doc} ctx={ctx} ctxCurrent={ctxCurrent} onBack={() => setDocId(null)} onPickCustomer={setExternalId} flash={flash} onOpenDoc={setDocId} />}
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button onClick={onClick} title={title} aria-pressed={active} className={`px-3 py-1.5 text-xs rounded-full ${active ? 'bg-ink text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}>{children}</button>;
}

function DocView({ doc, ctx, ctxCurrent, onBack, onPickCustomer, flash, onOpenDoc }: {
  doc: PlaybookDoc; ctx: Ctx | null; ctxCurrent: boolean; onBack: () => void; onPickCustomer: (externalId: string | null) => void; flash: (m: string) => void; onOpenDoc: (id: string) => void;
}) {
  const fillable = FILLABLE.has(doc.kind);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [showPick, setShowPick] = useState(false);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gift, setGift] = useState(''); const [review, setReview] = useState('');
  useEffect(() => { if (ctx) { setGift(ctx.referralGift || ''); setReview(ctx.reviewLink || ''); } }, [ctx]);

  const filled = useMemo(() => {
    if (!fillable || !ctx) return null;
    const r = fillTemplate(doc.body, ctx);
    // The rep's own answers for what the app can't know.
    let text = r.text;
    for (const [k, v] of Object.entries(extra)) if (v.trim()) text = text.split(`[${k}]`).join(v.trim());
    return { ...r, text, remaining: r.remaining.filter((k) => !extra[k]?.trim()) };
  }, [doc, ctx, extra, fillable]);

  const text = filled?.text ?? doc.body;
  const checkKey = `playbook:v2:${doc.id}`;
  const [checked, setChecked] = useState<Set<number>>(() => { try { return new Set(JSON.parse(localStorage.getItem(checkKey) || '[]')); } catch { return new Set(); } });
  const saveChecked = (n: Set<number>) => { setChecked(n); try { localStorage.setItem(checkKey, JSON.stringify([...n])); } catch { /* private mode */ } };
  const totalChecks = useMemo(() => (doc.kind === 'checklist' ? checklistTotal(doc) : 0), [doc]);
  const sheet = useMemo(() => renderPlaybookDocument(doc, { mode: 'screen', text, ctx, checked }), [doc, text, ctx, checked]);
  const onSheetClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>('[data-check]');
    if (!box) return;
    const n = Number(box.dataset.check);
    const next = new Set(checked); if (next.has(n)) next.delete(n); else next.add(n);
    saveChecked(next);
  };
  const email = doc.kind === 'email' ? subjectOf(doc, text) : null;
  const used = (how: string) => api.post('/api/playbook/used', { docId: doc.id, how, externalId: ctx?.customerExternalId || undefined }).catch(() => {});

  const copy = async () => {
    const out = email ? `Subject: ${email.subject}\n\n${email.body}` : text;
    try { await navigator.clipboard.writeText(out); flash('Copied'); used('copied'); } catch { flash("Couldn't copy — select the text and copy it."); }
  };
  const copyHtml = async () => {
    try {
      const html = renderPlaybookDocument(doc, { mode: 'email', text, ctx, logoUrl: absoluteLogo() });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([email ? email.body : text], { type: 'text/plain' }) })]);
      flash('Copied as formatted email — paste into GHL or Gmail'); used('copied_html');
    } catch { await copy(); }
  };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to print.'); return; }
    w.document.write(renderPlaybookPrintPage(doc, { text, ctx, checked, logoUrl: absoluteLogo() }));
    w.document.close();
    used('printed');
  };
  const sendEmail = async () => {
    if (!email || !ctx?.customerExternalId || !ctxCurrent) return;
    if (filled?.remaining.length) { flash('Fill in the highlighted blanks first.'); return; }
    setSending(true);
    try {
      const m = await api.get<{ contactId: string | null }>(`/api/clients/${ctx.customerExternalId}/messages`);
      if (!m.contactId) { flash('This customer is not in GoHighLevel yet, so there is no email thread to send from. Copy it instead.'); return; }
      if (!window.confirm(`Send "${email.subject}" to ${ctx.customerLabel} by email now?`)) return;
      await api.post(`/api/conversations/${m.contactId}/reply`, { channel: 'email', subject: email.subject, message: email.body, html: renderPlaybookDocument(doc, { mode: 'email', text, ctx, logoUrl: absoluteLogo() }) });
      flash('Sent through GoHighLevel'); used('emailed');
    } catch (e: any) { flash(`Couldn't send: ${e?.message || 'failed'}`); }
    finally { setSending(false); }
  };
  const saveSettings = async () => {
    try {
      await api.put('/api/playbook/settings', { referralGift: gift, reviewLink: review });
      flash('Saved for every rep — reopen the template to see it'); setSettingsOpen(false);
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); }
  };

  const relatedChecklist = doc.stage ? PLAYBOOK.find((d) => d.kind === 'checklist' && d.stage === doc.stage && d.id !== doc.id) : null;
  const btn = 'text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 font-medium text-gray-700';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <button onClick={onBack} className="lg:hidden text-xs text-blue-600 hover:underline mb-1">← All documents</button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${KIND_COLOR[doc.kind]}`}>{KIND_LABEL[doc.kind]}</span>
          {doc.audience && <span className="text-[10px] text-gray-500 capitalize">for {doc.audience}</span>}
          {doc.stage && <span className="text-[10px] text-gray-500">· stage: {doc.stage.replace('_', ' ')}</span>}
        </div>
        <h2 className="text-base font-semibold text-gray-900 mt-1">{doc.title}</h2>
        {doc.videos.length > 0 && (
          <div className="mt-1 flex gap-3 flex-wrap">{doc.videos.map((v) => <a key={v} href={v} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">▶ Watch the training video</a>)}</div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {fillable && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-gray-600">
                {ctx?.customerLabel ? <>Filled in for <b>{ctx.customerLabel}</b> and signed by <b>{ctx.repName}</b>.</> : <>Signed by <b>{ctx?.repName || 'you'}</b>. Pick a customer to fill in their name and address.</>}
              </p>
              <div className="flex gap-2">
                <button className={btn} onClick={() => setShowPick((v) => !v)}>{ctx?.customerLabel ? 'Change customer' : 'Pick a customer'}</button>
                {ctx?.canEditSettings && <button className={btn} onClick={() => setSettingsOpen((v) => !v)}>Office settings</button>}
              </div>
            </div>
            {showPick && <CustomerPicker onPick={(id) => { onPickCustomer(id); setShowPick(false); }} />}
            {settingsOpen && (
              <div className="grid sm:grid-cols-2 gap-2 pt-1">
                <label className="text-[11px] font-semibold text-gray-500">Referral gift<input value={gift} onChange={(e) => setGift(e.target.value)} placeholder="e.g. a $100 gift card" className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 font-normal" /></label>
                <label className="text-[11px] font-semibold text-gray-500">Google review link<input value={review} onChange={(e) => setReview(e.target.value)} placeholder="https://g.page/r/…/review" className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 font-normal" /></label>
                <div className="sm:col-span-2"><button onClick={saveSettings} className="text-xs px-3 py-1.5 rounded-lg bg-ink text-white font-medium">Save for every rep</button></div>
              </div>
            )}
            {filled && filled.remaining.length > 0 && (
              <div className="pt-1">
                <p className="text-[11px] font-semibold text-amber-700 mb-1">Only you know these — fill them in:</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {filled.remaining.map((k) => (
                    <label key={k} className="text-[11px] text-gray-600">
                      <span className="block truncate" title={k}>{k}</span>
                      <input value={extra[k] || ''} onChange={(e) => setExtra((x) => ({ ...x, [k]: e.target.value }))} className="mt-0.5 w-full text-sm border border-amber-200 bg-amber-50/40 rounded-lg px-2.5 py-1.5" />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button className={btn} onClick={copy}>Copy text</button>
          {doc.kind === 'email' && <button className={btn} onClick={copyHtml}>Copy as email</button>}
          {/* The app's WebView has no print dialog and a blank window.open page is
              a dead end with no way back, so Print only shows on the website. */}
          {!isNativeApp() && <button className={btn} onClick={print}>{doc.kind === 'letter' ? 'Print on letterhead' : 'Print / Save PDF'}</button>}
          {doc.kind === 'email' && ctx?.customerExternalId && <button className="text-xs px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50" disabled={sending || !ctxCurrent} title={ctxCurrent ? undefined : 'Loading this customer…'} onClick={sendEmail}>{sending ? 'Sending…' : `Email ${ctx.customerLabel?.split(' ')[0] || 'customer'} via GHL`}</button>}
          {relatedChecklist && <button className={btn} onClick={() => onOpenDoc(relatedChecklist.id)}>Open the {relatedChecklist.title} →</button>}
        </div>

        {totalChecks > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{checked.size} of {totalChecks} done</span>
            {checked.size > 0 && <button className="text-blue-600 hover:underline" onClick={() => saveChecked(new Set())}>Reset</button>}
          </div>
        )}
        <style>{PLAYBOOK_DOC_CSS}</style>
        <div className="-mx-4 sm:mx-0 bg-slate-100 sm:rounded-xl p-2 sm:p-5">
          <div className="max-w-[860px] mx-auto shadow-[0_6px_24px_rgba(8,17,52,0.12)] rounded" onClick={onSheetClick} dangerouslySetInnerHTML={{ __html: sheet }} />
        </div>
      </div>
    </div>
  );
}

function CustomerPicker({ onPick }: { onPick: (externalId: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [busy, setBusy] = useState(false);
  // Searches finish in any order; without this "smi" could land after "smith"
  // and the list showed the wrong customers under the right search.
  const searchId = useRef(0);
  useEffect(() => {
    const term = q.trim();
    const id = ++searchId.current;
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    const t = setTimeout(() => {
      setBusy(true);
      api.get<{ leads: LeadHit[] }>(`/api/leads?q=${encodeURIComponent(term)}&limit=8&includeClosed=true`)
        .then((r) => { if (id === searchId.current) setHits((r.leads || []).filter((l) => l.externalId)); })
        .catch(() => { if (id === searchId.current) setHits([]); })
        .finally(() => { if (id === searchId.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-1.5">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name or address…" className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5" />
      {busy && <p className="text-xs text-gray-400">Searching…</p>}
      {hits.map((h) => (
        <button key={h.externalId!} onClick={() => onPick(h.externalId!)} className="w-full text-left text-sm px-2.5 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200">
          <span className="font-medium text-gray-900">{[h.firstName, h.lastName].filter(Boolean).join(' ') || h.jobName}</span>
          {h.address && <span className="text-gray-500"> · {h.address}{h.city ? `, ${h.city}` : ''}</span>}
        </button>
      ))}
    </div>
  );
}

/** Printed pages and emails leave the app, so the logo needs a full URL. */
function absoluteLogo(): string {
  return `${window.location.origin}/logo.jpg`;
}
