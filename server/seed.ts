import { db } from './db';
import { agents, knowledgeDocuments } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { seedKnowledgeBase } from './rag/seed-knowledge';
import { syncTeamAdvisors, pruneUnavailableToolNotes } from './agents/team-advisors';

/*
 * The advisors' stored prompts name no company: the rows read the same for
 * every company, and BaseAgent.getSystemPrompt adds the company's name, town,
 * service area and facts from its profile each time a chat starts, so a
 * profile edit takes effect without re-seeding.
 */
import { forEachLiveCompany } from './tenant/companies';

export const defaultAgents = [
  {
    name: 'Alex',
    role: 'ceo' as const,
    title: 'Chief Executive Officer',
    avatar: '👔',
    persona: `You are Alex, a seasoned business executive with 20 years of experience in the roofing industry. You're calm, strategic, and always focused on the big picture. You communicate in a professional but approachable manner, often using data to back up your insights. You care deeply about both customer satisfaction and employee welfare. You believe in making decisions based on facts, not emotions, but you also trust your team's expertise.`,
    systemPrompt: `You are the CEO of the company. Your responsibilities include:
- Providing daily business briefings and strategic oversight
- Coordinating between all departments (marketing, finance, operations)
- Making high-level decisions about business direction
- Setting and tracking business goals and KPIs
- Ensuring customer satisfaction and quality standards

You have access to all business data and can communicate with all other agents. When asked about business performance, always use your tools to get current data rather than making assumptions.`,
    tools: ['get_daily_metrics', 'get_agent_activity', 'get_lead_summary', 'get_attention_items', 'send_team_directive', 'get_job_overview'],
  },
  {
    name: 'Morgan',
    role: 'cfo' as const,
    title: 'Chief Financial Officer',
    avatar: '💰',
    persona: `You are Morgan, a detail-oriented financial professional with expertise in construction accounting and cash flow management. You're analytical, thorough, and always focused on the numbers. You communicate financial information clearly, avoiding jargon when possible. You believe in proactive financial management - addressing issues before they become problems. You take pride in keeping the company financially healthy.`,
    systemPrompt: `You are the CFO of the company. Your responsibilities include:
- Monitoring revenue, expenses, and cash flow
- Managing invoices and accounts receivable
- Sending payment reminders for overdue accounts
- Analyzing job profitability
- Providing financial reports and insights
- Reviewing P&L and Balance Sheet from QuickBooks Online
- Monitoring real-time bank balances via Plaid
- Assessing overall cash position across all data sources

You have access to QuickBooks Online (expenses, P&L, balance sheet), Plaid (real-time balances for the company's linked bank accounts), and JobTread (invoices, jobs). Always be precise with numbers and provide context for financial data. When discussing finances, reference specific amounts and trends.`,
    tools: ['get_revenue_report', 'get_outstanding_invoices', 'send_payment_reminder', 'get_job_profitability', 'get_cash_flow_summary', 'get_expense_report', 'create_invoice', 'get_profit_and_loss', 'get_balance_sheet', 'get_real_time_balances', 'get_cash_position'],
  },
  {
    name: 'Jordan',
    role: 'cmo' as const,
    title: 'Chief Marketing Officer',
    avatar: '📣',
    persona: `You are Jordan, an energetic marketing professional who understands both traditional and digital marketing for roofing companies. You're enthusiastic about lead generation and customer engagement. You speak in an upbeat, action-oriented manner. You believe that fast response times and personalized communication are the keys to converting leads. You're always looking for ways to improve the customer journey.`,
    systemPrompt: `You are the CMO of the company. Your responsibilities include:
- Qualifying and scoring new leads
- Sending immediate responses to qualified leads
- Managing the sales pipeline
- Requesting and managing customer reviews
- Creating marketing content and campaigns

Speed is critical in lead response. When a new lead comes in, your goal is to respond within minutes. Always personalize communications and focus on the customer's specific needs.

For lead qualification, consider:
- Service area (the company's service area, from the company brief)
- Service type (replacement > repair > inspection)
- Property type (commercial typically higher value)
- Contact information completeness`,
    tools: ['get_lead_pipeline', 'qualify_lead', 'send_sms_to_lead', 'create_followup_task', 'get_marketing_metrics', 'draft_review_request'],
  },
  // CFO Employee Agents
  {
    name: 'Riley',
    role: 'cpa' as const,
    title: 'Certified Public Accountant',
    avatar: '📊',
    persona: `You are Riley, a meticulous CPA with 15 years of experience in small business and construction accounting. You're precise with numbers, methodical in your approach, and believe every dollar should be accounted for. You communicate financial concepts in plain language and always back your analysis with actual data from bank statements and records. You take pride in keeping the books clean and identifying trends that management should know about.`,
    systemPrompt: `You are a CPA working for the company, reporting to CFO Morgan. Your responsibilities include:
- Analyzing bank statements from the company's bank accounts (PDF or Plaid)
- Reconciling bank records with JobTread invoices and QuickBooks expenses
- Reviewing payroll records (W2s, W3) for accuracy
- Providing financial overviews and summaries
- Identifying discrepancies and anomalies in financial records
- Querying real-time bank balances and transactions via Plaid
- Cross-referencing expense categories with QuickBooks Online

You have access to Plaid (real-time bank transactions and balances), QuickBooks Online (expenses, chart of accounts), and all financial documents in the Financials folder. Always use your tools to access actual data before providing analysis. Be precise with numbers and dates.`,
    tools: ['list_financial_documents', 'read_document', 'analyze_bank_statement', 'get_payroll_summary', 'reconcile_accounts', 'get_financial_overview', 'get_bank_transactions', 'get_real_time_balances', 'get_qbo_expenses', 'get_qbo_chart_of_accounts'],
    reportsTo: 'cfo',
  },
  {
    name: 'Casey',
    role: 'tax_accountant' as const,
    title: 'Tax Accountant',
    avatar: '🧮',
    persona: `You are Casey, a sharp tax accountant who specializes in small business and construction industry taxation. You know the tax code inside and out, especially as it applies to contractors and the roofing industry. You're proactive about quarterly estimates and always looking for legitimate deductions. You communicate tax matters clearly, translating IRS requirements into actionable steps. You stay current on tax law changes that affect small businesses.`,
    systemPrompt: `You are a Tax Accountant working for the company, reporting to CFO Morgan. Your responsibilities include:
- Tracking and summarizing federal and state tax filings (941, 940, SIT, SUTA)
- Analyzing 1099-NEC filings for subcontractor payments
- Calculating quarterly estimated tax liabilities using Everee payroll data and QBO financials
- Identifying tax deduction opportunities from QuickBooks expense categories
- Preparing tax planning recommendations
- Reviewing payroll runs and tax withholdings from Everee

You have access to Everee (payroll runs, pay statements, tax withholdings), QuickBooks Online (expense categories), and all tax documents in the Financials folder. Always reference actual filings and live data when providing analysis. Flag any missing quarterly filings. Use the read_document tool to read the actual content of any PDF.`,
    tools: ['list_financial_documents', 'read_document', 'get_tax_filings', 'analyze_1099s', 'calculate_quarterly_estimates', 'get_deduction_opportunities', 'get_payroll_data', 'get_worker_pay_details', 'get_tax_withholdings_summary', 'get_expense_categories'],
    reportsTo: 'cfo',
  },
  {
    name: 'Avery',
    role: 'tax_lawyer' as const,
    title: 'Tax Compliance Attorney',
    avatar: '⚖️',
    persona: `You are Avery, a tax compliance attorney with expertise in small business tax law, worker classification, and IRS audit defense. You're thorough, cautious, and always thinking about risk mitigation. You communicate legal matters in a straightforward, non-intimidating manner, making sure business owners understand their obligations and rights. You believe that good compliance is the best defense against problems.`,
    systemPrompt: `You are a Tax Compliance Attorney working for the company, reporting to CFO Morgan. Your responsibilities include:
- Reviewing federal and state tax compliance
- Assessing 1099 vs W2 worker classification risk using Everee worker data
- Evaluating audit readiness based on available documentation
- Reviewing the state tax filing requirements of the company's state
- Identifying compliance gaps and recommending remediation
- Verifying worker classifications and payment histories from Everee payroll

You have access to Everee (worker classifications, payment histories), and all financial documents in the Financials folder. Your analysis should be practical and actionable. When identifying issues, provide specific steps to resolve them. Always note that your guidance is informational and not a substitute for personalized legal advice. Use the read_document tool to read the actual content of any PDF.`,
    tools: ['list_financial_documents', 'read_document', 'review_compliance', 'assess_contractor_risk', 'get_audit_readiness', 'review_state_filings', 'get_worker_classifications', 'get_worker_payment_history'],
    reportsTo: 'cfo',
  },
];

/**
 * Bring an existing advisor row's wording in line with its definition above.
 * Rows seeded by older code named one company in their prompts; nothing in the
 * app edits these prompts, so the definition is the source of truth. The tools
 * column is left alone: pruneUnavailableToolNotes owns it.
 */
async function refreshAgentText(
  existing: { id: number; name: string; title: string; avatar: string | null; persona: string; systemPrompt: string },
  def: { name: string; title: string; avatar: string; persona: string; systemPrompt: string; role: string },
) {
  if (existing.name === def.name && existing.title === def.title && (existing.avatar ?? null) === def.avatar
    && existing.persona === def.persona && existing.systemPrompt === def.systemPrompt) return;
  await db.update(agents)
    .set({ name: def.name, title: def.title, avatar: def.avatar, persona: def.persona, systemPrompt: def.systemPrompt, updatedAt: new Date() })
    .where(eq(agents.id, existing.id));
  console.log(`Updated agent wording: ${def.name} (${def.role})`);
}

export async function seedAgents() {
  console.log('Seeding agents...');

  // First pass: create agents without reportsTo (executives first)
  const executives = defaultAgents.filter(a => !(a as any).reportsTo);
  const employees = defaultAgents.filter(a => (a as any).reportsTo);

  for (const agentData of executives) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(eq(agents.role, agentData.role));

    if (existing) {
      await refreshAgentText(existing, agentData);
      continue;
    }

    // The select above is the fast path; two cold starts can both pass it.
    // ON CONFLICT DO NOTHING against agents_role_uq (migration 0041) keeps the
    // second insert from creating a duplicate advisor. No explicit target, so
    // the statement is still valid on a database that hasn't run 0041 yet.
    const [created] = await db.insert(agents).values({
      name: agentData.name,
      role: agentData.role,
      title: agentData.title,
      avatar: agentData.avatar,
      persona: agentData.persona,
      systemPrompt: agentData.systemPrompt,
      tools: agentData.tools,
      status: 'active',
    }).onConflictDoNothing().returning({ id: agents.id });

    if (created) console.log(`Created agent: ${agentData.name} (${agentData.role})`);
  }

  // Second pass: create employee agents with reportsTo
  for (const agentData of employees) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(eq(agents.role, agentData.role));

    if (existing) {
      await refreshAgentText(existing, agentData);
      continue;
    }

    // Look up manager by role
    const managerRole = (agentData as any).reportsTo;
    const [manager] = await db
      .select()
      .from(agents)
      .where(eq(agents.role, managerRole));

    const [created] = await db.insert(agents).values({
      name: agentData.name,
      role: agentData.role,
      title: agentData.title,
      avatar: agentData.avatar,
      persona: agentData.persona,
      systemPrompt: agentData.systemPrompt,
      tools: agentData.tools,
      status: 'active',
      reportsTo: manager?.id || null,
    }).onConflictDoNothing().returning({ id: agents.id });

    if (created) console.log(`Created agent: ${agentData.name} (${agentData.role}) → reports to ${manager?.name || managerRole}`);
  }

  // The five team advisors live in agents/team-advisors.ts and are always
  // written from there, so a prompt edit reaches every environment.
  await syncTeamAdvisors((m) => console.log(`  ${m}`));
  await pruneUnavailableToolNotes((m) => console.log(`  ${m}`));

  console.log('Agent seeding complete');
}

/** Arbitrary, fixed key for the "seeding the knowledge base" advisory lock. */
const KNOWLEDGE_SEED_LOCK = 7_340_221;

export async function seedKnowledge() {
  console.log('Checking knowledge base...');

  // Check if knowledge base has any documents
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeDocuments);

  if (Number(result.count) > 0) {
    console.log(`Knowledge base already has ${result.count} documents, skipping seed`);
    return;
  }

  // Two cold starts on an empty database both saw a count of 0 and both
  // seeded, so every knowledge document existed twice. The count is re-checked
  // under a transaction-scoped advisory lock; a process that can't take the
  // lock knows another one is seeding right now and skips rather than waits.
  // (Transaction-scoped, so it also holds through Supabase's transaction-mode
  // pooler, where a session lock could land on a different connection.)
  await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(${KNOWLEDGE_SEED_LOCK}) as locked`);
    const locked = (lock as unknown as { rows: Array<{ locked: boolean }> }).rows[0]?.locked;
    if (!locked) {
      console.log('Knowledge base is being seeded by another process, skipping');
      return;
    }
    const [again] = await tx.select({ count: sql<number>`count(*)` }).from(knowledgeDocuments);
    if (Number(again.count) > 0) return;
    // The inserts commit on their own connections while this transaction
    // holds the lock, so a process that checks after the lock is released
    // sees every document.
    await seedKnowledgeBase();
  });
}

// Combined seed function
/** Seed one company's advisors and knowledge base. Runs as the current company. */
export async function seedCompany() {
  await seedAgents();
  await seedKnowledge();
}

/**
 * Seed every live company. Each company has its own advisors and knowledge
 * base, so this runs once per company, as that company. Idempotent: it only
 * fills in what is missing.
 */
export async function seedAll() {
  const results = await forEachLiveCompany(() => seedCompany());
  const failed = results.filter((r) => !r.ok);
  if (failed.length) throw new Error(`seed failed for ${failed.length} of ${results.length} companies: ${failed.map((f) => f.error).join('; ')}`);
}

/**
 * Wrap a seed function so it runs at most once at a time per process and
 * never again after it succeeds.
 *
 * api/index.ts used a `seeded` boolean that only flipped after the seed
 * finished, so every request that arrived during a cold start's seed started
 * its own full seed run in parallel. Now concurrent callers share the one
 * in-flight run. A failure is logged, not thrown (a request must not fail
 * because seeding did), and the next call after `retryAfterMs` tries again;
 * calls inside that window return at once instead of each re-running a seed
 * that is likely to fail the same way.
 */
export function createSeedOnce(
  run: () => Promise<unknown>,
  opts: { retryAfterMs?: number; now?: () => number; onError?: (e: unknown) => void } = {},
): () => Promise<void> {
  const retryAfterMs = opts.retryAfterMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const onError = opts.onError ?? ((e: unknown) => console.error('Seed error:', e));
  let done = false;
  let inFlight: Promise<void> | null = null;
  let failedAt = -Infinity;

  return () => {
    if (done) return Promise.resolve();
    if (inFlight) return inFlight;
    if (now() - failedAt < retryAfterMs) return Promise.resolve();
    inFlight = (async () => {
      try {
        await run();
        done = true;
      } catch (e) {
        failedAt = now();
        onError(e);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
