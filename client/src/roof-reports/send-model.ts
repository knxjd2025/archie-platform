/**
 * The "Email this report" dialog, as plain functions with no screen: what is
 * drawn after each step, the one request a press sends, and who gets the
 * button. The screen only draws this and carries it out.
 *
 * A press is answered in the frame it was made in (Sending...). Each try has
 * one request key, made when the dialog opens, so a double press is the same
 * request twice and the server sends once; a press while it is already sending
 * is ignored here too. The server is the authority on every rule.
 */
import type { TeamRole } from '../../../shared/rbac';
import { MAX_SEND_MESSAGE, decisionFor } from '../../../shared/roof-reports';
import type { EditValues } from './editor-model';
import { RR, plainMessage } from './words';

export type SendPhase = 'closed' | 'form' | 'sending' | 'sent' | 'failed';
export type SendField = 'email' | 'customerName' | 'message';

export interface SendState {
  phase: SendPhase;
  email: string;
  customerName: string;
  message: string;
  /** The request key of this try. Made when the dialog opens. */
  key: string;
  error: string | null;
}

export const initialSend = (): SendState => ({ phase: 'closed', email: '', customerName: '', message: '', key: '', error: null });

export type SendAction =
  | { type: 'open'; email: string; name: string; key: string }
  | { type: 'edit'; field: SendField; text: string }
  | { type: 'sending' }
  | { type: 'sent' }
  | { type: 'failed'; error: string }
  | { type: 'close' };

export function sendReducer(state: SendState, a: SendAction): SendState {
  switch (a.type) {
    case 'open': return { phase: 'form', email: a.email, customerName: a.name, message: '', key: a.key, error: null };
    case 'edit': return state.phase === 'sending' || state.phase === 'closed' ? state : { ...state, [a.field]: a.text };
    case 'sending': return { ...state, phase: 'sending', error: null };
    case 'sent': return { ...state, phase: 'sent', error: null };
    case 'failed': return { ...state, phase: 'failed', error: a.error };
    case 'close': return initialSend();
  }
}

/** One request key for one try: letters, digits and dashes, the form the server takes. */
export function makeSendKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `send-${random}`;
}

/** A light check so a typing slip is caught before a call; the server checks it again, and it decides. */
const looksLikeAddress = (v: string): boolean => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v.trim());

/** The button works while the form is showing (or a try failed) and there is something that looks like an address. Never while it is sending. */
export const canSubmit = (s: SendState): boolean => (s.phase === 'form' || s.phase === 'failed') && looksLikeAddress(s.email);

/** What one press sends: the name and the note are left out when empty. */
export function sendBodyOf(s: SendState): { email: string; customerName?: string; message?: string } {
  const body: { email: string; customerName?: string; message?: string } = { email: s.email.trim() };
  if (s.customerName.trim()) body.customerName = s.customerName.trim();
  if (s.message.trim()) body.message = s.message.trim().slice(0, MAX_SEND_MESSAGE);
  return body;
}

/** Sends, and says what happened as the next action. "On its way" is a double press meeting the first: it is sent. */
export async function submitSend(deps: { send: (body: ReturnType<typeof sendBodyOf>, key: string) => Promise<unknown> }, s: SendState): Promise<SendAction> {
  try {
    const answer = await deps.send(sendBodyOf(s), s.key) as { status?: unknown } | null;
    return answer && (answer.status === 'sent' || answer.status === 'sending') ? { type: 'sent' } : { type: 'failed', error: RR.send.failed };
  } catch (e) {
    return { type: 'failed', error: plainMessage(e, RR.send.failed) };
  }
}

/** The button is drawn only for a role the shared table lets send. The server decides every request. */
export const sendsAllowed = (role: TeamRole): boolean => decisionFor(role, 'send') !== 'no';

/** "Emailed 3 times. Last sent Nov 24, 2026." or nothing when it never was. */
export function sentLine(count: number, at: string | null): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const times = count === 1 ? RR.send.emailedOnce : RR.send.emailedTimes(count);
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime())) return times;
  return `${times} ${RR.send.lastSent(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric'}))}`;
}

/** What the dialog opens with: the customer's address and name as they stand in the editor now (what was typed, saved or not), not what the report was opened with. */
export const sendPrefill = (values: Pick<EditValues, 'customerEmail' | 'customerName'>): { email: string; name: string } => ({ email: values.customerEmail, name: values.customerName });
