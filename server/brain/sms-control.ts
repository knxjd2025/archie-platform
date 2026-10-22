import { db } from '../db';
import { openLoops } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { TEAM, type Person, type BrainEvent } from './types';
import { getConversationContactId, sendGhlSms } from './ghl-brain';
import { getCursor, setCursor } from './cursor-store';

export type ControlCommand =
  | { action: 'done'; loopId: number }
  | { action: 'snooze'; loopId: number; days: number }
  | { action: 'reassign'; loopId: number; target: Person };

export function parseControlCommand(body: string): ControlCommand | null {
  const t = body.trim().toLowerCase();
  let m = t.match(/^done\s+(\d+)/);
  if (m) return { action: 'done', loopId: Number(m[1]) };
  m = t.match(/^snooze\s+(\d+)(?:\s+(\d+)d)?/);
  if (m) return { action: 'snooze', loopId: Number(m[1]), days: m[2] ? Number(m[2]) : 1 };
  m = t.match(/^(?:assign\s+)?(\d+)\s*(?:->|to)?\s*(james|thomas|banning|admin)$/) ?? t.match(/^assign\s+(\d+)\s+(james|thomas|banning|admin)/);
  if (m) return { action: 'reassign', loopId: Number(m[1]), target: m[2] as Person };
  return null;
}

export async function applyControlCommand(fromPhone: string, body: string): Promise<string | null> {
  const cmd = parseControlCommand(body);
  if (!cmd) return null;
  const sender = (Object.entries(TEAM).find(([, v]) => v.phone && fromPhone.endsWith(v.phone.slice(-10))) ?? [])[0];
  if (!sender) return null; // not a team member — never act on outsider commands
  // .returning() so a nonexistent loop id gets an honest "not found" reply
  // instead of a false-positive confirmation for a command that did nothing.
  if (cmd.action === 'done') {
    const [row] = await db.update(openLoops).set({ state: 'done', closedAt: new Date(), closedBy: `sms:${sender}` }).where(eq(openLoops.id, cmd.loopId)).returning({ id: openLoops.id });
    return row ? `Loop ${cmd.loopId} marked done. 👍` : `Loop ${cmd.loopId} not found.`;
  }
  if (cmd.action === 'snooze') {
    const [row] = await db.update(openLoops).set({ state: 'snoozed', snoozeUntil: new Date(Date.now() + cmd.days * 86_400_000) }).where(eq(openLoops.id, cmd.loopId)).returning({ id: openLoops.id });
    return row ? `Loop ${cmd.loopId} snoozed ${cmd.days}d.` : `Loop ${cmd.loopId} not found.`;
  }
  const [row] = await db.update(openLoops).set({ owner: cmd.target, state: 'open' }).where(eq(openLoops.id, cmd.loopId)).returning({ id: openLoops.id });
  return row ? `Loop ${cmd.loopId} reassigned to ${cmd.target}.` : `Loop ${cmd.loopId} not found.`;
}

const digitsOnly = (p: string) => p.replace(/\D/g, '');

/**
 * True when a GHL event is an inbound text from a team member's cell that parses as
 * a control command. The control channel rides the normal GHL ingest: team nudges go
 * out from the business number, so a "DONE 12" reply arrives as a plain inbound GHL
 * conversation message. These must be intercepted BEFORE triage — a control command
 * is an instruction to the brain, not a lead to open a loop for.
 */
export function isTeamControlEvent(
  ev: Pick<BrainEvent, 'source' | 'direction' | 'contact' | 'text'>,
): boolean {
  if (ev.source !== 'ghl' || ev.direction !== 'inbound') return false;
  const from = digitsOnly(ev.contact?.phone ?? '');
  if (!from) return false;
  const isTeam = Object.values(TEAM).some(
    (v) => v.phone && from.endsWith(digitsOnly(v.phone).slice(-10)),
  );
  return isTeam && parseControlCommand(ev.text) !== null;
}

/**
 * Control commands already applied, per team conversation: the last-message
 * time of the newest one handled. The GHL cursor is saved at the end of the
 * sweep, after triage — a sweep killed in between read the same "SNOOZE 12 2d"
 * again next hour, pushed the snooze out another two days and texted the
 * confirmation again. A GHL event is a conversation's latest message, so one
 * time per conversation is enough to tell an old command from a new one.
 */
const CONTROL_MARK_SOURCE = 'ghl-control';

function controlEventTime(ev: BrainEvent): number | null {
  const t = Date.parse(ev.occurredAt);
  return Number.isNaN(t) ? null : t;
}

async function alreadyHandled(ev: BrainEvent): Promise<boolean> {
  const t = controlEventTime(ev);
  if (t === null) return false;
  const mark = await getCursor(CONTROL_MARK_SOURCE, ev.sourceRef);
  return mark !== null && Number(mark) >= t;
}

/**
 * Split control commands out of an ingest batch, apply them, and text back a
 * confirmation on the same conversation. Returns the events that should continue
 * to triage. Confirmations are internal (to the commanding team member) and fire
 * even during BRAIN_DRY_RUN — same deliberate exception as the digest email; all
 * customer-facing sends stay dry-run-gated in actor.ts.
 */
export async function processControlEvents(
  events: BrainEvent[],
): Promise<{ remaining: BrainEvent[]; handled: number; replayed: number }> {
  const remaining: BrainEvent[] = [];
  let handled = 0;
  let replayed = 0;
  for (const ev of events) {
    if (!isTeamControlEvent(ev)) {
      remaining.push(ev);
      continue;
    }
    if (await alreadyHandled(ev)) {
      replayed++;
      continue;
    }
    const reply = await applyControlCommand(ev.contact!.phone!, ev.text);
    handled++;
    // Marked as soon as it is applied, before the confirmation text — the
    // send is the slow part, and a kill after it must not re-apply the command.
    const t = controlEventTime(ev);
    if (t !== null) await setCursor(CONTROL_MARK_SOURCE, ev.sourceRef, String(t));
    if (reply) {
      const contactId = await getConversationContactId(ev.sourceRef);
      if (contactId) {
        try {
          await sendGhlSms(contactId, reply);
        } catch (e: any) {
          // confirmation is best-effort — the command itself already applied
          console.error('[sms-control] confirmation send failed:', e?.message || e);
        }
      }
    }
  }
  return { remaining, handled, replayed };
}
