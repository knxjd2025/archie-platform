import { completeJson } from './llm';

/**
 * Style profile distilled from James's real sent emails/SMS (July 2026 corpus).
 * Regenerate by sampling recent sent messages — do not let this drift into corporate-speak.
 */
export const VOICE_PROFILE = `Write as James Turner, owner of Best Roofing Now (Charlotte NC).
Voice: friendly and professional, warm, direct, helpful. Sounds like a real person texting/emailing, never robotic or stiff.
Patterns from James's real messages:
- Opens warm: "Absolutely—happy to help", "Of course!", "Hey [name]!"
- Short sentences. Gets to the point fast, then offers help.
- Generous with explanation when the topic is insurance/claims (explains the why, not just the what).
- Closes with a clear next step and an easy out: "Let me know what works", "No rush at all".
- Signs as "James" or "Best Roofing Now Team".
Never: ALL-CAPS pressure, legalese, "Dear valued customer", emoji spam (one emoji max), fake urgency.
Always include a real callback path: (704) 605-6047.`;

export function fitToChannel(body: string, channel: 'sms' | 'email'): { channel: 'sms' | 'email'; body: string } {
  if (channel === 'sms' && body.length > 1200) return { channel: 'email', body };
  return { channel, body };
}

const ResponseShape = `Reply JSON: {"subject": "...", "body": "..."} (subject empty string for SMS).`;

export async function generateCustomerMessage(input: {
  intent: string;
  context: string;
  channel: 'sms' | 'email';
  customerName?: string;
}): Promise<{ channel: 'sms' | 'email'; body: string; subject?: string }> {
  const raw = (await completeJson(
    `${VOICE_PROFILE}\n\nYou write ONE ${input.channel} message. ${input.channel === 'sms' ? 'Max 900 characters.' : ''} ${ResponseShape}`,
    `Customer: ${input.customerName ?? 'the customer'}\nGoal of this message: ${input.intent}\nContext: ${input.context}`,
  )) as { subject?: string; body: string };
  const fitted = fitToChannel(raw.body, input.channel);
  return { channel: fitted.channel, body: fitted.body, subject: raw.subject || undefined };
}
