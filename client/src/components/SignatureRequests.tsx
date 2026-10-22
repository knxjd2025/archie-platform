import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  STATUS_LABEL, STATUS_STYLE, describeDevice, describeGeo, describeProximity, signedAtProperty, stamp,
  type SignatureRequestView, type SignatureSourceKind, type SignerView,
} from '../../../shared/signatures';

interface SignableOption {
  kind: SignatureSourceKind;
  ref: string | null;
  label: string;
  detail: string;
  suggests: 'customer' | 'both';
}

interface DocsPayload {
  options: SignableOption[];
  customer: { name: string; email: string; phone: string };
  me: { name: string; email: string };
  propertyAddress: string;
}

interface SignerDraft { name: string; email: string; phone: string; role: 'customer' | 'company' }

const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';
const label = 'block text-[11px] font-semibold text-gray-500 mb-0.5';
const optionKey = (o: { kind: string; ref: string | null }) => `${o.kind}:${o.ref ?? ''}`;

/** Where a signature came from, in one line a rep can read at a glance. */
function WhereSigned({ signer }: { signer: SignerView }) {
  if (!signer.signedAt) return null;
  const near = describeProximity(signer.geo);
  const at = signedAtProperty(signer.geo);
  return (
    <p className="text-[11px] text-gray-500 mt-0.5">
      {near && (
        <span className={at ? 'text-emerald-700 font-medium' : ''}>{near}</span>
      )}
      {near && ' · '}
      {describeGeo(signer.geo)}
      {signer.geo?.lat != null && signer.geo?.lng != null && (
        <>
          {' · '}
          <a
            href={`https://www.google.com/maps?q=${signer.geo.lat},${signer.geo.lng}`}
            target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline"
          >map</a>
        </>
      )}
      {signer.userAgent ? ` · ${describeDevice(signer.userAgent)}` : ''}
    </p>
  );
}

function SignerRow({ signer }: { signer: SignerView }) {
  const state = signer.signedAt ? '✅' : signer.declinedAt ? '⛔' : signer.firstViewedAt ? '👀' : '⏳';
  const what = signer.signedAt
    ? `Signed ${stamp(signer.signedAt)}${signer.signatureKind === 'drawn' ? ' · drawn' : ''}`
    : signer.declinedAt
      ? `Declined ${stamp(signer.declinedAt)}${signer.declineReason ? ` — “${signer.declineReason}”` : ''}`
      : signer.firstViewedAt
        ? `Opened ${stamp(signer.firstViewedAt)}, not signed yet`
        : [signer.textedAt ? 'texted' : '', signer.emailedAt ? 'emailed' : ''].filter(Boolean).join(' & ') || 'not sent';

  return (
    <div className="py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs">{state}</span>
        <span className="text-[13px] font-medium text-gray-900">{signer.name}</span>
        <span className="text-[11px] text-gray-500">{what}</span>
      </div>
      <WhereSigned signer={signer} />
      {(signer.emailError || signer.textError) && (
        <p className="text-[11px] text-red-600 mt-0.5">{signer.emailError || signer.textError}</p>
      )}
    </div>
  );
}

/**
 * Send a document out for signature, and watch it come back.
 *
 * The rep picks a document this app built, who signs it and how it reaches
 * them. Everything after that — the link, the signature, where they were
 * standing, the signed PDF filed on the job — happens on its own.
 */
export default function SignatureRequests({ externalId }: { externalId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocsPayload | null>(null);
  const [requests, setRequests] = useState<SignatureRequestView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const [pick, setPick] = useState('');
  const [signers, setSigners] = useState<SignerDraft[]>([]);
  const [message, setMessage] = useState('');
  const [byText, setByText] = useState(true);
  const [byEmail, setByEmail] = useState(true);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 7000); };

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<DocsPayload>(`/api/clients/${externalId}/signature-docs`),
      api.get<{ requests: SignatureRequestView[] }>(`/api/clients/${externalId}/signature-requests`),
    ])
      .then(([d, r]) => {
        setDocs(d);
        setRequests(r.requests || []);
        setError(null);
        setPick((p) => p || (d.options[0] ? optionKey(d.options[0]) : ''));
        setSigners((s) => (s.length ? s : [{ name: d.customer.name, email: d.customer.email, phone: d.customer.phone, role: 'customer' }]));
      })
      .catch((e: any) => setError(e?.message || 'Could not load this.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open && !docs) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = docs?.options.find((o) => optionKey(o) === pick) || null;
  const outstanding = requests.filter((r) => r.status === 'sent').length;

  const setSigner = (i: number, patch: Partial<SignerDraft>) =>
    setSigners((list) => list.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const send = async () => {
    if (!chosen) return;
    setBusy('send');
    try {
      const r = await api.post<{ warnings?: string[] }>(`/api/clients/${externalId}/signature-requests`, {
        kind: chosen.kind,
        ref: chosen.ref,
        message: message.trim() || null,
        channels: { email: byEmail, text: byText },
        signers: signers.filter((s) => s.name.trim()),
      });
      flash(r.warnings?.length ? `Sent, but: ${r.warnings.join(' ')}` : `“${chosen.label}” is out for signature.`);
      setComposing(false);
      setMessage('');
      load();
    } catch (e: any) {
      flash(e?.message || 'That did not send.');
    } finally {
      setBusy(null);
    }
  };

  const act = async (name: string, run: () => Promise<string>) => {
    setBusy(name);
    try { flash(await run()); load(); }
    catch (e: any) { flash(e?.message || 'That failed.'); }
    finally { setBusy(null); }
  };

  const remind = (r: SignatureRequestView) => act(`remind-${r.id}`, async () => {
    const out = await api.post<{ reminded: number }>(`/api/signature-requests/${r.id}/remind`, { channels: { email: true, text: true } });
    return `Reminded ${out.reminded} ${out.reminded === 1 ? 'person' : 'people'}.`;
  });

  const voidIt = (r: SignatureRequestView) => {
    const reason = window.prompt(`Cancel “${r.title}”? The links stop working. What should the record say?`, '');
    if (reason === null) return;
    return act(`void-${r.id}`, async () => {
      await api.post(`/api/signature-requests/${r.id}/void`, { reason });
      return 'Cancelled — those links no longer open.';
    });
  };

  const copyLink = async (s: SignerView) => {
    if (!s.signUrl) return;
    try { await navigator.clipboard.writeText(s.signUrl); flash(`Copied ${s.name}'s signing link.`); }
    catch { window.prompt('Copy this link:', s.signUrl); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-800">✍️ Send for signature</span>
        <span className="text-xs text-gray-400 flex items-center gap-2">
          {outstanding > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">{outstanding} out</span>}
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading && !docs && <p className="text-sm text-gray-400">Loading…</p>}
          {error && (
            <div className="flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <span>{error}</span><button onClick={load} className="text-xs underline">Retry</button>
            </div>
          )}
          {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}

          {docs && !docs.options.length && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Nothing on this job is ready to send yet. Generate a report, or submit the final walkthrough to build the
              certificate of completion — whatever the app builds can go out for signature from here.
            </p>
          )}

          {docs && !!docs.options.length && !composing && (
            <button onClick={() => setComposing(true)} className="w-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-2.5">
              Send a document for signature
            </button>
          )}

          {docs && composing && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3 bg-gray-50">
              <div>
                <label className={label}>Which document</label>
                <select className={input} value={pick} onChange={(e) => setPick(e.target.value)}>
                  {docs.options.map((o) => (
                    <option key={optionKey(o)} value={optionKey(o)}>{o.label}{o.detail ? ` — ${o.detail}` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className={label}>Who signs it</label>
                {signers.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input className={input} placeholder="Full name" value={s.name} onChange={(e) => setSigner(i, { name: e.target.value })} />
                    <input className={input} type="email" inputMode="email" placeholder="Email" value={s.email} onChange={(e) => setSigner(i, { email: e.target.value })} />
                    <div className="flex gap-2">
                      <input className={input} type="tel" inputMode="tel" placeholder="Mobile" value={s.phone} onChange={(e) => setSigner(i, { phone: e.target.value })} />
                      {signers.length > 1 && (
                        <button onClick={() => setSigners((l) => l.filter((_, n) => n !== i))} className="text-gray-400 hover:text-red-600 text-sm px-1" title="Remove">✕</button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 text-xs">
                  {signers.length < 4 && (
                    <button onClick={() => setSigners((l) => [...l, { name: '', email: '', phone: '', role: 'customer' }])} className="text-blue-600 hover:underline">
                      + Another signer
                    </button>
                  )}
                  {signers.length < 4 && !signers.some((s) => s.role === 'company') && (
                    <button
                      onClick={() => setSigners((l) => [...l, { name: docs.me.name || user?.name || '', email: docs.me.email, phone: '', role: 'company' }])}
                      className="text-blue-600 hover:underline"
                    >+ Countersign for Best Roofing Now</button>
                  )}
                </div>
              </div>

              <div>
                <label className={label}>A note with it (optional)</label>
                <input className={input} maxLength={600} placeholder="Here's the proposal we went through — sign when you're ready."
                       value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={byText} onChange={(e) => setByText(e.target.checked)} /> Text it
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} /> Email it
                </label>
              </div>

              <p className="text-[11px] text-gray-500">
                The text goes from the business number through GoHighLevel; the email from your own mailbox. Each signer gets their
                own link, and the page asks for their location before they sign — they can say no and still sign.
              </p>

              <div className="flex gap-2">
                <button onClick={send} disabled={busy === 'send' || !chosen || !signers.some((s) => s.name.trim())}
                        className="flex-1 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-2.5 disabled:opacity-50">
                  {busy === 'send' ? 'Sending…' : 'Send it'}
                </button>
                <button onClick={() => setComposing(false)} className="px-3 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          )}

          {requests.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{r.title}</p>
                  <p className="text-[11px] text-gray-500">
                    {r.sentAt ? `Sent ${stamp(r.sentAt)}` : 'Not sent'}{r.sentBy ? ` by ${r.sentBy}` : ''}
                    {r.completedAt ? ` · completed ${stamp(r.completedAt)}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </div>

              <div className="mt-2 divide-y divide-gray-50">
                {r.signers.map((s) => <SignerRow key={s.id} signer={s} />)}
              </div>

              {/* Without the property's own coordinates nothing can be measured
                  against the roof — say so rather than just showing no distance. */}
              {!r.propertyLocated && r.signers.some((s) => s.signedAt) && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2">
                  We couldn't put {r.propertyAddress ? 'this address' : 'the property'} on the map, so signatures show where the signer
                  was but not how far that was from the job.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                <a href={`/api/signature-requests/${r.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {r.status === 'signed' ? 'Signed PDF' : 'Record so far'}
                </a>
                {r.status === 'sent' && (
                  <button onClick={() => remind(r)} disabled={busy === `remind-${r.id}`} className="text-blue-600 hover:underline disabled:opacity-50">
                    {busy === `remind-${r.id}` ? 'Reminding…' : 'Remind'}
                  </button>
                )}
                {r.signers.filter((s) => !s.signedAt && s.signUrl).map((s) => (
                  <button key={s.id} onClick={() => copyLink(s)} className="text-gray-500 hover:underline">Copy {s.name.split(' ')[0]}'s link</button>
                ))}
                {r.status !== 'signed' && r.status !== 'voided' && (
                  <button onClick={() => voidIt(r)} disabled={busy === `void-${r.id}`} className="ml-auto text-gray-400 hover:text-red-600">Cancel</button>
                )}
                {r.jobtreadFileId && <span className="ml-auto text-emerald-700">Filed on the job</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
