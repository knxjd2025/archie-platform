import type { Express, Request, Response } from 'express';
import { registerAuthRoutes } from './auth/routes';
import { registerGoogleRoutes } from './integrations/google-routes';
import { registerAssignmentRoutes } from './access/assignment-routes';
import { registerTeamRoutes } from './auth/team-routes';
import { registerSyncRoutes } from './sync/routes';
import { registerArchieRoutes, MAX_MESSAGE_CHARS } from './agents/archie-routes';
import { registerConversationRoutes } from './conversations/routes';
import { registerProductionRoutes } from './production/routes';
import { registerClaimsRoutes } from './claims/routes';
import { registerSalesRoutes } from './sales/routes';
import { registerDocumentRoutes } from './documents/routes';
import { registerAccountRoutes } from './account/routes';
import { registerWriteRoutes } from './writes/routes';
import { registerClientAccountRoutes } from './client-account/routes';
import { registerJobtreadArchiveRoutes } from './jobtread-archive/routes';
import { registerContactActionRoutes } from './contact-actions/routes';
import { registerAssistRoutes } from './ai/routes';
import { registerDashboardRoutes } from './dashboard/routes';
import { registerFollowUpRoutes } from './followups/routes';
import { registerRoofReportRoutes } from './reports/routes';
import { registerPhotoRoutes } from './photos/routes';
import { registerCanvassRoutes } from './canvass/routes';
import { registerTracerfyRoutes } from './canvass/tracerfy-routes';
import { registerRepReminderRoutes } from './canvass/reminder-routes';
import { registerInboxRoutes } from './inbox/routes';
import { registerCompanyCamRoutes } from './companycam/routes';
import { registerKpiRoutes } from './kpis/routes';
import { registerCommissionRoutes } from './commission/routes';
import { registerInspectionRoutes } from './inspections/routes';
import { registerPreConstructionRoutes } from './preconstruction/routes';
import { registerFinalWalkthroughRoutes } from './final-walkthrough/routes';
import { registerJobCommissionRoutes } from './job-commissions/routes';
import { registerNeighborLetterRoutes } from './neighbor-letters/routes';
import { registerInsuranceLetterRoutes } from './insurance-letters/routes';
import { registerCertificateRoutes } from './certificates/routes';
import { registerSignatureRoutes } from './signatures/routes';
import { registerMeetingRoutes } from './meetings/routes';
import { registerPlaybookRoutes } from './playbook/routes';
import { registerBoardRoutes } from './calendar/board-routes';
import { registerBugRoutes } from './bugs/routes';
import { getOrCreateChat, saveTurn, todaysMessages } from './agents/chat-store';
import { requireAuth, requireRole } from './auth/middleware';
import { timingSafeEqualStr } from './security-config';
import { rateLimit } from './lib/rate-limit';
import { repLeadWhere, ownsLead } from './access/rep-scope';
import { canUseAdvisor } from '../shared/advisors';
import { canSeeMoney } from '../shared/rbac';
import { buildAgentViewer } from './agents/viewer';
import { logWrite } from './writes/log';
import { db } from './db';
import { agents, leads, dailyMetrics, agentDecisions, settings, teamMembers, repAssignments, deals } from '../shared/schema';
import { eq, desc, sql, and, or, isNotNull } from 'drizzle-orm';
import { createAgent, toAgentConfig } from './agents/base-agent';
import { CMOAgent } from './agents/cmo-agent';
import { CEOAgent } from './agents/ceo-agent';
import { GoHighLevelClient } from './integrations/gohighlevel';
import { JobTreadClient } from './integrations/jobtread';
import { getGmailClient } from './integrations/gmail';
import knowledgeRouter from './routes/knowledge';
import financialRouter from './routes/financial';
import twilioRouter from './routes/twilio';

import { getTwilioClient } from './integrations/twilio';
import { sendUpstreamFailure } from './lib/upstream';
import { sendFailure } from './lib/failure';
import { registerCommsRoutes } from './comms/routes';
import { blockDisabledJobs } from './tenant/cron';
import { verifyGhlWebhookSecret } from './integrations/ghl/webhook-secret';
import { registerGhlConnectionRoutes } from './integrations/ghl/routes';
import { currentGhlLocationId, ghlAppBase } from './integrations/ghl/connection';
import { getCompanyByGhlLocation } from './tenant/companies';
import { runAsCompany } from './tenant/context';

// A few of these `?limit=` query params were forwarded straight to the
// JobTread/GHL client with only an `|| default` fallback and no upper bound
// (unlike /api/leads, which already clamps to 1000) — a caller could ask for
// an unbounded page size. Small shared clamp so every call site gets the
// same ceiling.
function clampLimit(raw: unknown, def: number, max = 100): number {
  const n = parseInt(raw as string, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : def, 1), max);
}

// Loose on purpose — just enough to catch garbage before it's forwarded to
// an SMS provider (mirrors the same pattern in writes/routes.ts).
const PHONE_RE = /^[\d\s()+.-]{7,20}$/;
const smsLimiter = rateLimit(30, 10 * 60 * 1000);
// Every advisor message is a paid LLM call with tools behind it — the same
// ceiling the assist routes use.
const agentChatLimiter = rateLimit(60, 10 * 60 * 1000);

export function registerRoutes(app: Express) {
  // ==================== NAMESPACE AUTH GUARDS ====================
  // Auth in this app is declared per route, which fails silently: a route added
  // without requireAuth is public, and nothing catches it. That is exactly what
  // happened — the whole /api/integrations and /api/financial surface shipped
  // unauthenticated, exposing customer names, emails, addresses, job values and
  // payroll to anyone on the internet.
  //
  // These prefix guards run BEFORE the route handlers below and cover every
  // path in the namespace, including routes added later. Individual routes keep
  // their own requireAuth/requireRole for role checks and defense in depth.
  //
  // Deliberately NOT guarded here: /api/webhooks (Twilio signature),
  // /api/cron (CRON_SECRET), /r/:token (public
  // report share links), and /api/auth/* (sign-in itself).
  app.use('/api/integrations', requireAuth);
  // Company financials, payroll, and live bank-account data — individual pay
  // stubs and bank transactions are admin-only per shared/rbac.ts (ap/payroll
  // both require 'admin'); a Sales Leader has no business reading either (was
  // requireRole('manager'), letting any manager read every employee's pay
  // stub and the company's live bank transactions).
  app.use('/api/financial', requireAuth, requireRole('admin'));
  app.use('/api/knowledge', requireAuth);

  // Jobs from the Best Roofing AI app that Archie does not run (server/tenant/cron.ts).
  blockDisabledJobs(app);

  // First, so every route registered after it reports its failures to the bug log.
  registerBugRoutes(app);
  registerAuthRoutes(app);
  registerGoogleRoutes(app);
  registerAssignmentRoutes(app);
  registerTeamRoutes(app);
  registerSyncRoutes(app);
  registerArchieRoutes(app);
  registerConversationRoutes(app);
  registerProductionRoutes(app);
  registerClaimsRoutes(app);
  registerSalesRoutes(app);
  registerDocumentRoutes(app);
  registerAccountRoutes(app);
  registerWriteRoutes(app);
  registerClientAccountRoutes(app);
  registerJobtreadArchiveRoutes(app);
  registerContactActionRoutes(app);
  registerAssistRoutes(app);
  registerDashboardRoutes(app);
  registerFollowUpRoutes(app);
  registerRoofReportRoutes(app);
  registerPhotoRoutes(app);
  registerCanvassRoutes(app);
  registerTracerfyRoutes(app);
  registerRepReminderRoutes(app);
  registerInboxRoutes(app);
  registerCompanyCamRoutes(app);
  registerKpiRoutes(app);
  registerCommissionRoutes(app);
  registerInspectionRoutes(app);
  registerPreConstructionRoutes(app);
  registerFinalWalkthroughRoutes(app);
  registerJobCommissionRoutes(app);
  registerNeighborLetterRoutes(app);
  registerGhlConnectionRoutes(app);
  registerInsuranceLetterRoutes(app);
  registerCertificateRoutes(app);
  registerSignatureRoutes(app);
  registerMeetingRoutes(app);
  registerPlaybookRoutes(app);
  registerBoardRoutes(app);

  // ==================== CALLS & MESSAGES (our own, not a provider's) ====
  registerCommsRoutes(app);

  // ==================== KNOWLEDGE BASE (RAG) ====================
  app.use('/api/knowledge', knowledgeRouter);

  // ==================== TWILIO SMS ====================
  app.use('/api/webhooks', twilioRouter);

  // ==================== FINANCIAL INTEGRATIONS ====================
  app.use('/api/financial', financialRouter);
  // Also mount QBO OAuth at top level for clean redirect URI
  app.get('/api/auth/quickbooks', (req, res) => res.redirect('/api/financial/quickbooks/auth'));
  app.get('/api/auth/quickbooks/callback', (req, res) => {
    // Forward to financial router with full URL for token exchange
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    res.redirect(`/api/financial/quickbooks/callback?${new URL(fullUrl).searchParams.toString()}`);
  });

  // ==================== HEALTH CHECK ====================

  /**
   * The check an uptime monitor can actually use.
   *
   * This used to be the integration fan-out below, behind `requireAuth` — so
   * no monitor could call it, and each call made seven live third-party
   * requests with no timeout. One hung provider hung the request, and on
   * Vercel that burns a 300-second function budget doing nothing.
   *
   * What a monitor needs is: is the process up, and can it reach its database.
   * That is all this answers, and it deliberately says nothing about which
   * integrations exist or which keys are configured — an earlier version of
   * /api/ping leaked exactly that to anyone who asked.
   */
  app.get('/api/health', async (_req: Request, res: Response) => {
    const started = Date.now();
    let database: 'ok' | 'unreachable' = 'unreachable';
    try {
      // Bounded, because "the database is slow" and "the database is down"
      // must not look the same to a monitor — or take 30 seconds to tell apart.
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      database = 'ok';
    } catch (e) {
      console.error('[health] database unreachable:', e instanceof Error ? e.message : e);
    }
    const ok = database === 'ok';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      database,
      ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * The integration estate: which third parties are wired up and answering.
   * Admin-only, because the list of what this company runs on is not something
   * to hand out, and each call costs seven outbound requests.
   *
   * `allSettled` rather than `all`: one provider being down should report that
   * provider as down, not collapse the whole report into a 500. Each check is
   * also individually time-boxed, so a hung provider costs 5 seconds, not the
   * request.
   */
  /**
   * What our Twilio account holds — numbers and how far the A2P registration
   * has got. Admin only, read-only, and it answers the one question that
   * decides the pace of the whole phone migration: is carrier registration
   * done, in flight, or not started?
   */
  app.get('/api/health/twilio', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const client = getTwilioClient();
      const shape = client.credentialShape();
      const inv = await client.inventory();
      const brand = inv.a2p.brands[0]?.status ?? null;
      const campaign = inv.a2p.campaigns.find((c) => c.status)?.status ?? null;
      res.json({
        ...inv,
        credentials: shape,
        // A one-line answer, so nobody has to interpret the raw shapes above.
        // Every call coming back 401 is a credentials problem, not an empty
        // account, and saying "no phone numbers" there sends someone hunting
        // for numbers that are sitting right where they left them.
        verdict: shape.problems.length || shape.whitespace.length
          ? [...shape.problems, ...shape.whitespace].join(' ')
          : inv.notes.filter((n) => n.includes('401')).length >= 2
          ? 'Both values are the right shape, but Twilio rejects them on every call — so they are valid-looking values from different accounts, or the Auth Token has been rotated since it was copied. Open the Console on the account that owns the numbers and copy both from that page.'
          : !inv.numbers.length
          ? `No phone numbers on this account${inv.subaccounts.length ? ` or its ${inv.subaccounts.length} subaccount(s)` : ''} — check the credentials point at the right Twilio account.`
          : !brand
          ? `${inv.numbers.length} number(s), but no A2P brand registered — start that first, it takes 1-3 weeks.`
          : /approved|verified|registered/i.test(brand) && campaign && /approved|verified|active/i.test(campaign)
            ? 'A2P brand and campaign are approved — texting can go live.'
            : /fail/i.test(brand)
              ? `A2P brand failed: ${inv.a2p.brands[0]?.failureReason || 'reason not given'}`
              : `A2P in progress — brand ${brand}${campaign ? `, campaign ${campaign}` : ', no campaign yet'}.`,
      });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Twilio', 'GET /api/health/twilio');
    }
  });

  app.get('/api/health/integrations', requireRole('admin'), async (_req: Request, res: Response) => {
    const ghl = new GoHighLevelClient();
    const jobtread = new JobTreadClient();
    const gmail = getGmailClient();
    const twilio = getTwilioClient();

    // Import financial integration clients
    const { getQuickBooksClient } = await import('./integrations/quickbooks');
    const { getPlaidClient } = await import('./integrations/plaid-client');
    const { getEvereeClient } = await import('./integrations/everee');

    const boxed = async (name: string, run: () => Promise<any>) => {
      const started = Date.now();
      try {
        const result = await Promise.race([
          run(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 5s')), 5000)),
        ]);
        return { name, ok: true, ms: Date.now() - started, result };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.warn(`[health] ${name}: ${detail}`);
        return { name, ok: false, ms: Date.now() - started, error: detail };
      }
    };

    const checks = await Promise.allSettled([
      boxed('gohighlevel', () => ghl.healthCheck()),
      boxed('jobtread', () => jobtread.healthCheck()),
      boxed('gmail', () => gmail.healthCheck()),
      boxed('twilio', () => twilio.healthCheck()),
      boxed('quickbooks', () => getQuickBooksClient().healthCheck()),
      boxed('plaid', () => getPlaidClient().healthCheck()),
      boxed('everee', () => getEvereeClient().healthCheck()),
    ]);

    const integrations: Record<string, unknown> = {};
    for (const c of checks) {
      if (c.status !== 'fulfilled') continue;
      const { name, ...rest } = c.value;
      integrations[name] = rest;
    }

    const down = Object.entries(integrations).filter(([, v]) => !(v as any).ok).map(([k]) => k);
    res.json({
      status: down.length ? 'degraded' : 'ok',
      down,
      timestamp: new Date().toISOString(),
      integrations,
    });
  });

  // ==================== INTEGRATION DATA ENDPOINTS ====================
  // Admin only. These read straight from GHL, JobTread and Twilio with no
  // per-rep filter, so the namespace's requireAuth alone let any signed-in rep
  // pull every company contact, invoice and outstanding balance, read the
  // Twilio message history, and text any number from the company line. The
  // only screen that calls them is Integrations, which is admin-only
  // (canSeePage in client/src/App.tsx). google/* and companycam/status are
  // registered elsewhere, are the caller's own data, and stay open.

  // Get contacts from GoHighLevel
  app.get('/api/integrations/ghl/contacts', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const limit = clampLimit(req.query.limit, 10);
      const result = await ghl.getContacts({ limit });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/contacts');
    }
  });

  // Get contacts from JobTread
  app.get('/api/integrations/jobtread/contacts', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const jobtread = new JobTreadClient();
      const limit = clampLimit(req.query.limit, 10);
      const result = await jobtread.getContacts({ limit });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'JobTread', 'GET /api/integrations/jobtread/contacts');
    }
  });

  // Get jobs from JobTread
  app.get('/api/integrations/jobtread/jobs', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const jobtread = new JobTreadClient();
      const limit = clampLimit(req.query.limit, 10);
      const result = await jobtread.getJobs({ limit });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'JobTread', 'GET /api/integrations/jobtread/jobs');
    }
  });

  // Get invoices from JobTread
  app.get('/api/integrations/jobtread/invoices', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const jobtread = new JobTreadClient();
      const limit = clampLimit(req.query.limit, 10);
      const result = await jobtread.getInvoices({ limit });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'JobTread', 'GET /api/integrations/jobtread/invoices');
    }
  });

  // Get a single job with full details from JobTread
  app.get('/api/integrations/jobtread/jobs/:jobId', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const jobtread = new JobTreadClient();
      const result = await jobtread.getJob(req.params.jobId);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'JobTread', 'GET /api/integrations/jobtread/jobs/:jobId');
    }
  });

  // There is no `estimates` or `tasks` field at the root of JobTread's schema —
  // estimates are documents, and tasks hang off a job or an organization. Two
  // routes here queried them as root fields, so both answered
  // `The field "estimates" does not exist at the query root` to every request
  // ever made to them. Nothing in the app called either one. Rather than invent
  // a replacement nobody asked for, they are removed; JobTread's real shapes
  // are there to build on if a screen ever needs them.

  // Get outstanding invoices summary from JobTread
  app.get('/api/integrations/jobtread/invoices/outstanding', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const jobtread = new JobTreadClient();
      const result = await jobtread.getOutstandingInvoices();
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'JobTread', 'GET /api/integrations/jobtread/invoices/outstanding');
    }
  });

  // Get opportunities from GoHighLevel
  app.get('/api/integrations/ghl/opportunities', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const limit = clampLimit(req.query.limit, 10);
      const result = await ghl.getOpportunities({ limit });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/opportunities');
    }
  });

  // Get conversations from GoHighLevel
  app.get('/api/integrations/ghl/conversations', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const contactId = req.query.contactId as string | undefined;
      const result = await ghl.getConversations(contactId);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/conversations');
    }
  });

  // Get messages for a conversation from GoHighLevel
  app.get('/api/integrations/ghl/conversations/:conversationId/messages', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const result = await ghl.getMessages(req.params.conversationId);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/conversations/:conversationId/messages');
    }
  });

  // Get calendars from GoHighLevel
  app.get('/api/integrations/ghl/calendars', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const result = await ghl.getCalendars();
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/calendars');
    }
  });

  // Get appointments from GoHighLevel
  app.get('/api/integrations/ghl/appointments', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const calendarId = req.query.calendarId as string;
      const startTime = req.query.startTime as string || new Date().toISOString();
      const endTime = req.query.endTime as string || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      if (!calendarId) {
        return res.status(400).json({ error: 'calendarId is required' });
      }

      const result = await ghl.getAppointments({ calendarId, startTime, endTime });
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/appointments');
    }
  });

  // Send SMS via GoHighLevel
  app.post('/api/integrations/ghl/sms', requireRole('admin'), smsLimiter, async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const { phone, message, contactId } = req.body;

      if (!phone || !message) {
        return res.status(400).json({ error: 'phone and message are required' });
      }
      if (!PHONE_RE.test(String(phone))) return res.status(400).json({ error: 'That phone number doesn\'t look right.' });
      if (String(message).length > 1600) return res.status(400).json({ error: 'Message is too long.' });

      const result = await ghl.sendSms(phone, message, contactId);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'POST /api/integrations/ghl/sms');
    }
  });

  // Get a single contact from GoHighLevel
  app.get('/api/integrations/ghl/contacts/:contactId', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const ghl = new GoHighLevelClient();
      const result = await ghl.getContact(req.params.contactId);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'GoHighLevel', 'GET /api/integrations/ghl/contacts/:contactId');
    }
  });


  // ==================== TWILIO SMS API ====================

  // Check Twilio status
  app.get('/api/integrations/twilio/status', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const twilio = getTwilioClient();
      const status = await twilio.healthCheck();
      res.json(status);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'Twilio', 'GET /api/integrations/twilio/status');
    }
  });

  // Send SMS via Twilio
  app.post('/api/integrations/twilio/sms', requireRole('admin'), smsLimiter, async (req: Request, res: Response) => {
    try {
      const twilio = getTwilioClient();
      const { to, body, mediaUrl } = req.body;

      if (!to || !body) {
        return res.status(400).json({ error: 'to and body are required' });
      }
      if (!PHONE_RE.test(String(to))) return res.status(400).json({ error: 'That phone number doesn\'t look right.' });
      if (String(body).length > 1600) return res.status(400).json({ error: 'Message is too long.' });

      const result = await twilio.sendSms(to, body, mediaUrl);
      res.json(result);
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'Twilio', 'POST /api/integrations/twilio/sms');
    }
  });

  // List recent Twilio messages
  app.get('/api/integrations/twilio/messages', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const twilio = getTwilioClient();
      const limit = clampLimit(req.query.limit, 20);
      const messages = await twilio.listMessages(limit);
      res.json({ messages });
    } catch (error: any) {
      return sendUpstreamFailure(res, error, 'Twilio', 'GET /api/integrations/twilio/messages');
    }
  });

  // ==================== AGENTS ====================

  // Get all agents
  // Only the advisors this person's role is allowed to use (sales reps get the
  // sales coach + production coordinator; finance/legal/exec are manager+/admin).
  app.get('/api/agents', requireAuth, async (req: Request, res: Response) => {
    try {
      const role = req.session.user!.role;
      const agentList = await db.select().from(agents).orderBy(agents.id);
      res.json(agentList.filter((a) => canUseAdvisor(role, String(a.role))));
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/agents');
    }
  });

  // Get agents reporting to a given executive (team members)
  app.get('/api/agents/:role/team', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const [manager] = await db
        .select()
        .from(agents)
        .where(eq(agents.role, req.params.role as any));

      if (!manager) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const team = await db
        .select()
        .from(agents)
        .where(eq(agents.reportsTo, manager.id));

      res.json({
        manager: { id: manager.id, name: manager.name, role: manager.role, title: manager.title },
        employees: team,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/agents/:role/team');
    }
  });

  // Get agent by role
  app.get('/api/agents/:role', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.role, req.params.role as any));

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json(agent);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/agents/:role');
    }
  });

  // Chat with an agent
  app.post('/api/agents/:role/chat', requireAuth, agentChatLimiter, async (req: Request, res: Response) => {
    try {
      const { message } = (req.body ?? {}) as { message?: unknown };

      // Only `!message` was checked, so an object or array went straight into
      // the LLM call and the chat store, and a pasted document of any size
      // was sent — and paid for — in full. Same rule as Archie's chat.
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }
      if (message.length > MAX_MESSAGE_CHARS) {
        return res.status(400).json({ error: `Message is too long — keep it under ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` });
      }

      // Role gate: a sales rep can only reach the sales coach + production
      // coordinator; finance/legal/exec advisors are manager+/admin.
      if (!canUseAdvisor(req.session.user!.role, req.params.role)) {
        return res.status(403).json({ error: 'That advisor is not available for your role.' });
      }

      // Scope the agent's tools to what this person may see. Without it the
      // advisors query company-wide — a rep could ask the sales advisor to
      // list commissions and get every rep's revenue and pay.
      const viewer = await buildAgentViewer(req.session.user! as any);
      const agent = await createAgent(req.params.role, viewer);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Signed-in team members get a persistent thread per agent that resets each
      // business day (and is summarized nightly for long-term recall).
      const email = req.session?.user?.email;
      let dailyChatId: number | null = null;
      let history: any[] = [];
      if (email) {
        try {
          dailyChatId = await getOrCreateChat(email, req.params.role);
          history = await todaysMessages(email, req.params.role);
        } catch (e) { console.error('[agents] chat store unavailable', e); }
      }

      // Chat with agent
      const result = await agent.chat(message, history);

      if (dailyChatId != null) {
        try {
          await saveTurn(dailyChatId, 'user', message);
          if (result.response) await saveTurn(dailyChatId, 'assistant', result.response);
        } catch (e) { console.error('[agents] failed to save turn', e); }
      }

      res.json({
        response: result.response,
        toolsUsed: result.toolsUsed,
        agent: agent.getInfo(),
      });
    } catch (error: any) {
      console.error('Agent chat error:', error);
      return sendFailure(res, error, 'POST /api/agents/:role/chat');
    }
  });

  // Get CEO daily briefing
  app.get('/api/agents/ceo/briefing', requireAuth, requireRole('manager'), async (_req: Request, res: Response) => {
    try {
      const [agentRow] = await db
        .select()
        .from(agents)
        .where(eq(agents.role, 'ceo'));

      if (!agentRow) {
        return res.status(404).json({ error: 'CEO agent not found' });
      }

      const ceo = new CEOAgent(toAgentConfig(agentRow));
      const briefing = await ceo.generateDailyBriefing();

      res.json({ briefing });
    } catch (error) {
      return sendUpstreamFailure(res, error, 'Claude', 'GET /api/agents/ceo/briefing');
    }
  });

  // ==================== LEADS ====================

  // Get all leads
  app.get('/api/leads', requireAuth, async (req: Request, res: Response) => {
    try {
      const { status, offset = 0, q, includeClosed } = req.query;
      // Default 250 (not 50): the old cap silently hid hundreds of real clients,
      // so anyone whose job wasn't in the newest 50 looked missing from the app.
      const limit = Math.min(Math.max(Number(req.query.limit ?? 250) || 250, 1), 1000);
      const user = req.session.user!;

      // Sales reps see only their own clients; managers/admins see all.
      const repScope = await repLeadWhere(user);
      const statusScope = status ? eq(leads.status, status as any) : undefined;

      // Closed jobs are hidden unless asked for — an active client list is the point.
      const closedScope = includeClosed === 'true' || status ? undefined : sql`coalesce(${leads.stage}, '') <> 'Closed'`;

      // Search runs in the DATABASE so it finds any client, not just the loaded page.
      const term = String(q || '').trim();
      const searchScope = term
        ? sql`(
            coalesce(${leads.firstName}, '') || ' ' || coalesce(${leads.lastName}, '') || ' ' ||
            coalesce(${leads.jobName}, '') || ' ' || coalesce(${leads.phone}, '') || ' ' ||
            coalesce(${leads.email}, '') || ' ' || coalesce(${leads.address}, '') || ' ' ||
            coalesce(${leads.city}, '') || ' ' || coalesce(${leads.jobNumber}, '')
          ) ILIKE ${'%' + term + '%'}`
        : undefined;

      const where = [repScope, statusScope, closedScope, searchScope].filter(Boolean) as any[];
      const whereClause = where.length === 0 ? undefined : where.length === 1 ? where[0] : and(...where);

      const base = db.select().from(leads);
      const leadsData = await (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(leads.createdAt))
        .limit(Number(limit))
        .offset(Number(offset));

      const countBase = db.select({ count: sql<number>`count(*)` }).from(leads);
      const [{ count }] = await (whereClause ? countBase.where(whereClause) : countBase);

      // Attach the resolved rep name (in-app override wins, else JobTread field).
      // A job can be shared by up to 3 reps; the primary is the one shown here,
      // with a count of anyone else sharing it.
      const overrides = await db
        .select({ jobExternalId: repAssignments.jobExternalId, name: teamMembers.name, role: repAssignments.role })
        .from(repAssignments)
        .innerJoin(teamMembers, eq(repAssignments.teamMemberId, teamMembers.id));
      const primaryMap = new Map(overrides.filter((o) => o.role === 'primary').map((o) => [o.jobExternalId, o.name]));
      const sharedCountMap = new Map<string, number>();
      for (const o of overrides) {
        if (o.role !== 'secondary') continue;
        sharedCountMap.set(o.jobExternalId, (sharedCountMap.get(o.jobExternalId) || 0) + 1);
      }
      const withRep = leadsData.map((l) => ({
        ...l,
        repName: (l.externalId && primaryMap.get(l.externalId)) || l.jtSalesRep || null,
        sharedCount: (l.externalId && sharedCountMap.get(l.externalId)) || 0,
      }));

      res.json({
        leads: withRep,
        total: Number(count),
        limit: Number(limit),
        offset: Number(offset),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/leads');
    }
  });

  // Get lead by ID (rep-scoped: a sales user can only open their own clients).
  app.get('/api/leads/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, Number(req.params.id)));

      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      if (!(await ownsLead(req.session.user!, lead.externalId))) {
        return res.status(404).json({ error: 'Lead not found' }); // don't reveal existence
      }

      res.json(lead);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/leads/:id');
    }
  });

  // Reps list for the manager assign-rep dropdown.
  app.get('/api/team/reps', requireAuth, requireRole('manager'), async (_req: Request, res: Response) => {
    try {
      // Anyone who sells: role=sales, OR anyone (incl. the owner/admins) mapped to
      // a JobTread "Sales Rep" name so they can own/be-assigned jobs too.
      const reps = await db
        .select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, jobtreadSalesRep: teamMembers.jobtreadSalesRep })
        .from(teamMembers)
        // Active only — assigning a job to someone who has left is refused
        // by POST /api/assignments, so offering them is a dead end.
        .where(and(eq(teamMembers.active, true), or(eq(teamMembers.role, 'sales'), isNotNull(teamMembers.jobtreadSalesRep))));
      res.json({ reps });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/team/reps');
    }
  });

  // A client's message thread: their GoHighLevel conversation (matched by phone)
  // + the JobTread job's comment feed, merged newest-first. Rep-scoped.
  app.get('/api/clients/:externalId/messages', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

      const chan = (t: string): string => {
        const s = String(t || '').toUpperCase();
        if (s.includes('SMS')) return 'sms';
        if (s.includes('EMAIL')) return 'email';
        if (s.includes('CALL') || s.includes('PHONE')) return 'call';
        return 'other';
      };

      const [ghlR, jtR] = await Promise.allSettled([
        (async () => {
          const out: any[] = [];
          let contactId: string | null = null;
          const ghl = new GoHighLevelClient();
          if (lead.phone) {
            const cs: any = await ghl.getContacts({ query: lead.phone, limit: 1 });
            contactId = cs?.contacts?.[0]?.id || null;
            if (contactId) {
              const convs: any = await ghl.getConversations(contactId);
              const convId = convs?.conversations?.[0]?.id;
              if (convId) {
                const m: any = await ghl.getMessages(convId);
                for (const x of (m?.messages || []).slice(-25)) {
                  out.push({
                    source: 'ghl', channel: chan(x.messageType || x.type),
                    direction: String(x.direction || '').toLowerCase(),
                    body: x.body || x.message || '',
                    date: x.dateAdded ? new Date(x.dateAdded).getTime() : 0,
                  });
                }
              }
            }
          }
          return { contactId, messages: out };
        })(),
        (async () => {
          const r = await new JobTreadClient().getJobComments(req.params.externalId, 25);
          return r.comments.map((c) => ({
            source: 'jobtread', channel: c.isFromEmail ? 'email' : 'note', direction: 'outbound',
            body: `${c.author ? c.author + ': ' : ''}${c.message}`.slice(0, 400),
            date: c.createdAt ? Date.parse(c.createdAt) : 0,
          }));
        })(),
      ]);

      const ghl = ghlR.status === 'fulfilled' ? ghlR.value : { contactId: null, messages: [] };
      const jt = jtR.status === 'fulfilled' ? jtR.value : [];
      const messages = [...ghl.messages, ...jt].sort((a, b) => b.date - a.date).slice(0, 60);
      // Deep link to the contact in GoHighLevel. On a phone with the LeadConnector
      // app installed, this universal link opens the app to that contact — one tap
      // from calling on the business number (calls placed here route through GHL,
      // not the rep's personal cell). Falls back to GHL web on desktop.
      const ghlLocationId = await currentGhlLocationId();
      const ghlContactUrl = ghl.contactId && ghlLocationId
        ? `${ghlAppBase()}/v2/location/${ghlLocationId}/contacts/detail/${ghl.contactId}`
        : null;
      res.json({ contactId: ghl.contactId, ghlContactUrl, messages });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/messages');
    }
  });

  // A client's JobTread estimates/proposals (documents type customerOrder). Rep-scoped.
  app.get('/api/clients/:externalId/estimates', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (lead.source !== 'jobtread') return res.json({ estimates: [] }); // GHL clients have no JobTread job
      const r = await new JobTreadClient().getJobEstimates(req.params.externalId, 15);
      res.json(r);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/estimates');
    }
  });

  // A client's JobTread daily logs (production progress). Rep-scoped.
  app.get('/api/clients/:externalId/daily-logs', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (lead.source !== 'jobtread') return res.json({ logs: [] });
      const r = await new JobTreadClient().getJobDailyLogs(req.params.externalId, 20);
      res.json(r);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/daily-logs');
    }
  });

  // Unified client detail: the lead + its documents + resolved rep. Rep-scoped.
  app.get('/api/clients/:externalId', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'Client not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'Client not found' });

      // Resolved rep (override wins, else JobTread field). A job can be shared
      // by up to 3 reps; the primary is shown as `repName`, anyone else sharing
      // it is `sharedWith`.
      let repName: string | null = lead.jtSalesRep;
      let sharedWith: string[] = [];
      if (lead.externalId) {
        const rows = await db
          .select({ name: teamMembers.name, role: repAssignments.role })
          .from(repAssignments)
          .innerJoin(teamMembers, eq(repAssignments.teamMemberId, teamMembers.id))
          .where(eq(repAssignments.jobExternalId, lead.externalId));
        const primary = rows.find((r) => r.role === 'primary');
        if (primary?.name) repName = primary.name;
        sharedWith = rows.filter((r) => r.role === 'secondary').map((r) => r.name);
      }

      // Documents for this job (matched by job name).
      const docs = lead.jobName
        ? await db.select().from(deals).where(eq(deals.jobRef, lead.jobName)).orderBy(desc(deals.signedAt), desc(deals.issueDate))
        : [];

      // Insurance-claim fields (live from JobTread; best-effort).
      const insurance = lead.externalId && lead.source === 'jobtread'
        ? await new JobTreadClient().getJobInsurance(lead.externalId).catch(() => ({}))
        : {};

      res.json({
        insurance,
        lead: {
          externalId: lead.externalId,
          customer: lead.firstName,
          jobName: lead.jobName,
          email: lead.email,
          phone: lead.phone,
          address: [lead.address, lead.city, lead.state].filter(Boolean).join(', ') || lead.address,
          // The address as stored, for editing — `address` above is for display.
          addressLine: lead.address,
          source: lead.source,
          status: lead.status,
          stage: lead.stage,
          repName,
          sharedWith,
          projectManager: lead.projectManager,
          projectedValue: lead.projectedValue != null ? Number(lead.projectedValue) : null,
          insuranceClaim: !!lead.insuranceClaim,
          scheduleStart: lead.scheduleStart ? lead.scheduleStart.toISOString() : null,
          scheduleEnd: lead.scheduleEnd ? lead.scheduleEnd.toISOString() : null,
          createdAt: lead.createdAt ? lead.createdAt.toISOString() : null,
        },
        documents: docs.map((d) => ({
          id: d.id, type: d.type, amount: d.amount != null ? Number(d.amount) : null,
          status: d.status, issueDate: d.issueDate, signedAt: d.signedAt ? d.signedAt.toISOString() : null,
        })),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId');
    }
  });

  // Get lead pipeline summary
  // Counts only the leads this person may see. It counted the whole company
  // for everyone, so a rep could read every other rep's pipeline from it.
  app.get('/api/leads/pipeline/summary', requireAuth, async (req: Request, res: Response) => {
    try {
      const scope = await repLeadWhere(req.session.user!);
      const statusCounts = await db
        .select({
          status: leads.status,
          count: sql<number>`count(*)`,
        })
        .from(leads)
        .where(scope)
        .groupBy(leads.status);

      const pipeline = statusCounts.reduce((acc, s) => {
        acc[s.status || 'new'] = Number(s.count);
        return acc;
      }, {} as Record<string, number>);

      res.json({
        pipeline,
        total: statusCounts.reduce((sum, s) => sum + Number(s.count), 0),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/leads/pipeline/summary');
    }
  });

  // ==================== METRICS ====================

  // Get today's metrics
  // Company revenue is money, so it is only returned to roles that may see AR,
  // and the lead counts are limited to the caller's own scope. Both were
  // company-wide for anyone signed in.
  app.get('/api/metrics/today', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [metrics] = canSeeMoney(user.role, 'ar')
        ? await db.select().from(dailyMetrics).where(eq(dailyMetrics.date, today))
        : [];

      // Get lead counts
      const scope = await repLeadWhere(user);
      const leadCounts = await db
        .select({
          status: leads.status,
          count: sql<number>`count(*)`,
        })
        .from(leads)
        .where(scope)
        .groupBy(leads.status);

      res.json({
        date: today.toISOString().split('T')[0],
        metrics: metrics || {
          revenue: 0,
          newLeads: 0,
          qualifiedLeads: 0,
          activeJobs: 0,
        },
        leads: leadCounts.reduce((acc, c) => {
          acc[c.status || 'new'] = Number(c.count);
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/metrics/today');
    }
  });

  // ==================== AGENT ACTIVITY ====================

  // Get recent agent decisions
  // Sales leader and up. Agent decisions carry the agents' reasoning about the
  // whole company's leads and numbers, and nothing in the app shows them to a
  // rep; any signed-in user could read them here.
  app.get('/api/activity', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const limit = clampLimit(req.query.limit, 20);

      const decisions = await db
        .select({
          id: agentDecisions.id,
          agentId: agentDecisions.agentId,
          context: agentDecisions.context,
          decision: agentDecisions.decision,
          reasoning: agentDecisions.reasoning,
          createdAt: agentDecisions.createdAt,
        })
        .from(agentDecisions)
        .orderBy(desc(agentDecisions.createdAt))
        .limit(limit);

      // Get agent names
      const agentList = await db.select().from(agents);
      const agentMap = new Map(agentList.map(a => [a.id, a]));

      const activity = decisions.map(d => ({
        ...d,
        agentName: agentMap.get(d.agentId)?.name || 'Unknown',
        agentRole: agentMap.get(d.agentId)?.role,
      }));

      res.json(activity);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/activity');
    }
  });

  // ==================== WEBHOOKS ====================

  // GHL and JobTread have no standard request-signing scheme like Twilio's, so
  // this is opt-in: set GHL_WEBHOOK_SECRET / JOBTREAD_WEBHOOK_SECRET and
  // configure the matching custom header in the provider's webhook action.
  //
  // Neither is set in production today — confirmed by POSTing `{}` with a
  // deliberately wrong secret to both live endpoints and getting 200 back. So
  // anyone who knows the URLs can create leads here and spend LLM credit doing
  // it. The reason this still fails OPEN is that closing it before the header
  // is configured at the provider end would silently drop real incoming leads,
  // which is the worse failure for a business that runs on them.
  //
  // The path out is one environment variable, not a deploy: set the secrets,
  // configure the header at GHL and JobTread, then set WEBHOOKS_REQUIRE_SECRET
  // and this refuses anything unsigned. Until then an unverified webhook is
  // accepted and says so in the log, loudly, every time.
  // These endpoints are reachable by anyone until the secrets are set, and each
  // accepted lead can start an LLM call. A ceiling keeps "open" from also
  // meaning "unbounded spend". Keyed by IP here, since a webhook has no session.
  const webhookLimiter = rateLimit(120, 10 * 60 * 1000);

  const requireWebhookSecret = /^(1|true|yes)$/i.test(process.env.WEBHOOKS_REQUIRE_SECRET || '');

  const checkWebhookSecret = (envVar: string, req: Request, res: Response): boolean => {
    const expected = process.env[envVar];
    if (!expected) {
      if (requireWebhookSecret) {
        console.error(`[webhook] REFUSED ${req.path}: ${envVar} is not set and WEBHOOKS_REQUIRE_SECRET is on.`);
        res.status(503).json({ error: 'webhook verification is required but not configured' });
        return false;
      }
      console.warn(`[webhook] UNVERIFIED ${req.path} accepted — ${envVar} is not set, so anyone can post here.`);
      return true;
    }
    const got = req.header('x-webhook-secret');
    if (!got || !timingSafeEqualStr(got, expected)) {
      console.warn(`[webhook] rejected ${req.path}: bad or missing x-webhook-secret`);
      res.status(403).json({ error: 'invalid webhook secret' });
      return false;
    }
    return true;
  };

  // GoHighLevel webhook
  app.post('/api/webhooks/gohighlevel', webhookLimiter, async (req: Request, res: Response) => {
    try {
      const payload = JSON.parse(req.body.toString());
      console.log('GHL Webhook received:', payload.type || payload.eventType);

      // Which company: the GHL sub-account (location) the event came from.
      // An event for a location no company has connected is acknowledged and
      // dropped, so GHL does not keep retrying it.
      const locationId = String(payload.locationId || payload.location_id || payload.data?.locationId || '');
      const company = locationId ? await getCompanyByGhlLocation(locationId) : null;
      if (!company) return res.json({ received: true, ignored: 'unknown location' });

      // The secret is the company's own (Settings ▸ GHL), checked as that
      // company, and always required: a location id alone proves nothing.
      const verified = await runAsCompany(company.id, () => verifyGhlWebhookSecret(req.header('x-webhook-secret')));
      if (!verified) {
        console.warn(`[webhook] rejected GHL event for company ${company.id}: bad or missing x-webhook-secret`);
        return res.status(403).json({ error: 'invalid webhook secret' });
      }

      await runAsCompany(company.id, async () => {
      const ghl = new GoHighLevelClient();
      const { eventType, data } = ghl.parseWebhookPayload(payload);

      // Handle new contact/lead
      if (eventType === 'ContactCreate' || eventType === 'contact.create') {
        const [agentRow] = await db
          .select()
          .from(agents)
          .where(eq(agents.role, 'cmo'));

        if (agentRow) {
          const cmo = new CMOAgent(toAgentConfig(agentRow));
          const leadData = ghl.contactToLead(data);

          const result = await cmo.handleNewLead({
            ...leadData,
            serviceType: data.customField?.serviceType || data.tags?.find((t: string) =>
              ['repair', 'replacement', 'inspection'].includes(t.toLowerCase())
            ),
            propertyType: data.customField?.propertyType,
          });

          console.log('Lead processed:', result);
        }
      }
      });

      res.json({ received: true });
    } catch (error: any) {
      console.error('GHL webhook error:', error);
      return sendFailure(res, error, 'POST /api/webhooks/gohighlevel');
    }
  });

  // JobTread webhook
  app.post('/api/webhooks/jobtread', webhookLimiter, async (req: Request, res: Response) => {
    try {
      if (!checkWebhookSecret('JOBTREAD_WEBHOOK_SECRET', req, res)) return;
      const payload = JSON.parse(req.body.toString());
      console.log('JobTread Webhook received:', payload.event || payload.type);

      const jobtread = new JobTreadClient();
      const { eventType, entityType, data } = jobtread.parseWebhookPayload(payload);

      // Handle new contact
      if (eventType === 'contact.created' && entityType === 'contact') {
        const [agentRow] = await db
          .select()
          .from(agents)
          .where(eq(agents.role, 'cmo'));

        if (agentRow) {
          const cmo = new CMOAgent(toAgentConfig(agentRow));
          const leadData = jobtread.contactToLead(data);

          const result = await cmo.handleNewLead(leadData);
          console.log('Lead processed from JobTread:', result);
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error('JobTread webhook error:', error);
      return sendFailure(res, error, 'POST /api/webhooks/jobtread');
    }
  });

  // ==================== SETTINGS ====================
  // There is no generic settings read or write. Each feature owns its keys
  // behind its own route and checks (neighbor letters, playbook, comms...),
  // because some keys are secrets or security state a generic PUT could forge.
}
