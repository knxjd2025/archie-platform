import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { isNativeApp } from '../lib/native';
import {
  LETTER_KINDS, SUBJECT_LINES, defaultFields, renderLetter, unfilledPlaceholders, type LetterFields, type LetterKind,
} from '../../../shared/neighbor-letters';

interface Ctx {
  repName: string; repCell: string; streetName: string; cityStateZip: string; insuranceJob: boolean; stage: string | null;
  reviewCount: string; gettingLines: string[]; gettingSource: string | null; estimateUrl: string; bookingUrl: string; officeAddress: string; canEditSettings: boolean;
}

/**
 * The three neighbor letters, filled from this job. The rep checks the few
 * things the app can't know (neighborhood, year built), then copies the text,
 * copies the email as HTML for GHL, or prints on letterhead (the mailer
 * carries a QR code to the estimate tool). Nothing is stored.
 */
export default function NeighborLetters({ externalId }: { externalId: string }) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<LetterKind>('leave_behind');
  const [f, setF] = useState<LetterFields>(defaultFields());
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    if (!open || ctx) return;
    api.get<Ctx>(`/api/clients/${externalId}/neighbor-letters/context`)
      .then((c) => {
        setCtx(c);
        setF(defaultFields({
          repName: c.repName, repCell: c.repCell, streetName: c.streetName, reviewCount: c.reviewCount, gettingLines: c.gettingLines,
          insuranceJob: c.insuranceJob, estimateUrl: c.estimateUrl, bookingUrl: c.bookingUrl, officeAddress: c.officeAddress,
          mailingCityStateZip: c.cityStateZip,
        }));
      })
      .catch((e: any) => setError(e?.message || 'Could not load the letter details.'));
  }, [open, ctx, externalId]);

  const letter = useMemo(() => renderLetter(kind, f), [kind, f]);
  const missing = unfilledPlaceholders(letter.text);
  const set = (patch: Partial<LetterFields>) => setF((cur) => ({ ...cur, ...patch }));
  const used = (how: string) => api.post(`/api/clients/${externalId}/neighbor-letters/used`, { kind, how }).catch(() => {});

  const copyText = async () => {
    const text = kind === 'email' ? `Subject: ${letter.subject}\nPreview: ${letter.previewText}\n\n${letter.text}` : letter.text;
    try { await navigator.clipboard.writeText(text); flash('Copied'); used('copied'); } catch { flash("Couldn't copy — select the preview and copy it."); }
  };
  const copyHtml = async () => {
    try {
      const blob = new Blob([letter.html], { type: 'text/html' });
      const plain = new Blob([letter.text], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': plain })]);
      flash('Copied as email — paste into GHL'); used('copied_html');
    } catch { await copyText(); }
  };
  const print = async () => {
    let html = letter.html;
    if (kind === 'mailer') {
      try {
        const svg = await QRCode.toString(f.estimateUrl, { type: 'svg', margin: 0, width: 96 });
        html = html.replace(/<span data-qr="[^"]*"><\/span>/, `<span style="display:inline-block;vertical-align:middle;width:72px;height:72px;margin-left:8px">${svg}</span>`);
      } catch { /* the link is still printed in words */ }
    }
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${kind === 'mailer' ? 'Neighbor letter' : 'Leave-behind letter'}</title>
      <style>
        @page { margin: 0.9in; }
        body { font: 12.5pt/1.55 Georgia, 'Times New Roman', serif; color: #1a1a1a; max-width: 7in; margin: 0 auto; padding: 24px; }
        .lh { display:flex; align-items:center; justify-content:space-between; border-bottom: 3px solid #b8322b; padding-bottom: 10px; margin-bottom: 22px; }
        .lh b { font: 700 20pt Georgia, serif; color: #0e1f57; }
        .lh span { font: 10pt Arial, sans-serif; color: #555; text-align: right; }
        h3, p { margin: 0 0 12px; } ul { margin: 0 0 12px 20px; padding: 0; } li { margin: 0 0 4px; }
        a { color: #0e1f57; }
        .foot { margin-top: 28px; border-top: 1px solid #ddd; padding-top: 8px; font: 9.5pt Arial, sans-serif; color: #666; }
      </style></head><body>
      <div class="lh"><b>Best Roofing Now</b><span>Charlotte's family-run roofing experts<br>(704) 605-6047 · bestroofingnow.com</span></div>
      ${html}
      <div class="foot">Best Roofing Now LLC · ${esc(f.officeAddress)}</div>
      <script>window.onload = function(){ window.print(); }</script></body></html>`);
    w.document.close();
    used('printed');
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const r = await api.put<{ estimateUrl: string; bookingUrl: string; officeAddress: string }>('/api/neighbor-letters/settings', { estimateUrl: f.estimateUrl, bookingUrl: f.bookingUrl, officeAddress: f.officeAddress });
      setCtx((c) => (c ? { ...c, ...r } : c)); flash('Saved for every rep'); setSettingsOpen(false);
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); }
    finally { setSavingSettings(false); }
  };

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-blue-400';
  const label = 'block text-[11px] font-semibold text-gray-500 mb-0.5';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">📬 Neighbor letters</h3>
          <p className="text-xs text-gray-400">A roof going up here is a reason to knock, email and mail the street. Filled in from this job.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="text-xs px-2.5 py-1 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark">{open ? 'Close' : 'Write letters'}</button>
      </div>
      {open && (
        <div className="p-4 space-y-3">
          {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!ctx && !error && <p className="text-sm text-gray-400">Loading…</p>}
          {ctx && (
            <>
              <div className="flex gap-1 flex-wrap">
                {LETTER_KINDS.map((k) => (
                  <button key={k.kind} onClick={() => setKind(k.kind)} title={k.use}
                    className={`text-sm px-3 py-1.5 rounded-lg font-medium ${kind === k.kind ? 'bg-navy text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{k.label}</button>
                ))}
              </div>
              <p className="text-xs text-gray-500">{LETTER_KINDS.find((k) => k.kind === kind)?.use} Never the customer's name or house number.</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Fields */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={label}>Rep name</label><input value={f.repName} onChange={(e) => set({ repName: e.target.value })} className={input} /></div>
                    <div><label className={label}>Rep cell</label><input value={f.repCell} onChange={(e) => set({ repCell: e.target.value })} placeholder="(704) 555-0100" className={input} /></div>
                    <div><label className={label}>Street (no house number)</label><input value={f.streetName} onChange={(e) => set({ streetName: e.target.value })} className={input} /></div>
                    <div><label className={label}>Neighborhood</label><input value={f.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })} placeholder='or "this area"' className={input} /></div>
                    <div><label className={label}>Year homes were built</label><input value={f.yearBuilt} onChange={(e) => set({ yearBuilt: e.target.value })} placeholder='Redfin/Zillow, or "the same time"' className={input} /></div>
                    <div><label className={label}>Google review count</label><input value={f.reviewCount} onChange={(e) => set({ reviewCount: e.target.value })} className={input} /></div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.insuranceJob} onChange={(e) => set({ insuranceJob: e.target.checked })} /> Storm / insurance job (keeps the "didn't wait" paragraph true)</label>
                  {kind !== 'email' && (
                    <div>
                      <label className={label}>What your neighbor is getting {ctx.gettingSource ? <span className="font-normal text-gray-400">— from the {ctx.gettingSource}</span> : <span className="font-normal text-gray-400">— copy from the approved proposal; leave blank on a simple job</span>}</label>
                      {[0, 1, 2].map((i) => (
                        <input key={i} value={f.gettingLines[i] || ''} onChange={(e) => { const g = [...f.gettingLines]; g[i] = e.target.value; set({ gettingLines: g }); }}
                          placeholder={['A complete CertainTeed Integrity Roof System', 'A 50-year CertainTeed product warranty', 'Properly sized attic ventilation'][i]} className={`${input} mb-1`} />
                      ))}
                    </div>
                  )}
                  {kind === 'email' && (
                    <div>
                      <label className={label}>Subject line</label>
                      <select value={f.subjectIndex} onChange={(e) => set({ subjectIndex: Number(e.target.value) })} className={input}>
                        {SUBJECT_LINES(f).map((s, i) => <option key={i} value={i}>{s}</option>)}
                      </select>
                      <p className="text-[11px] text-gray-400 mt-1">Preview text: {letter.previewText}</p>
                    </div>
                  )}
                  {kind === 'mailer' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className={label}>Date</label><input value={f.date} onChange={(e) => set({ date: e.target.value })} className={input} /></div>
                      <div><label className={label}>Recipient</label><input value={f.recipientName} onChange={(e) => set({ recipientName: e.target.value })} placeholder="Current Resident" className={input} /></div>
                      <div><label className={label}>Mailing address</label><input value={f.mailingAddress} onChange={(e) => set({ mailingAddress: e.target.value })} placeholder="Street address" className={input} /></div>
                      <div><label className={label}>City, State ZIP</label><input value={f.mailingCityStateZip} onChange={(e) => set({ mailingCityStateZip: e.target.value })} className={input} /></div>
                    </div>
                  )}
                  {ctx.canEditSettings && (
                    <div className="pt-1">
                      <button onClick={() => setSettingsOpen((v) => !v)} className="text-xs text-blue-600 hover:underline">{settingsOpen ? 'Hide' : 'Office settings'} (links &amp; mailing address, admin)</button>
                      {settingsOpen && (
                        <div className="mt-1 space-y-1">
                          <input value={f.estimateUrl} onChange={(e) => set({ estimateUrl: e.target.value })} placeholder="Instant estimate tool link" className={input} />
                          <input value={f.bookingUrl} onChange={(e) => set({ bookingUrl: e.target.value })} placeholder="Free inspection booking link" className={input} />
                          <input value={f.officeAddress} onChange={(e) => set({ officeAddress: e.target.value })} placeholder="Mailing address for the email footer" className={input} />
                          <button onClick={saveSettings} disabled={savingSettings} className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white disabled:opacity-50">{savingSettings ? 'Saving…' : 'Save for every rep'}</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Preview */}
                <div className="min-w-0">
                  {missing.length > 0 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">Still to fill: {missing.join(', ')}</p>}
                  {kind === 'email' && <p className="text-xs text-gray-600 mb-1"><b>Subject:</b> {letter.subject}</p>}
                  <div className="border border-gray-200 rounded-lg p-3 text-[13px] leading-relaxed text-gray-800 max-h-[28rem] overflow-y-auto [&_p]:mb-2 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:mb-2 [&_li]:mb-0.5" dangerouslySetInnerHTML={{ __html: letter.html }} />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button onClick={copyText} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">Copy text</button>
                    {kind === 'email' && <button onClick={copyHtml} className="text-sm px-3 py-1.5 rounded-lg bg-navy text-white font-medium">Copy for GHL email</button>}
                    {/* The app's WebView has no print dialog and a blank window.open page is a dead end there, so Print only shows on the website; Copy works everywhere. */}
                    {kind !== 'email' && !isNativeApp() && <button onClick={print} className="text-sm px-3 py-1.5 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark">Print on letterhead{kind === 'mailer' ? ' + QR' : ''}</button>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The office address is typed in settings and lands in a document.write page;
// escape it like InsuranceLetters does so a stray < cannot become markup.
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
