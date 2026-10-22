import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { rateLimit } from '../lib/rate-limit';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import {
  assistConfigured, WRITING_MODEL,
  draftReply, fromInstruction, polish, adjustTone, rateEmailSecurity, classifyLead,
} from './assist-service';
import { sendFailure } from '../lib/failure';

const assistLimiter = rateLimit(60, 10 * 60 * 1000);

// Best-effort: pull the recent message thread for a GHL contact, as plain text.
async function recentThreadText(contactId?: string): Promise<string> {
  if (!contactId) return '';
  try {
    const ghl = new GoHighLevelClient();
    const convs: any = await ghl.getConversations(contactId);
    const convId = convs?.conversations?.[0]?.id;
    if (!convId) return '';
    const msgs: any = await ghl.getMessages(convId);
    const list = (msgs?.messages || []).slice(-10);
    return list
      .map((m: any) => {
        const who = (m.direction || '').toLowerCase() === 'outbound' ? 'Us' : 'Them';
        const body = m.body || m.message || '';
        return body ? `${who}: ${body}` : '';
      })
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

export function registerAssistRoutes(app: Express) {
  app.get('/api/assist/status', requireAuth, (_req: Request, res: Response) => {
    res.json({ configured: assistConfigured(), model: WRITING_MODEL });
  });

  // Draft / instruct / polish / tone. Returns { text } or { error }.
  app.post('/api/assist/message', requireAuth, assistLimiter, async (req: Request, res: Response) => {
    const b = req.body || {};
    const mode = String(b.mode || '');
    const channel = String(b.channel || 'sms');
    const contactName = String(b.contactName || '').trim();

    try {
      let result;
      if (mode === 'draft') {
        result = await draftReply({ contactName, channel, recentMessages: await recentThreadText(b.contactId) });
      } else if (mode === 'instruction') {
        const instruction = String(b.instruction || '').trim();
        if (!instruction) return res.status(400).json({ error: 'instruction is required' });
        result = await fromInstruction({ contactName, channel, instruction, recentMessages: await recentThreadText(b.contactId) });
      } else if (mode === 'polish') {
        const text = String(b.text || '').trim();
        if (!text) return res.status(400).json({ error: 'text is required' });
        result = await polish({ text, channel });
      } else if (mode === 'tone') {
        const text = String(b.text || '').trim();
        if (!text) return res.status(400).json({ error: 'text is required' });
        result = await adjustTone({ text, tone: String(b.tone || ''), channel });
      } else {
        return res.status(400).json({ error: 'mode must be draft | instruction | polish | tone' });
      }

      if ('error' in result) return res.status(result.error.includes('not configured') ? 503 : 502).json(result);
      res.json(result);
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/assist/message', 500, 'assist failed');
    }
  });

  // Screen an email for a potential new customer lead.
  // Returns { isLead, confidence, name, service, summary } or { error }.
  app.post('/api/assist/lead-check', requireAuth, assistLimiter, asyncHandler(async (req: Request, res: Response) => {
    const b = req.body || {};
    const result = await classifyLead({
      from: String(b.from || ''),
      subject: String(b.subject || ''),
      body: String(b.body || ''),
    });
    if ('error' in result) return res.status(result.error.includes('not configured') ? 503 : 502).json(result);
    res.json(result);
  }));

  // Rate an email's security risk (defensive). Returns { risk, score, reasons } or { error }.
  app.post('/api/assist/email-security', requireAuth, assistLimiter, asyncHandler(async (req: Request, res: Response) => {
    const b = req.body || {};
    const result = await rateEmailSecurity({
      from: String(b.from || ''),
      subject: String(b.subject || ''),
      body: String(b.body || ''),
    });
    if ('error' in result) return res.status(result.error.includes('not configured') ? 503 : 502).json(result);
    res.json(result);
  }));
}
