export type Person = 'james' | 'thomas' | 'banning' | 'admin' | 'unassigned';
export type Urgency = 'emergency' | 'urgent' | 'normal' | 'low';
export type LoopSource = 'gmail' | 'ghl' | 'jobtread' | 'calendar' | 'sms' | 'manual';

export interface BrainEvent {
  source: Exclude<LoopSource, 'manual'>;
  sourceRef: string;          // gmail threadId | ghl conversationId | jobtread docId | calendar eventId | twilio MessageSid
  mailbox?: string;           // which of the 4 mailboxes (gmail only)
  occurredAt: string;         // ISO
  direction?: 'inbound' | 'outbound';
  contact?: { name?: string; phone?: string; email?: string };
  text: string;               // normalized human-readable content for triage
  raw?: unknown;
}

export const TEAM: Record<Exclude<Person, 'unassigned'>, { email: string; phone: string }> = {
  james: { email: 'james@bestroofingnow.com', phone: process.env.JAMES_PHONE || '' },
  thomas: { email: 'thomas@bestroofingnow.com', phone: process.env.THOMAS_PHONE || '' },
  banning: { email: 'banning@bestroofingnow.com', phone: process.env.BANNING_PHONE || '' },
  admin: { email: 'admin@bestroofingnow.com', phone: process.env.ADMIN_PHONE || '' },
};
