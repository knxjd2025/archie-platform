import { Router } from 'express';
import { db } from '../db';
import { messages, conversations, leads, agents } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getTwilioClient } from '../integrations/twilio';
import { toAgentConfig } from '../agents/base-agent';
import { CMOAgent } from '../agents/cmo-agent';
import { sendFailure } from '../lib/failure';
import { claimInboundSms, findLeadByPhone, linkInboundSms } from '../comms/inbound-sms';

const router = Router();

/**
 * Twilio Webhook - Receives incoming SMS
 * POST /api/webhooks/twilio
 */
router.post('/twilio', async (req, res) => {
  try {
    const twilio = getTwilioClient();

    // Reject anything that isn't provably from Twilio — this endpoint feeds
    // ops-brain control commands (DONE/SNOOZE/reassign) keyed off the sender's
    // phone number alone, so an unverified POST is a full spoofing vector.
    const signature = req.header('x-twilio-signature');
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!signature || !twilio.validateWebhookSignature(url, req.body, signature)) {
      return res.status(403).send('Invalid signature');
    }

    const payload = twilio.parseWebhookPayload(req.body);

    // A retried delivery of the same inbound text must not re-run a control
    // command, lead creation, qualification or the welcome text. Recorded in
    // comm_messages keyed by MessageSid before any of that, so the check holds
    // across serverless instances — the old in-memory Set was empty on every
    // cold start, which is exactly when Twilio's retries land.
    const messageId = await claimInboundSms(payload);
    if (messageId === null) {
      return res.type('text/xml').send(twilio.generateTwiML(''));
    }

    console.log('📱 Twilio SMS received:', {
      from: payload.From,
      body: payload.Body?.substring(0, 50),
    });

    // Store the message in database
    const [conversation] = await db
      .insert(conversations)
      .values({
        agentId: 1, // CMO agent handles leads
        title: `SMS from ${payload.From}`,
      })
      .returning();

    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: payload.Body,
    });

    // Check if this is a new lead. Matched on the last ten digits: leads keep
    // the phone as typed ("(704) 555-1234") and Twilio sends +17045551234, so
    // the exact match never hit and every existing customer who texted in
    // became a new "Unknown" lead and got the new-lead welcome text.
    const existingLead = await findLeadByPhone(payload.From);
    if (existingLead) {
      await linkInboundSms(messageId, existingLead);
    } else {
      // New lead - create and qualify
      const [lead] = await db
        .insert(leads)
        .values({
          firstName: 'Unknown',
          phone: payload.From,
          source: 'twilio-sms',
          status: 'new',
        })
        .returning();
      await linkInboundSms(messageId, lead);

      // Get CMO agent to handle — was querying the `leads` table aliased as
      // "agent_placeholder", which is never populated and silently skipped
      // auto-qualification for every new SMS lead.
      const [agentRow] = await db
        .select()
        .from(agents)
        .where(eq(agents.role, 'cmo'))
        .limit(1);

      if (agentRow) {
        const cmo = new CMOAgent(toAgentConfig(agentRow));
        // handleNewLead sends its own qualified/unqualified SMS via GHL and
        // logs it to communicationLog — sending a second text here (as this
        // route previously did, using a `result.response` field that
        // doesn't exist on its return type) double-texted every new lead.
        // handleNewLead's leadData type has no `message` field (it never
        // reads one) — passing payload.Body here was silently dropped.
        const result = await cmo.handleNewLead({
          firstName: lead.firstName ?? undefined,
          phone: lead.phone ?? undefined,
          source: 'twilio-sms',
        });

        if (result.qualified) {
          await db.insert(messages).values({
            conversationId: conversation.id,
            role: 'assistant',
            content: `Lead qualified (score ${result.score}/10) — welcome SMS sent via GHL.`,
          });
        }
      } else {
        console.error('[twilio] no CMO agent row found — new SMS lead was not auto-qualified or welcomed:', lead.id);
      }
    }

    // Return empty TwiML (we handled it)
    res.type('text/xml');
    res.send(twilio.generateTwiML(''));
  } catch (error: any) {
    console.error('Twilio webhook error:', error);
    return sendFailure(res, error, 'POST /api/webhooks/twilio');
  }
});

/**
 * Twilio Status Callback - Tracks message delivery status
 * POST /api/webhooks/twilio/status
 */
router.post('/twilio/status', async (req, res) => {
  try {
    const twilio = getTwilioClient();
    const signature = req.header('x-twilio-signature');
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!signature || !twilio.validateWebhookSignature(url, req.body, signature)) {
      return res.status(403).send('Invalid signature');
    }

    const { MessageSid, MessageStatus, ErrorCode } = req.body;

    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      console.error('[twilio] SMS delivery failed:', { sid: MessageSid, status: MessageStatus, error: ErrorCode });
    } else {
      console.log('📱 Twilio status update:', { sid: MessageSid, status: MessageStatus, error: ErrorCode });
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Twilio status webhook error:', error);
    return sendFailure(res, error, 'POST /api/webhooks/twilio/status');
  }
});

export default router;
