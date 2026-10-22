import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { isNativeApp } from '../lib/native';
import { shrinkImage } from './JobPhotos';
import {
  INSURANCE_LETTERS, LETTER_FORMATS, buildInsuranceLetter, depreciationDue, letterDef, letterWarnings,
  looksLikeFinalInvoice, missingLetterFields, usd,
  type ClaimLetterFields, type InsuranceLetterKind, type LetterFormat, type LetterImage,
} from '../../../shared/insurance-letters';

interface JobPhoto { id: string; name: string; url: string | null; description: string | null }
interface JobFile { id: string; name: string; type: string | null; size: number | null; isImage: boolean }
interface Upload { name: string; contentType: string; base64: string; preview: string }
interface DocUpload { name: string; contentType: string; base64: string }

interface Ctx {
  insuranceJob: boolean;
  claimFound: boolean;
  claimStage: string | null;
  depreciationRequested: boolean;
  fields: ClaimLetterFields & { adjusterEmail: string; enclosuresByKind: Record<string, string[]> };
}

const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';
const label = 'block text-[11px] font-semibold text-gray-500 mb-0.5';

/**
 * Everything that gets written to a carrier on this job, in the order a claim
 * actually runs: the estimate package, a chase, a supplement, a re-inspection
 * request, lab results, and the depreciation release at the end.
 *
 * Prefilled from the claim and the job, but every field is editable, because
 * the carrier's paperwork — not this app — is the authority on what was
 * approved. The depreciation arithmetic is shown so whoever signs it can check
 * it before it goes.
 */
export default function InsuranceLetters({ externalId }: { externalId: string }) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [f, setF] = useState<ClaimLetterFields | null>(null);
  const [letter, setLetter] = useState<InsuranceLetterKind>('depreciation');
  const [kind, setKind] = useState<LetterFormat>('letter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState(false);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [docs, setDocs] = useState<JobFile[]>([]);
  const [pickedDocs, setPickedDocs] = useState<string[]>([]);
  const [docUploads, setDocUploads] = useState<DocUpload[]>([]);
  const [cert, setCert] = useState<{ status: string; signedAt: string | null } | null>(null);
  const [includeCert, setIncludeCert] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [sending, setSending] = useState(false);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  useEffect(() => {
    if (!open || ctx) return;
    setLoading(true);
    api.get<Ctx>(`/api/clients/${externalId}/insurance-letters/context`)
      .then((r) => { setCtx(r); setF(r.fields); setSentNote(r.depreciationRequested); setTo(r.fields.adjusterEmail || ''); setError(null); })
      .catch((e: any) => setError(e?.message || 'Could not load the claim details.'))
      .finally(() => setLoading(false));
    api.get<{ photos: JobPhoto[] }>(`/api/clients/${externalId}/photos`)
      .then((r) => setPhotos((r.photos || []).filter((p) => p.url)))
      .catch(() => { /* the letter is still sendable without job photos */ });
    api.get<{ certificate: { status: string; signatures: { homeownerSignedAt: string | null } } | null }>(`/api/clients/${externalId}/certificate`)
      .then((r) => {
        const signedAt = r.certificate?.signatures.homeownerSignedAt ?? null;
        setCert(r.certificate ? { status: r.certificate.status, signedAt } : null);
        // A signed certificate is what the carrier is waiting on, so it starts
        // ticked — but only on the letter that asks for the depreciation.
        if (signedAt) setIncludeCert(true);
      })
      .catch(() => { /* the letter still sends without it */ });
    api.get<{ files: JobFile[] }>(`/api/clients/${externalId}/files`)
      .then((r) => {
        const pdfs = (r.files || []).filter((f) => !f.isImage && (/pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name)));
        setDocs(pdfs);
        // The final invoice is what the carrier asks for, so it starts ticked
        // when the job already has one — but only ever one, and only a match
        // confident enough to be right.
        const invoice = pdfs.find((f) => looksLikeFinalInvoice(f.name, f.type));
        if (invoice) setPickedDocs([invoice.id]);
      })
      .catch(() => { /* documents are optional; the letter still sends */ });
  }, [open, ctx, externalId]);

  const set = <K extends keyof ClaimLetterFields>(k: K, v: ClaimLetterFields[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setMoney = (k: 'rcv' | 'supplements' | 'acv' | 'deductible' | 'amount' | 'invoiceTotal', v: string) =>
    set(k, Math.max(0, Number(v.replace(/[^0-9.]/g, '')) || 0));
  const def = letterDef(letter);

  /**
   * Switching letter swaps the enclosures for that letter's usual paperwork,
   * and swaps the date with them. The date the job knows is the completion
   * date; carrying it into "carrier's written decision dated" would put a
   * confidently wrong date in front of an adjuster, so every other letter
   * starts blank and remembers whatever was typed for it.
   */
  const [datePerLetter, setDatePerLetter] = useState<Partial<Record<InsuranceLetterKind, string>>>({});
  const chooseLetter = (next: InsuranceLetterKind) => {
    if (next === letter) return;
    setDatePerLetter((d) => ({ ...d, [letter]: f?.eventDate ?? '' }));
    // The final invoice belongs with the depreciation request, not with a
    // supplement or a re-inspection. Carrying the tick across letters would
    // quietly send a carrier the wrong paperwork — and the same is true of the
    // photos: roof-completion shots have no business on a re-inspection request.
    setPickedDocs(next === 'depreciation' ? docs.filter((d) => looksLikeFinalInvoice(d.name, d.type)).slice(0, 1).map((d) => d.id) : []);
    setPicked([]);
    setUploads([]);
    setF((x) => (x ? {
      ...x,
      enclosures: [...(ctx?.fields.enclosuresByKind?.[next] ?? x.enclosures)],
      eventDate: datePerLetter[next] ?? (next === 'depreciation' ? ctx?.fields.eventDate ?? '' : ''),
    } : x));
    setLetter(next);
  };

  // In the preview and on paper the photos are their own URLs; in the email the
  // server swaps them for cid: references and sends the bytes with the message.
  const previewImages: LetterImage[] = useMemo(() => [
    ...picked.map((id) => photos.find((p) => p.id === id)).filter(Boolean).map((p) => ({ src: p!.url!, caption: p!.description || undefined })),
    ...uploads.map((u) => ({ src: u.preview, caption: undefined })),
  ], [picked, photos, uploads]);
  const built = useMemo(() => (f ? buildInsuranceLetter(letter, f, kind, previewImages) : null), [f, letter, kind, previewImages]);
  const attachedDocs = useMemo(
    () => [...pickedDocs, ...docUploads.map((d) => d.name), ...(includeCert && cert?.signedAt && letter === 'depreciation' ? ['certificate'] : [])],
    [pickedDocs, docUploads, includeCert, cert?.signedAt, letter],
  );
  const computed = f ? depreciationDue(f) : 0;
  const missing = f ? missingLetterFields(letter, f) : [];
  const warnings = f ? letterWarnings(letter, f) : [];

  const recordSent = (how: string) => {
    setSentNote(true);
    api.post(`/api/clients/${externalId}/insurance-letters/sent`, { how, amount: f?.amount, kind: letter })
      .then((r: any) => { if (r?.claimTicked) flash('Marked "Depreciation requested" on the claim.'); })
      .catch(() => { /* the letter still went out; the log is best-effort */ });
  };

  const copyText = async () => {
    if (!built) return;
    try { await navigator.clipboard.writeText(built.text); flash('Copied'); recordSent('copied'); }
    catch { flash("Couldn't copy — select the preview and copy it."); }
  };

  const copyHtml = async () => {
    if (!built) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([built.html], { type: 'text/html' }),
        'text/plain': new Blob([built.text], { type: 'text/plain' }),
      })]);
      flash('Copied as email — paste into the adjuster email'); recordSent('copied_html');
    } catch { await copyText(); }
  };

  const print = () => {
    if (!built || !f) return;
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(built.subject)}</title>
      <style>
        @page { margin: 0.9in; }
        body { font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #1a1a1a; max-width: 7in; margin: 0 auto; padding: 24px; }
        .lh { display:flex; align-items:center; justify-content:space-between; border-bottom: 3px solid #b8322b; padding-bottom: 10px; margin-bottom: 22px; }
        .lh b { font: 700 20pt Georgia, serif; color: #0e1f57; }
        .lh span { font: 10pt Arial, sans-serif; color: #555; text-align: right; }
        p { margin: 0 0 12px; } ul { margin: 0 0 12px 20px; padding: 0; } li { margin: 0 0 4px; }
        .foot { margin-top: 28px; border-top: 1px solid #ddd; padding-top: 8px; font: 9.5pt Arial, sans-serif; color: #666; }
      </style></head><body>
      <div class="lh"><b>${esc(f.companyName)}</b><span>${esc(f.officeAddress)}<br>${esc(f.companyPhone)} · bestroofingnow.com</span></div>
      ${built.html}
      <div class="foot">${esc(f.companyName)} LLC · ${esc(f.officeAddress)} · ${esc(f.companyPhone)}</div>
      <script>window.onload = function(){ window.print(); }</script></body></html>`);
    w.document.close();
    recordSent('printed');
  };

  const attachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files.slice(0, 6)) {
      try {
        const { base64, contentType } = await shrinkImage(file);
        setUploads((u) => [...u, { name: file.name, contentType, base64, preview: `data:${contentType};base64,${base64.replace(/^data:[^;]+;base64,/, '')}` }].slice(0, 6));
      } catch { flash(`Couldn't read ${file.name}`); }
    }
  };

  const attachDocs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files.slice(0, 4)) {
      if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) { flash(`${file.name} isn't a PDF`); continue; }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]+;base64,/, ''));
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(file);
        });
        setDocUploads((d) => [...d, { name: file.name, contentType: 'application/pdf', base64 }].slice(0, 4));
      } catch { flash(`Couldn't read ${file.name}`); }
    }
  };

  const send = async () => {
    if (!f || sending) return;
    setSending(true);
    try {
      const r = await api.post<{ sentFrom: string; photos: number; documents: number; certificate: boolean; skipped: string[]; claimTicked: boolean }>(
        `/api/clients/${externalId}/insurance-letters/send`,
        {
          kind: letter, to: to.trim(), cc: cc.trim() || undefined, fields: f,
          photoIds: picked, uploads: uploads.map(({ name, contentType, base64 }) => ({ name, contentType, base64 })),
          documentIds: pickedDocs, documentUploads: docUploads,
          includeCertificate: includeCert && letter === 'depreciation',
        },
      );
      setSentNote(true);
      const carried = [
        r.photos ? `${r.photos} photo${r.photos === 1 ? '' : 's'}` : '',
        r.documents ? `${r.documents} document${r.documents === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');
      flash(`Sent from ${r.sentFrom} to ${to.trim()}${carried ? ` with ${carried}` : ''}.`
        + (r.skipped.length ? ` Left out: ${r.skipped.join('; ')}.` : '')
        + (r.claimTicked ? ' Claim marked as requested.' : ''));
    } catch (e: any) {
      flash(`Couldn't send: ${e?.message || 'failed'}`);
    } finally { setSending(false); }
  };

  const mailto = () => {
    if (!built || !f) return '';
    const to = (ctx?.fields.adjusterEmail || '').trim();
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(built.subject)}&body=${encodeURIComponent(built.text)}`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-800">🧾 Insurance letters</span>
        <span className="text-xs text-gray-400">{INSURANCE_LETTERS.length} letters to the carrier {open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading && <p className="text-sm text-gray-400">Loading the claim…</p>}
          {error && (
            <div className="flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <span>{error}</span>
              <button onClick={() => { setCtx(null); setError(null); }} className="text-xs underline">Retry</button>
            </div>
          )}
          {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}

          {ctx && f && (
            <>
              {!ctx.claimFound && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  No claim on the Claims board for this job, so nothing could be prefilled — type the carrier, claim number and figures in below.
                </p>
              )}
              {ctx.depreciationRequested && letter === 'depreciation' && (
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  The claim already shows depreciation as requested. Sending again is fine — chase letters happen.
                </p>
              )}

              {/* Which letter. They run roughly in claim order. */}
              <div className="flex flex-wrap gap-1.5">
                {INSURANCE_LETTERS.map((l) => (
                  <button
                    key={l.kind}
                    type="button"
                    onClick={() => chooseLetter(l.kind)}
                    title={l.use}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${letter === l.kind ? 'bg-navy text-white border-navy' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 -mt-1">{def.use}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label><span className={label}>Carrier</span><input value={f.carrier} onChange={(e) => set('carrier', e.target.value)} className={input} /></label>
                <label><span className={label}>Adjuster</span><input value={f.adjusterName} onChange={(e) => set('adjusterName', e.target.value)} className={input} /></label>
                <label><span className={label}>Claim number</span><input value={f.claimNumber} onChange={(e) => set('claimNumber', e.target.value)} className={input} /></label>
                <label><span className={label}>Policy number</span><input value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} className={input} /></label>
                <label><span className={label}>Insured</span><input value={f.insuredName} onChange={(e) => set('insuredName', e.target.value)} className={input} /></label>
                <label><span className={label}>Date of loss</span><input type="date" value={f.dateOfLoss} onChange={(e) => set('dateOfLoss', e.target.value)} className={input} /></label>
                <label className="col-span-2 sm:col-span-2"><span className={label}>Property address</span><input value={f.propertyAddress} onChange={(e) => set('propertyAddress', e.target.value)} className={input} /></label>
                {def.dateLabel && (
                  <label><span className={label}>{def.dateLabel}</span><input type="date" value={f.eventDate} onChange={(e) => set('eventDate', e.target.value)} className={input} /></label>
                )}
              </div>

              {/* What this particular letter carries beyond the claim header. */}
              {(def.itemsLabel || (def.amountLabel && letter !== 'depreciation')) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {def.amountLabel && letter !== 'depreciation' && (
                    <label><span className={label}>{def.amountLabel}</span>
                      <input inputMode="decimal" value={f.amount || ''} onChange={(e) => setMoney('amount', e.target.value)} className={input} />
                    </label>
                  )}
                  {def.itemsLabel && (
                    <label className="sm:col-span-2"><span className={label}>{def.itemsLabel} — one per line</span>
                      <textarea rows={3} value={f.items.join('\n')} onChange={(e) => set('items', e.target.value.split('\n').map((x) => x.trimStart()).filter((x) => x.trim()))} className={input} />
                    </label>
                  )}
                </div>
              )}

              {letter === 'depreciation' && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <p className="text-[11px] font-semibold text-gray-600 mr-auto">The figures — from the claim record, editable</p>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
                    <button type="button" onClick={() => set('manualTotal', false)} className={`px-2 py-1 ${f.manualTotal ? 'bg-white text-gray-600' : 'bg-navy text-white'}`}>Work it out</button>
                    <button type="button" onClick={() => set('manualTotal', true)} className={`px-2 py-1 ${f.manualTotal ? 'bg-navy text-white' : 'bg-white text-gray-600'}`}>I'll type the total</button>
                  </div>
                </div>
                {!f.manualTotal && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label><span className={label}>Approved RCV</span><input inputMode="decimal" value={f.rcv || ''} onChange={(e) => setMoney('rcv', e.target.value)} className={input} /></label>
                  <label><span className={label}>Supplements</span><input inputMode="decimal" value={f.supplements || ''} onChange={(e) => setMoney('supplements', e.target.value)} className={input} /></label>
                  <label><span className={label}>ACV already paid</span><input inputMode="decimal" value={f.acv || ''} onChange={(e) => setMoney('acv', e.target.value)} className={input} /></label>
                  <label><span className={label}>Deductible</span><input inputMode="decimal" value={f.deductible || ''} onChange={(e) => setMoney('deductible', e.target.value)} className={input} /></label>
                </div>
                )}
                <div className="flex flex-wrap items-end gap-3 mt-2">
                  <label className="w-40"><span className={label}>Amount requested</span><input inputMode="decimal" value={f.amount || ''} onChange={(e) => setMoney('amount', e.target.value)} className={input} /></label>
                  <label className="w-40"><span className={label}>Final invoice total</span><input inputMode="decimal" value={f.invoiceTotal || ''} onChange={(e) => setMoney('invoiceTotal', e.target.value)} className={input} /></label>
                  {f.manualTotal ? (
                    <p className="text-xs text-gray-500 pb-2">The letter states this figure on its own — no breakdown.</p>
                  ) : (
                    <p className="text-xs text-gray-500 pb-2">
                      RCV{f.supplements > 0 ? ' + supplements' : ''} − ACV paid = <b>{usd(computed)}</b>
                      {Math.abs(computed - f.amount) >= 0.01 && (
                        <button onClick={() => set('amount', computed)} className="ml-2 text-blue-600 underline">use this</button>
                      )}
                    </p>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 ml-auto">
                    <input type="checkbox" checked={f.deductibleCollected} onChange={(e) => set('deductibleCollected', e.target.checked)} />
                    Deductible collected — say so in the letter
                  </label>
                </div>
              </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {letter === 'depreciation' && (
                  <label className="col-span-2"><span className={label}>Check payable to</span><input value={f.payableTo} onChange={(e) => set('payableTo', e.target.value)} className={input} /></label>
                )}
                <label><span className={label}>Your name</span><input value={f.senderName} onChange={(e) => set('senderName', e.target.value)} className={input} /></label>
                <label><span className={label}>Your title</span><input value={f.senderTitle} onChange={(e) => set('senderTitle', e.target.value)} className={input} /></label>
                <label className="col-span-2 sm:col-span-4"><span className={label}>Anything you want to add, in your own words</span>
                  <textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Goes in as its own paragraph, before the sign-off." className={input} />
                </label>
                <label className="col-span-2 sm:col-span-4"><span className={label}>Enclosures — one per line</span>
                  <textarea rows={3} value={f.enclosures.join('\n')} onChange={(e) => set('enclosures', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} className={input} />
                </label>
              </div>

              {missing.length > 0 && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">Still needed: {missing.join(', ')}.</p>
              )}
              {warnings.map((w) => (
                <p key={w} className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{w}</p>
              ))}

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold text-gray-600 mr-auto">
                    Photos {previewImages.length ? <span className="font-normal text-gray-400">· {previewImages.length} of 6</span> : <span className="font-normal text-gray-400">— shown in the letter and sent with the email</span>}
                  </p>
                  <label className="text-[11px] px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">
                    Attach from this device
                    <input type="file" accept="image/*" multiple className="hidden" onChange={attachFiles} />
                  </label>
                </div>
                {photos.length > 0 && (
                  <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                    {photos.slice(0, 40).map((p) => {
                      const on = picked.includes(p.id);
                      const full = !on && previewImages.length >= 6;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={full}
                          onClick={() => setPicked((x) => (on ? x.filter((i) => i !== p.id) : [...x, p.id]))}
                          title={full ? 'Six photos is the limit' : p.description || p.name}
                          className={`relative flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 ${on ? 'border-brick' : 'border-transparent'} ${full ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <img src={p.url!} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                          {on && <span className="absolute top-0.5 right-0.5 bg-brick text-white text-[9px] rounded px-1">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {uploads.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {uploads.map((u, i) => (
                      <span key={`${u.name}-${i}`} className="flex items-center gap-1.5 text-[11px] bg-gray-100 rounded-md pl-1 pr-1.5 py-1">
                        <img src={u.preview} alt="" className="w-6 h-6 rounded object-cover" />
                        <span className="max-w-[9rem] truncate">{u.name}</span>
                        <button type="button" onClick={() => setUploads((x) => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {photos.length === 0 && uploads.length === 0 && (
                  <p className="text-[11px] text-gray-400 mt-1.5">No photos on this job yet — attach them from the device instead.</p>
                )}
              </div>

              {/* The paperwork the carrier asks for, attached rather than promised. */}
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold text-gray-600 mr-auto">
                    Attachments {attachedDocs.length
                      ? <span className="font-normal text-gray-400">· {attachedDocs.length} of 4</span>
                      : <span className="font-normal text-gray-400">— the final invoice, the certificate of completion</span>}
                  </p>
                  <label className="text-[11px] px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">
                    Attach a PDF
                    <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={attachDocs} />
                  </label>
                </div>
                {letter === 'depreciation' && (
                  <label className={`flex items-center gap-2 text-[12px] mt-2 ${cert?.signedAt ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input
                      type="checkbox"
                      checked={includeCert && !!cert?.signedAt}
                      disabled={!cert?.signedAt}
                      onChange={(e) => setIncludeCert(e.target.checked)}
                    />
                    <span>📜 Certificate of completion</span>
                    {cert?.signedAt
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 whitespace-nowrap">signed</span>
                      : <span className="text-[10px] text-amber-700">{cert ? 'not signed by the homeowner yet' : 'not built yet — submit the final walkthrough'}</span>}
                  </label>
                )}
                {docs.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {docs.slice(0, 20).map((d) => {
                      const on = pickedDocs.includes(d.id);
                      const invoice = looksLikeFinalInvoice(d.name, d.type);
                      return (
                        <label key={d.id} className="flex items-center gap-2 text-[12px] text-gray-700">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!on && attachedDocs.length >= 4}
                            onChange={() => setPickedDocs((x) => (on ? x.filter((i) => i !== d.id) : [...x, d.id]))}
                          />
                          <span className="truncate">{d.name}</span>
                          {invoice && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 whitespace-nowrap">looks like the invoice</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                {docUploads.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {docUploads.map((d, i) => (
                      <span key={`${d.name}-${i}`} className="flex items-center gap-1.5 text-[11px] bg-gray-100 rounded-md px-1.5 py-1">
                        <span className="max-w-[12rem] truncate">📄 {d.name}</span>
                        <button type="button" onClick={() => setDocUploads((x) => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {docs.length === 0 && docUploads.length === 0 && (
                  <p className="text-[11px] text-gray-400 mt-1.5">No PDFs on this job yet — attach the invoice from the device instead.</p>
                )}
                {attachedDocs.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1.5">Nothing attached: the letter says the invoice is enclosed, so attach it before sending.</p>
                )}
              </div>

              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {LETTER_FORMATS.map((k: typeof LETTER_FORMATS[number]) => (
                  <button key={k.kind} onClick={() => setKind(k.kind)} className={`flex-1 py-1.5 ${kind === k.kind ? 'bg-navy text-white' : 'bg-white text-gray-600'}`}>{k.label}</button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">{LETTER_FORMATS.find((k) => k.kind === kind)!.use}</p>

              {built && (
                // Tailwind's reset strips paragraph margins; put them back here so
                // the preview is spaced like the page that comes out of the printer.
                <div
                  className="rounded-lg border border-gray-200 p-4 bg-white text-[13px] leading-relaxed text-gray-800 max-h-96 overflow-y-auto [&_p]:mb-3 [&_ul]:list-disc [&_ul]:ml-5 [&_li]:mb-1 [&_table]:mb-3"
                  dangerouslySetInnerHTML={{ __html: built.html }}
                />
              )}

              {/* Send it from the company mailbox — the letter is the email body,
                  with the chosen photos in it. */}
              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label><span className={label}>Send to</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="claims@carrier.com" className={input} /></label>
                  <label><span className={label}>Cc (optional)</span><input type="email" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="the adjuster, the homeowner…" className={input} /></label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={send}
                    disabled={sending || missing.length > 0 || !to.trim()}
                    className="text-sm px-4 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : `Send${previewImages.length || attachedDocs.length
                      ? ` with ${[previewImages.length && `${previewImages.length} photo${previewImages.length === 1 ? '' : 's'}`, attachedDocs.length && `${attachedDocs.length} attachment${attachedDocs.length === 1 ? '' : 's'}`].filter(Boolean).join(' + ')}`
                      : ''}`}
                  </button>
                  <p className="text-[11px] text-gray-500">
                    Goes out from your own {f.senderEmail.split('@')[1] ? `@${f.senderEmail.split('@')[1]}` : 'company'} mailbox, so the carrier's reply comes back to you.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={copyText} disabled={missing.length > 0} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">Copy text</button>
                {kind === 'email' ? (
                  <>
                    <button onClick={copyHtml} disabled={missing.length > 0} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">Copy for email</button>
                    <a
                      href={missing.length ? undefined : mailto()}
                      onClick={() => { if (!missing.length) recordSent('mailto'); }}
                      className={`text-sm px-3 py-1.5 rounded-lg font-medium ${missing.length ? 'bg-gray-100 text-gray-400 pointer-events-none' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      Open in my email app
                    </a>
                  </>
                ) : isNativeApp() ? null : (
                  // The app's WebView has no print dialog and a blank window.open page is a dead end there, so Print only shows on the website.
                  <button onClick={print} disabled={missing.length > 0} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">Print on letterhead</button>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                {letter === 'depreciation'
                  ? 'Sending marks “Depreciation requested” on the claim. Attach the certificate of completion and the final invoice — carriers ask for both.'
                  : 'Sent from your own mailbox, with whatever you attach above. Every letter is logged against the job.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
