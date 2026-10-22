import { useState } from 'react';
import { api } from '../lib/api';
import { openExternal } from '../lib/native';

/**
 * Call / Text / Email buttons that go through GoHighLevel — the business
 * number, logged on the contact's GHL timeline — instead of the rep's own
 * phone. One component for every page that shows a client, so the behaviour
 * can't drift between the leads list, the schedule, claims and the client page.
 *
 * - Text and Email send from the server via GHL's API: identical on desktop
 *   and in the phone app.
 * - Call hands off to GHL (it has no API to dial): the contact in the GHL web
 *   app on a desktop, the LeadConnector app on a phone when the server knows
 *   its deep link, else GHL mobile web. The server then notes the call on the
 *   contact. "from my phone" stays as the explicit fallback (tel:).
 * - With no `externalId` (a canvass property that isn't a lead yet) the
 *   buttons are plain tel:/sms:/mailto links.
 */

type Size = 'xs' | 'sm' | 'md';
interface GhlContact { contactId: string | null; webUrl: string | null; appUrl: string | null }

interface Props {
  externalId?: string | null;
  phone?: string | null;
  email?: string | null;
  size?: Size;
  /** Client page: jump to its full thread composer instead of the inline one. */
  onText?: () => void;
  /** Page-level toast; without it the component shows its own status line. */
  flash?: (message: string) => void;
  showEmail?: boolean;
}

const onAPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const SIZES: Record<Size, { btn: string; primary: string; secondary: string; fallback: string }> = {
  xs: { btn: 'text-[11px] px-2 py-0.5 rounded-md', primary: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', secondary: 'bg-blue-50 text-blue-700 hover:bg-blue-100', fallback: 'text-[10px]' },
  sm: { btn: 'text-xs px-2 py-1 rounded-lg', primary: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', secondary: 'bg-blue-50 text-blue-700 hover:bg-blue-100', fallback: 'text-[11px]' },
  md: { btn: 'text-sm px-3 py-1.5 rounded-lg font-medium', primary: 'bg-green-600 text-white', secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200', fallback: 'text-[11px]' },
};

export default function ContactActions({ externalId, phone, email, size = 'sm', onText, flash, showEmail = true }: Props) {
  const s = SIZES[size];
  const [contact, setContact] = useState<GhlContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState<'sms' | 'email' | null>(null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const say = (m: string) => {
    if (flash) return flash(m);
    setStatus(m); setTimeout(() => setStatus(null), 4000);
  };

  if (!phone && !email) return null;

  // Not a lead: nothing to route through GHL, hand off to the phone's own apps.
  if (!externalId) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {phone && <a href={`tel:${phone}`} className={`${s.btn} ${s.primary}`}>📞 Call</a>}
        {phone && <a href={`sms:${phone}`} className={`${s.btn} ${s.secondary}`}>💬 Text</a>}
        {showEmail && email && <a href={`mailto:${email}`} className={`${s.btn} ${s.secondary}`}>✉️ Email</a>}
      </span>
    );
  }

  const resolve = async (): Promise<GhlContact> => {
    if (contact) return contact;
    const r = await api.get<GhlContact>(`/api/clients/${externalId}/ghl-contact`);
    setContact(r);
    return r;
  };

  // Nothing opened: say so, and point at the phone's own dialer, which
  // always works. Before, a blocked window.open did nothing at all and the
  // call was still logged on the contact as if it had happened.
  const blocked = () => say('Couldn\'t open GoHighLevel here — use "from my phone" to dial.');
  const logCall = (via: string) => {
    // Fire-and-forget: the call is what matters, the note is bookkeeping.
    api.post(`/api/clients/${externalId}/call-log`, { via }).catch(() => {});
  };

  const call = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await resolve();
      if (!c.webUrl) throw new Error('no contact');
      const webUrl = c.webUrl;
      const appLink = onAPhone() && c.appUrl && !/^https?:/i.test(c.appUrl) ? c.appUrl : null;
      if (appLink) {
        // Try the LeadConnector app. If nothing takes the page away in 1.5s
        // the app isn't installed — fall back to GHL on the mobile web, in a
        // browser rather than this page: assigning location.href to GHL's site
        // left the installed app showing GHL with no way back.
        const onHide = () => {
          if (document.visibilityState !== 'hidden') return;
          clearTimeout(fallback);
          document.removeEventListener('visibilitychange', onHide);
          logCall('ghl-app');
        };
        const fallback = setTimeout(async () => {
          document.removeEventListener('visibilitychange', onHide);
          if (document.visibilityState !== 'visible') return;
          if (await openExternal(webUrl)) logCall('ghl-web'); else blocked();
        }, 1500);
        document.addEventListener('visibilitychange', onHide);
        window.location.href = appLink;   // a custom scheme hands off to the OS; it never replaces this page
      } else if (await openExternal(c.appUrl && onAPhone() ? c.appUrl : webUrl)) {
        logCall(c.appUrl && onAPhone() ? 'ghl-app' : 'ghl-web');
      } else {
        blocked();
      }
    } catch {
      say('GoHighLevel isn\'t reachable right now — use "from my phone".');
    } finally {
      setBusy(false);
    }
  };

  const openComposer = (channel: 'sms' | 'email') => {
    if (channel === 'sms' && onText) return onText();
    setComposer((c) => (c === channel ? null : channel));
  };

  const send = async () => {
    if (!composer || !message.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/api/clients/${externalId}/message`, { channel: composer, message: message.trim(), ...(composer === 'email' ? { subject: subject.trim() } : {}) });
      say(composer === 'sms' ? '💬 Text sent from the business number' : '✉️ Email sent through GoHighLevel');
      setMessage(''); setSubject(''); setComposer(null);
    } catch (e: any) {
      say(`Couldn't send: ${e?.message || 'failed'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5 max-w-full">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {phone && (
          <button type="button" onClick={call} disabled={busy} title="Opens this contact in GoHighLevel — call from the business number"
            className={`${s.btn} ${s.primary} disabled:opacity-50`}>📞 {busy ? 'Opening…' : 'Call'}</button>
        )}
        {phone && (
          <button type="button" onClick={() => openComposer('sms')} title="Text from the business number, logged in GoHighLevel"
            className={`${s.btn} ${s.secondary}`}>💬 Text</button>
        )}
        {showEmail && email && (
          <button type="button" onClick={() => openComposer('email')} title="Email through GoHighLevel, logged on the contact"
            className={`${s.btn} ${s.secondary}`}>✉️ Email</button>
        )}
        {phone && (
          <a href={`tel:${phone}`} className={`${s.fallback} text-gray-400 hover:text-gray-600 underline decoration-dotted`}
            title="Dial from this device's own phone app instead of GoHighLevel"
            onClick={() => api.post(`/api/clients/${externalId}/call-log`, { via: 'phone' }).catch(() => {})}>from my phone</a>
        )}
      </span>
      {composer && (
        <span className="flex flex-col gap-1.5 w-full max-w-md bg-white border border-gray-200 rounded-lg p-2">
          {composer === 'email' && (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
              className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5" />
          )}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} autoFocus
            placeholder={composer === 'sms' ? 'Text from the business number…' : 'Email through GoHighLevel…'}
            className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5" />
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">{composer === 'sms' ? 'Sent from the business number; replies land in GHL and here.' : 'Sent from the business mailbox via GHL.'}</span>
            <span className="flex gap-1.5">
              <button type="button" onClick={() => setComposer(null)} className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600">Cancel</button>
              <button type="button" onClick={send} disabled={!message.trim() || sending} className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
            </span>
          </span>
        </span>
      )}
      {status && <span className="text-[11px] text-gray-600">{status}</span>}
    </span>
  );
}
