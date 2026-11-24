/**
 * The customer link controls, as plain functions with no screen: what is drawn
 * after each click, and the two actions behind the buttons. The screen only
 * draws this and carries it out. A click is answered in the frame it was made
 * in (Making the link..., Turning the link off...); every state clears on
 * success or failure.
 */
import { RR, plainMessage } from './words';

export type SharePhase = 'idle' | 'making' | 'copied' | 'manual' | 'turningOff' | 'off';

export interface ShareState {
  /** A link is on (the server said so, or one was just made). */
  on: boolean;
  phase: SharePhase;
  /** The address, held only while it is being shown or was just copied. */
  url: string | null;
  error: string | null;
}

export const initialShare = (on: boolean): ShareState => ({ on, phase: 'idle', url: null, error: null });

export type ShareAction =
  | { type: 'reset'; on: boolean }
  | { type: 'making' }
  | { type: 'copied'; url: string }
  | { type: 'manual'; url: string }
  | { type: 'failed'; error: string }
  | { type: 'turningOff' }
  | { type: 'off' }
  | { type: 'offFailed'; error: string };

export function shareReducer(state: ShareState, a: ShareAction): ShareState {
  switch (a.type) {
    case 'reset': return initialShare(a.on);
    case 'making': return { ...state, phase: 'making', error: null };
    case 'copied': return { on: true, phase: 'copied', url: a.url, error: null };
    case 'manual': return { on: true, phase: 'manual', url: a.url, error: null };
    case 'failed': return { ...state, phase: 'idle', error: a.error };
    case 'turningOff': return { ...state, phase: 'turningOff', error: null };
    case 'off': return { on: false, phase: 'off', url: null, error: null };
    case 'offFailed': return { ...state, phase: 'idle', url: null, error: a.error };
  }
}

/** The address a link has: this app's own share address, 64 hex characters, and when an origin is given, on it. */
function isShareAddress(url: unknown, origin?: string): url is string {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+\/r\/roof\/[0-9a-f]{64}$/.test(url)) return false;
  return origin === undefined || url.startsWith(`${origin.replace(/\/+$/, '')}/`);
}

/**
 * Makes the link (or gets the one there is) and copies it. If the browser will
 * not copy, the link is handed back to be shown and copied by hand. An answer
 * that is not a share address is never shown or copied.
 */
export async function copyLink(deps: { create: () => Promise<{ url: unknown }>; write: (text: string) => Promise<void>; origin?: string }): Promise<ShareAction> {
  let url: unknown;
  try {
    url = (await deps.create()).url;
  } catch (e) {
    return { type: 'failed', error: plainMessage(e, RR.share.makeFailed) };
  }
  if (!isShareAddress(url, deps.origin)) return { type: 'failed', error: RR.share.makeFailed };
  try {
    await deps.write(url);
    return { type: 'copied', url };
  } catch {
    return { type: 'manual', url };
  }
}

/** Turns the link off. */
export async function turnLinkOff(deps: { revoke: () => Promise<unknown> }): Promise<ShareAction> {
  try {
    await deps.revoke();
    return { type: 'off' };
  } catch (e) {
    return { type: 'offFailed', error: plainMessage(e, RR.share.offFailed) };
  }
}
