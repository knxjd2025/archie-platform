import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { environment, getTrail, pageAddress } from '../lib/bug-monitor';

interface BugReportButtonProps {
  /** The page the person is on — sent with the report so nobody has to ask. */
  page: string;
}

/** Big enough to read a phone screenshot, small enough to send on one bar of signal. */
const SHOT_MAX_SIDE = 1280;
const SHOT_QUALITY = 0.72;

function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, SHOT_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', SHOT_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image this can read.')); };
    img.src = url;
  });
}

/**
 * "Report a bug", on every page. It sits bottom-left because bottom-right is
 * the phone (CallBar), and above the mobile tab bar.
 */
export default function BugReportButton({ page }: BugReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // The page the bug was on — not wherever they are by the time they press Send.
  const [reportPage, setReportPage] = useState(page);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) textRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  const start = () => {
    setReportPage(page); setMessage(''); setDetails(''); setScreenshot(null);
    setError(null); setSent(false); setOpen(true);
  };

  const pickShot = async (file: File | undefined) => {
    if (!file) return;
    try { setScreenshot(await downscale(file)); setError(null); } catch (e) { setError((e as Error).message); }
  };

  const send = async () => {
    if (message.trim().length < 3) { setError('Say a few words about what went wrong.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/api/bugs', {
        message: message.trim(), details: details.trim() || null, page: reportPage,
        url: pageAddress(), screenshot,
        context: { ...environment(), page: reportPage, trail: getTrail() },
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message || 'That did not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={start}
        className="fixed z-30 left-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 md:left-4 flex items-center gap-1.5 rounded-full bg-white/90 border border-gray-200 shadow-md px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        aria-label="Report a bug"
        title="Report a bug"
      >
        <span aria-hidden className="text-sm leading-none">🐞</span>
        <span className="hidden sm:inline">Report a bug</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="bug-title">
          <div className="absolute inset-0 bg-black/40" onClick={() => !busy && setOpen(false)} />
          <div
            className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
          >
            {sent ? (
              <div className="text-center py-4">
                <p className="text-3xl" aria-hidden>✅</p>
                <h2 id="bug-title" className="text-lg font-semibold text-gray-900 mt-2">Thanks, your admin has it</h2>
                <p className="text-sm text-gray-600 mt-1">Your report went through with the page you were on and the last few things the app did.</p>
                <button onClick={() => setOpen(false)} className="mt-4 text-sm px-4 py-2 rounded-lg bg-ink text-white font-medium">Done</button>
              </div>
            ) : (
              <>
                <h2 id="bug-title" className="text-lg font-semibold text-gray-900">Report a bug</h2>
                <p className="text-xs text-gray-500 mt-0.5">On <b>{reportPage}</b>. The page and recent errors are sent with it, so you don't need to describe those.</p>

                <label className="block mt-4 text-sm font-medium text-gray-800" htmlFor="bug-message">What went wrong?</label>
                <textarea
                  id="bug-message" ref={textRef} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={4000}
                  placeholder="e.g. The Save button spun forever and the note never showed up."
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />

                <label className="block mt-3 text-sm font-medium text-gray-800" htmlFor="bug-details">
                  What were you trying to do? <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  id="bug-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={4000}
                  placeholder="e.g. Adding a follow-up for the Johnson job."
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />

                <div className="mt-3">
                  {screenshot ? (
                    <div className="flex items-center gap-3">
                      <img src={screenshot} alt="Attached screenshot" className="h-16 w-auto rounded border border-gray-200" />
                      <button onClick={() => setScreenshot(null)} className="text-xs text-red-600 hover:underline">Remove</button>
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-2 text-sm text-blue-700 cursor-pointer hover:underline">
                      <span aria-hidden>📎</span> Attach a screenshot <span className="text-gray-400">(optional)</span>
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickShot(e.target.files?.[0])} />
                    </label>
                  )}
                </div>

                {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={() => setOpen(false)} disabled={busy} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">Cancel</button>
                  <button onClick={send} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-60">
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
