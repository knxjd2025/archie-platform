/**
 * Reading and flipping the V1/V2 switch.
 *
 * Stored in the existing `settings` key/value table, so this needs no
 * migration — the switch has to be something an operator can flip and un-flip
 * on a live system. Per company: it lives in that company's settings.
 *
 * Only the operator named in COMMS_VERSION_OWNER sees it or moves it; with
 * that unset, nobody does and every company stays on V1 (texts and calls
 * through its own GHL).
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { currentCompanyId } from '../tenant/context';
import { settings, phoneNumbers } from '../../shared/schema';
import {
  evaluateReadiness, isCommsVersion, type CommsVersion, type Readiness,
} from '../../shared/comms-version';

const KEY = 'comms.version';

/** Whose switch this is: an Archie operator, never a default person. */
export const COMMS_OWNER = (process.env.COMMS_VERSION_OWNER || '').trim().toLowerCase();

export const isCommsOwner = (email: string | null | undefined): boolean =>
  !!COMMS_OWNER && !!email && email.toLowerCase() === COMMS_OWNER;

export interface VersionState {
  version: CommsVersion;
  setBy: string | null;
  setAt: string | null;
}

/**
 * Cached for a few seconds. Every outbound text and call asks this question,
 * and a database round trip per message to read a two-letter string is not a
 * thing to ship — but the cache has to be short, because the whole value of
 * the switch is that flipping it back takes effect immediately.
 */
const cache = new Map<string, { at: number; state: VersionState }>();
const CACHE_MS = 5000;

export function clearVersionCache(): void { cache.clear(); }

export async function getCommsVersion(): Promise<VersionState> {
  // Per company: one company's switch must never be served to another.
  const key = currentCompanyId() ?? '-';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  let state: VersionState = { version: 'v1', setBy: null, setAt: null };
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
    const v = (row?.value ?? null) as any;
    if (v && isCommsVersion(v.version)) {
      state = { version: v.version, setBy: v.setBy ?? null, setAt: v.setAt ?? null };
    }
  } catch (e) {
    // Never let a settings read decide that texting is off. Unreadable means
    // V1, which is what works today.
    console.error('[comms] could not read the version flag, staying on V1:', e instanceof Error ? e.message : e);
  }
  cache.set(key, { at: Date.now(), state });
  return state;
}

/** Convenience for the send paths. */
export const onV2 = async (): Promise<boolean> => (await getCommsVersion()).version === 'v2';

export async function setCommsVersion(version: CommsVersion, byEmail: string): Promise<VersionState> {
  const state: VersionState = { version, setBy: byEmail, setAt: new Date().toISOString() };
  await db
    .insert(settings)
    .values({ key: KEY, value: state as any })
    .onConflictDoUpdate({ target: [settings.companyId, settings.key], set: { value: state as any, updatedAt: new Date() } });
  clearVersionCache();
  console.warn(`[comms] switched to ${version.toUpperCase()} by ${byEmail}`);
  return state;
}

/** An env flag is on only when it says so. "false"/"0"/"" are all off. */
const truthyEnv = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test((v || '').trim());

/** Is our own stack actually able to do the job yet? */
export async function readiness(): Promise<Readiness> {
  let numbersConfigured = 0;
  let callsTableReady = false;
  try {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(phoneNumbers).where(eq(phoneNumbers.active, true));
    numbersConfigured = rows[0]?.n ?? 0;
    callsTableReady = true; // the query only succeeds if migration 0029 is applied
  } catch {
    callsTableReady = false;
  }

  return evaluateReadiness({
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    numbersConfigured,
    callsTableReady,
    // Carrier registration lives in Twilio, not here; James confirms it once
    // and this records that he did.
    a2pRegistered: truthyEnv(process.env.TWILIO_A2P_READY),
    // Was `!!process.env.…`, which reads the string "false" as ready — the
    // exact opposite of what setting it to false means. Both flags now go
    // through the same parse so they cannot drift apart again.
    voiceAgentConfigured: truthyEnv(process.env.TWILIO_VOICE_AGENT_READY),
  });
}
