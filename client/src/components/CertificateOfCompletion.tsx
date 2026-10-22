import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  CERTIFICATE_STATUS_LABEL, certificateBlockers,
  type CertificateData, type CertificateSignatures, type CertificateStatus,
} from '../../../shared/certificate-of-completion';

interface Certificate {
  id: number;
  status: CertificateStatus;
  data: CertificateData;
  signatures: CertificateSignatures;
  homeownerEmail: string;
  sentAt: string | null;
  sentBy: string | null;
  signUrl: string | null;
  html: string;
}

interface Payload {
  certificate: Certificate | null;
  walkthroughSubmitted: boolean;
  /** The server's own answer for the Create button: a submitted walkthrough, and nothing created yet. */
  canCreate: boolean;
  homeownerEmail: string;
}

const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';
const label = 'block text-[11px] font-semibold text-gray-500 mb-0.5';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const STATUS_STYLE: Record<CertificateStatus, string> = {
  draft: 'bg-amber-100 text-amber-700',
  sent: 'bg-sky-100 text-sky-700',
  signed: 'bg-emerald-100 text-emerald-700',
};

/**
 * The Certificate of Completion: written by the final walkthrough, signed by us,
 * then signed by the homeowner through a link we email them. Once both names are
 * on it the signed PDF is filed on the job and can ride along with the
 * depreciation request.
 *
 * Nothing here is typed twice — if the walkthrough says it, the certificate says
 * it, including the items the walkthrough flagged as still to fix.
 */
export default function CertificateOfCompletion({ externalId }: { externalId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [signName, setSignName] = useState('');
  const [email, setEmail] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  const load = () => {
    setLoading(true);
    api.get<Payload>(`/api/clients/${externalId}/certificate`)
      .then((r) => {
        setState(r);
        setEmail(r.certificate?.homeownerEmail || r.homeownerEmail || '');
        setSignName((n) => n || r.certificate?.signatures.companySigner || user?.name || '');
        setError(null);
      })
      .catch((e: any) => setError(e?.message || 'Could not load the certificate.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open && !state) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cert = state?.certificate ?? null;
  const blockers = cert ? certificateBlockers(cert.data, cert.signatures) : [];

  const act = async (name: string, run: () => Promise<string>) => {
    setBusy(name);
    try { flash(await run()); load(); }
    catch (e: any) { flash(e?.message || 'That failed.'); }
    finally { setBusy(null); }
  };

  const sign = () => act('sign', async () => {
    await api.post(`/api/clients/${externalId}/certificate/sign`, { name: signName.trim() });
    return `Signed as ${signName.trim()}.`;
  });

  const send = () => act('send', async () => {
    const r = await api.post<{ sentTo: string; sentFrom: string }>(`/api/clients/${externalId}/certificate/send`, { email: email.trim() });
    return `Signing link sent to ${r.sentTo} from ${r.sentFrom}.`;
  });

  // Once we have signed it or the homeowner has the link, pulling the
  // walkthrough in again means starting over — said plainly before it happens.
  const locked = !!cert && (!!cert.signatures.companySignedAt || !!cert.sentAt);
  const refresh = () => {
    if (locked && !window.confirm(cert?.sentAt
      ? 'Start the certificate over from the walkthrough? Your signature comes off, the link the homeowner was sent stops working, and you will sign it and send it again.'
      : 'Start the certificate over from the walkthrough? Your signature comes off and you will sign it again.')) return;
    return act('refresh', async () => {
      await api.post(`/api/clients/${externalId}/certificate/refresh`, locked ? { restart: true } : {});
      return locked ? 'Started over from the walkthrough. Sign it, then send it again.' : 'Pulled the walkthrough in again.';
    });
  };

  // Nothing creates a certificate but this. Opening the panel used to.
  const create = () => act('create', async () => {
    await api.post(`/api/clients/${externalId}/certificate`, {});
    return 'Certificate created from the final walkthrough.';
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-800">📜 Certificate of completion</span>
        <span className="text-xs text-gray-400 flex items-center gap-2">
          {cert && <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[cert.status]}`}>{CERTIFICATE_STATUS_LABEL[cert.status]}</span>}
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading && !state && <p className="text-sm text-gray-400">Loading…</p>}
          {error && (
            <div className="flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <span>{error}</span><button onClick={load} className="text-xs underline">Retry</button>
            </div>
          )}
          {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}

          {state && !state.walkthroughSubmitted && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              The certificate is written from the Final Walkthrough. <b>Submit that first</b>, then come back and create it — the date,
              who walked it, what passed and anything still to fix all come across.
            </p>
          )}

          {state?.canCreate && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <p className="text-sm text-gray-700">
                The final walkthrough is in. Create the certificate and it fills itself in from that walkthrough — the completion date,
                who walked it, what passed, anything still open and the homeowner's own comments.
              </p>
              <button
                onClick={create}
                disabled={busy === 'create'}
                className="w-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg py-2.5 disabled:opacity-50"
              >
                {busy === 'create' ? 'Creating…' : 'Create the certificate'}
              </button>
              <p className="text-[11px] text-gray-500">Nothing is sent to the homeowner yet — you sign it first, then send it.</p>
            </div>
          )}

          {cert && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Built from the walkthrough{cert.data.walkedBy ? ` walked by ${cert.data.walkedBy}` : ''}.</span>
                <button
                  onClick={refresh}
                  // A signed certificate is a record and never changes. Signed by
                  // us or sent, it can only be started over (see refresh above).
                  disabled={!!busy || cert.status === 'signed'}
                  title={cert.status === 'signed' ? 'Signed, so it can no longer change' : undefined}
                  className="underline hover:no-underline disabled:no-underline disabled:opacity-50">
                  {busy === 'refresh' ? 'Refreshing…' : locked ? 'Start over from the walkthrough' : 'Pull the walkthrough in again'}
                </button>
                <a href={`/api/clients/${externalId}/certificate/pdf`} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-600 hover:underline">Open the PDF</a>
              </div>

              <div
                className="rounded-lg border border-gray-200 p-4 bg-white text-[13px] leading-relaxed text-gray-800 max-h-96 overflow-y-auto [&_p]:mb-3 [&_ul]:list-disc [&_ul]:ml-5 [&_li]:mb-1 [&_h1]:mb-1"
                dangerouslySetInnerHTML={{ __html: cert.html }}
              />

              {cert.data.openItems.length > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  The walkthrough flagged {cert.data.openItems.length} item{cert.data.openItems.length === 1 ? '' : 's'} still to fix, and the certificate says so.
                  Sort them out before asking the homeowner to sign.
                </p>
              )}

              {/* 1. We sign. 2. They sign. In that order — a homeowner should be
                  signing something we have already put our name to. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] font-semibold text-gray-600 mb-1.5">1 · Your signature</p>
                  {cert.signatures.companySignedAt ? (
                    <p className="text-sm text-gray-800">
                      <span className="font-serif italic">{cert.signatures.companySigner}</span>
                      <span className="block text-[11px] text-gray-400">Signed {when(cert.signatures.companySignedAt)}</span>
                    </p>
                  ) : (
                    <>
                      <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Type your full name" className={input} />
                      <button onClick={sign} disabled={!!busy || signName.trim().length < 3} className="mt-2 w-full text-sm px-3 py-2 rounded-lg bg-ink text-white font-medium disabled:opacity-50">
                        {busy === 'sign' ? 'Signing…' : 'Sign it'}
                      </button>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-[11px] font-semibold text-gray-600 mb-1.5">2 · The homeowner's signature</p>
                  {cert.signatures.homeownerSignedAt ? (
                    <p className="text-sm text-gray-800">
                      <span className="font-serif italic">{cert.signatures.homeownerSigner}</span>
                      <span className="block text-[11px] text-gray-400">Signed {when(cert.signatures.homeownerSignedAt)}</span>
                    </p>
                  ) : (
                    <>
                      <label><span className={label}>Email it to them to sign</span>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="homeowner@example.com" className={input} />
                      </label>
                      <button
                        onClick={send}
                        disabled={!!busy || !email.trim() || !cert.signatures.companySignedAt}
                        title={cert.signatures.companySignedAt ? undefined : 'Sign it yourself first'}
                        className="mt-2 w-full text-sm px-3 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50"
                      >
                        {busy === 'send' ? 'Sending…' : cert.sentAt ? 'Send the link again' : 'Send for signature'}
                      </button>
                      {cert.sentAt && <p className="text-[11px] text-gray-400 mt-1.5">Sent {when(cert.sentAt)}{cert.sentBy ? ` by ${cert.sentBy.split('@')[0]}` : ''}. They sign on their phone; it lands back here.</p>}
                    </>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-gray-400">
                {cert.status === 'signed'
                  ? 'Signed by both. The PDF is filed on the job and can go with the depreciation request — tick it in Insurance letters.'
                  : blockers.length
                    ? `Before it can go to a carrier: ${blockers.join(' · ')}.`
                    : 'Ready.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
