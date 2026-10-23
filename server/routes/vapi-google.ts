/**
 * Google access for the Vapi voice agent.
 *
 * Every other Google path in this app scopes to "the signed-in user". A phone
 * call has no signed-in user, so the voice agent instead speaks for ONE
 * configured mailbox — VOICE_MAILBOX, defaulting to the owner's — reached
 * through the same domain-wide delegation as everything else.
 *
 * This replaced a process-global OAuth token that nothing ever populated in
 * production, so the voice agent's calendar and email tools had been answering
 * "Google Calendar isn't connected yet" on every call.
 *
 * The mailbox is deliberately NOT taken from the request: Vapi payloads come
 * from the phone network, and letting one name a mailbox would turn the shared
 * webhook secret into read/send access for any account in the domain.
 */
import { getDelegatedCalendar } from '../integrations/google-workspace';
import { sendAsMailbox } from '../integrations/company-mail';
import { getDelegatedGmail, createDraftInMailbox } from '../integrations/google-workspace';

const DEFAULT_VOICE_MAILBOX = 'james@bestroofingnow.com';

export function voiceMailbox(): string {
  return (process.env.VOICE_MAILBOX || DEFAULT_VOICE_MAILBOX).trim().toLowerCase();
}

/** Whether delegation is configured at all — drives the "not connected" replies. */
export function voiceGoogleReady(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY);
}

export interface VoiceEvent {
  summary: string;
  /** ISO datetime for timed events, or a bare YYYY-MM-DD for all-day ones. */
  start: string;
  location?: string;
}

export async function voiceCalendarEvents(timeMin: Date, timeMax: Date): Promise<VoiceEvent[]> {
  const res = await getDelegatedCalendar(voiceMailbox()).events.list({
    calendarId: 'primary',
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25,
  });
  return (res.data.items || [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      summary: e.summary || '(no title)',
      // The caller distinguishes all-day by the absence of 'T'.
      start: e.start?.dateTime || e.start?.date || '',
      location: e.location || undefined,
    }))
    .filter((e) => !!e.start);
}

export interface VoiceEmail {
  fromName: string;
  subject: string;
  snippet: string;
}

export async function voiceUnreadEmail(query: string, limit: number): Promise<VoiceEmail[]> {
  const gmail = getDelegatedGmail(voiceMailbox());
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: query || 'is:unread',
    maxResults: Math.min(Math.max(limit, 1), 10),
  });
  const ids = (list.data.messages || []).map((m) => m.id).filter((x): x is string => !!x);
  const out: VoiceEmail[] = [];
  for (const id of ids) {
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      });
      const headers = msg.data.payload?.headers || [];
      const h = (n: string) => headers.find((x) => x.name === n)?.value || '';
      const from = h('From');
      out.push({
        fromName: from.replace(/<.*>/, '').replace(/"/g, '').trim() || from || 'Unknown',
        subject: h('Subject') || '(no subject)',
        snippet: (msg.data.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      });
    } catch {
      // One unreadable message shouldn't lose the rest of the summary.
    }
  }
  return out;
}

/**
 * Draft or send from the voice mailbox. Drafting is the default at the call
 * site; sending happens only when the caller explicitly asks for it.
 */
export async function voiceEmail(opts: {
  to: string;
  subject: string;
  html: string;
  cc?: string;
  send: boolean;
}): Promise<void> {
  const mailbox = voiceMailbox();
  if (opts.send) {
    await sendAsMailbox(mailbox, opts.to, opts.subject, opts.html, opts.cc);
    return;
  }
  await createDraftInMailbox(mailbox, opts.to, opts.subject, opts.html, opts.cc);
}

/**
 * The rep names the voice agent's tools may see.
 *
 * A phone call has no session, so the agent borrows the identity of the
 * mailbox it speaks for. With VOICE_MAILBOX pointed at the owner this is
 * unrestricted (null); repointing it at a rep narrows the agent's tools
 * automatically rather than leaving them company-wide.
 */
export async function voiceViewerRepNames(): Promise<string[] | null> {
  const { memberByEmail } = await import('../access/team-scope');
  const { visibleRepNamesFor } = await import('../access/team-scope');
  const me = await memberByEmail(voiceMailbox());
  if (!me) return []; // unknown mailbox: see nothing, never everything
  return visibleRepNamesFor({ email: me.email, name: me.email, role: me.role });
}
