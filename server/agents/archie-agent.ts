import { BaseAgent, type AgentConfig, type Tool } from './base-agent';
import { archieToolsForRole, isArchieToolAllowed, type ArchieToolName } from './archie-tools';
import { recallPastDays } from './chat-store';
import { type TeamRole } from '../../shared/rbac';
import { fetchPipeline, fetchInvoicesByKind, fetchSchedule, fetchLeads, fetchWatchlist } from '../storage/reports';
import { JobTreadClient } from '../integrations/jobtread';
import { searchEmail, searchDrive, readDriveFile } from './google-tools';
import { readCalendar } from './calendar-tools';
import { isScoped, repLeadWhere, repJobNames, type SessionUser } from '../access/rep-scope';
import { atLeast, canSeeMoney, ROLE_LABEL } from '../../shared/rbac';
import type { AgentViewer } from './viewer';
import {
  createFollowUpTool, followUpsTool, jobCommissionsTool, myKpisTool, myLeadsTool, myScheduleTool,
  pipelineSummaryTool, projectTool,
} from './sales-tools';
import { calculateCommissionTool, listCommissionsTool, lookupJobTool } from './team-agents';
import { lookupReference, referenceIndex, referenceIsHomeState, NC_REFERENCE, REFERENCE_CHECKED_ON } from './advisor-knowledge';
import { companyWebsite, readWebsiteTool, searchWebsiteTool } from './website-tools';
import { currentProfile } from '../tenant/context';

/**
 * Walk a Pave query and return the first write operation found, if any.
 *
 * The raw JobTread tool is deliberately read-only: an assistant with arbitrary
 * write access to the system that holds customer contracts, pricing and vendor
 * orders could delete or send things irreversibly. Writes stay as the app's
 * explicit, audited actions.
 */
export function findMutation(node: unknown, depth = 0): string | null {
  if (depth > 12 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findMutation(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (/^(create|update|delete|remove|send|archive|restore|move|copy|merge|convert|approve|deny|pay|void|cancel|invite|grant|revoke)[A-Z]/.test(key)) {
      return key;
    }
    const hit = findMutation(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Static tool definitions. Tools that need the caller's own email (Gmail, Drive,
// past-day recall) aren't here — they're registered separately in the constructor,
// hence Partial.
const TOOL_DEFS: Partial<Record<ArchieToolName, Omit<Tool, 'execute'> & { execute: () => Tool['execute'] }>> = {
  get_schedule: {
    name: 'get_schedule',
    description:
      "The WHOLE TEAM's upcoming appointments/inspections, across everyone's synced calendars. Use this for team-wide questions (\"what's the crew got this week?\"); for the signed-in user's own day use get_calendar, which is live. Optional ISO from/to dates.",
    parameters: { type: 'object', properties: { from: { type: 'string', description: 'ISO start' }, to: { type: 'string', description: 'ISO end' } } },
    execute: () => async (p) => fetchSchedule({ from: p.from, to: p.to }),
  },
  get_leads: {
    name: 'get_leads',
    description: 'Recent leads (name, status, source, service type, city/state). Optional status filter.',
    parameters: { type: 'object', properties: { status: { type: 'string', description: 'Lead status' }, limit: { type: 'number', description: 'Max rows (<=50)' } } },
    execute: () => async (p) => fetchLeads({ status: p.status, limit: p.limit }),
  },
  get_pipeline: {
    name: 'get_pipeline',
    description: 'Sent proposals/estimates with amount, type, status. Optional status filter.',
    parameters: { type: 'object', properties: { status: { type: 'string', description: 'draft|pending|approved|denied' }, limit: { type: 'number', description: 'Max rows (<=50)' } } },
    execute: () => async (p) => fetchPipeline({ status: p.status, limit: p.limit }),
  },
  get_receivables: {
    name: 'get_receivables',
    description: 'Money customers owe us (AR). Set overdueOnly to filter overdue.',
    parameters: { type: 'object', properties: { overdueOnly: { type: 'boolean', description: 'Only overdue' }, limit: { type: 'number', description: 'Max rows (<=50)' } } },
    execute: () => async (p) => fetchInvoicesByKind('ar', { overdueOnly: p.overdueOnly, limit: p.limit }),
  },
  get_payables: {
    name: 'get_payables',
    description: 'Bills we owe vendors (AP).',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max rows (<=50)' } } },
    execute: () => async (p) => fetchInvoicesByKind('ap', { limit: p.limit }),
  },
  get_lead_kpis: {
    name: 'get_lead_kpis',
    description: 'Lead KPIs from JobTread: win rate, pipeline value, counts by status.',
    parameters: { type: 'object', properties: { period: { type: 'string', description: 'month|year', enum: ['month', 'year'] } } },
    execute: () => async (p) => new JobTreadClient().getLeadKpis({ period: p.period === 'year' ? 'year' : 'month' }),
  },
  get_watchlist: {
    name: 'get_watchlist',
    description:
      'Open items the assistant is watching / has flagged (the "Lead Watchdog") from email, texts, JobTread, and the calendar — with summary, urgency, owner, and contact. Optionally filter by source or urgency.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Filter by source', enum: ['gmail', 'ghl', 'jobtread', 'calendar', 'sms'] },
        urgency: { type: 'string', description: 'Filter by urgency', enum: ['emergency', 'urgent', 'normal', 'low'] },
        limit: { type: 'number', description: 'Max items (<=50)' },
      },
    },
    execute: () => async (p) => fetchWatchlist({ source: p.source, urgency: p.urgency, limit: p.limit }),
  },
};

export class ArchieAgent extends BaseAgent {
  private teamRole: TeamRole;
  private userEmail?: string;

  constructor(config: AgentConfig, teamRole: TeamRole, userEmail?: string) {
    super(config); // runs registerBaseTools() + our no-op registerTools()
    this.teamRole = teamRole;
    this.userEmail = userEmail;
    const hasBook = this.registerBookTools(config.viewer);
    this.registerKnowledgeTools();
    for (const name of archieToolsForRole(teamRole)) {
      // Tools needing the caller's own email (search_email, search_drive,
      // read_drive_file, recall_past_days) have no static def — they're
      // registered separately below.
      const def = TOOL_DEFS[name];
      if (!def) continue;
      // get_my_leads (the book) does everything get_leads did and more; two
      // near-identical lead tools only make the model pick wrong.
      if (hasBook && name === 'get_leads') continue;
      let inner = def.execute();
      // Rep scoping: a `sales` caller's client-data tools must only return their
      // own clients (same server-side invariant as the screens).
      if (this.userEmail && isScoped({ role: teamRole } as SessionUser)) {
        const su: SessionUser = { email: this.userEmail, name: config.name, role: teamRole };
        if (name === 'get_leads') {
          inner = async (p) => fetchLeads({ status: p.status, limit: p.limit }, await repLeadWhere(su));
        } else if (name === 'get_pipeline') {
          inner = async (p) => fetchPipeline({ status: p.status, limit: p.limit }, await repJobNames(su));
        }
      }
      this.registerTool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        // Defense in depth: re-check the role at execution time. Disallowed tools
        // are never registered, so this only ever matters if registration is
        // later changed — it must never return data above the caller's role.
        execute: async (p) => (isArchieToolAllowed(teamRole, name) ? inner(p) : { error: 'not_permitted' }),
      });
    }
    // Long-term memory: the caller's OWN past-day chat summaries. Threads reset
    // daily, so this is how the assistant looks back at an earlier day.
    if (this.userEmail) {
      const who = this.userEmail;
      this.registerTool({
        name: 'recall_past_days',
        description:
          "Look back at what you and this team member discussed on PREVIOUS days (today's conversation is already in context). Each past day has a saved summary. Optionally filter by keyword — e.g. a customer name — to find the day it came up.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword to search past day summaries (optional)' },
            limit: { type: 'number', description: 'How many past days to return (default 14)' },
          },
        },
        execute: async (p) => {
          const days = await recallPastDays(who, { query: p.query, limit: p.limit });
          return days.length ? { days } : { days: [], note: 'No past-day summaries saved yet.' };
        },
      });
    }

    // Raw JobTread access (admin only — see ARCHIE_TOOL_MIN_ROLE). Read-only by
    // construction: write mutations are rejected before they reach the API, so
    // the assistant can inspect anything but can't change or send anything.
    if (isArchieToolAllowed(teamRole, 'jobtread_schema')) {
      this.registerTool({
        name: 'jobtread_schema',
        description:
          "Introspect the JobTread (Pave) API schema to discover what data exists and the exact field names, BEFORE running jobtread_query. Pass a path like 'root' (top-level fields), a type name like 'job'/'document'/'dailyLog', or 'root.<field>'; optionally a keyword to search. Always check the schema before guessing field names.",
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "Schema path, e.g. 'root', 'job', 'root.createDocument.$'" },
            search: { type: 'string', description: 'Optional keyword to search within that path' },
            expand: { type: 'boolean', description: 'Expand the full object (default true)' },
          },
          required: ['path'],
        },
        execute: async (p) => {
          if (!isArchieToolAllowed(teamRole, 'jobtread_schema')) return { error: 'not_permitted' };
          try {
            const args: Record<string, any> = { path: String(p.path || 'root') };
            if (p.search) args.search = String(p.search);
            if (p.expand !== false && !p.search) args.expand = true;
            return await new JobTreadClient().paveQuery({ schema: { $: args } });
          } catch (e: any) {
            return { error: e?.message || 'schema lookup failed' };
          }
        },
      });
    }

    if (isArchieToolAllowed(teamRole, 'jobtread_query')) {
      this.registerTool({
        name: 'jobtread_query',
        description:
          "Run any READ query against JobTread's Pave API — jobs, accounts, contacts, documents, files, comments, daily logs, tasks, budgets, custom fields, anything. Pass the query as a JSON object (same shape the API takes; arguments go under \"$\"). Use jobtread_schema first to confirm field names; get the organization id with {\"organizations\":{\"nodes\":{\"id\":{},\"name\":{}}}}. Read-only: any create/update/delete is refused.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'object', description: 'Pave query object, e.g. {"job":{"$":{"id":"22Pd..."},"name":{},"documents":{"nodes":{"id":{},"name":{}}}}}' },
          },
          required: ['query'],
        },
        execute: async (p) => {
          if (!isArchieToolAllowed(teamRole, 'jobtread_query')) return { error: 'not_permitted' };
          const q = p.query;
          if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: 'query must be a JSON object' };
          const mutation = findMutation(q);
          if (mutation) {
            return { error: `Refused: "${mutation}" changes data. This tool is read-only — use the app's own actions (stage, note, proposal, photo upload) for writes.` };
          }
          try {
            return await new JobTreadClient().paveQuery(q as Record<string, any>);
          } catch (e: any) {
            return { error: e?.message || 'query failed' };
          }
        },
      });
    }

    // Gmail + Drive: read ONLY the signed-in user's OWN account via the company
    // service account's domain-wide delegation (internal). Registered only when we
    // know the caller's email and the role allows the tool.
    if (this.userEmail) {
      const mailbox = this.userEmail;
      if (isArchieToolAllowed(teamRole, 'get_calendar')) {
        this.registerTool({
          name: 'get_calendar',
          description:
            "The signed-in user's OWN Google Calendar, live. Use this for anything about THEIR day, week, or availability — what's on today, whether they're free at a given time, when their next appointment is. Optional ISO from/to; defaults to the next 7 days.",
          parameters: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'ISO start (optional, defaults to now)' },
              to: { type: 'string', description: 'ISO end (optional, defaults to a week out)' },
              limit: { type: 'number', description: 'Max events (<=50)' },
            },
          },
          execute: async (p) =>
            isArchieToolAllowed(teamRole, 'get_calendar')
              ? readCalendar(mailbox, { from: p.from, to: p.to, limit: p.limit })
              : { error: 'not_permitted' },
        });
      }
      if (isArchieToolAllowed(teamRole, 'search_email')) {
        this.registerTool({
          name: 'search_email',
          description:
            "Search or list the signed-in user's OWN Gmail inbox (internal). Use Gmail search syntax like 'from:kevin', 'is:unread', or 'newer_than:3d'; leave blank for the recent inbox.",
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Gmail search query (optional)' },
              limit: { type: 'number', description: 'Max emails (<=25)' },
            },
          },
          execute: async (p) =>
            isArchieToolAllowed(teamRole, 'search_email')
              ? searchEmail(mailbox, p.query, p.limit)
              : { error: 'not_permitted' },
        });
      }
      if (isArchieToolAllowed(teamRole, 'search_drive')) {
        this.registerTool({
          name: 'search_drive',
          description:
            "Search the signed-in user's OWN Google Drive (internal, read-only). Matches file name and full text; leave blank for recent files. Returns names, types, and links — use read_drive_file to read a file's text.",
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'What to look for (optional)' },
              limit: { type: 'number', description: 'Max files (<=25)' },
            },
          },
          execute: async (p) =>
            isArchieToolAllowed(teamRole, 'search_drive')
              ? searchDrive(mailbox, p.query, p.limit)
              : { error: 'not_permitted' },
        });
      }
      if (isArchieToolAllowed(teamRole, 'read_drive_file')) {
        this.registerTool({
          name: 'read_drive_file',
          description:
            "Read the text of a Google Doc/Sheet/Slides (or plain-text) file from the user's Drive. Pass the fileId from search_drive.",
          parameters: {
            type: 'object',
            properties: { fileId: { type: 'string', description: 'The Drive fileId (from search_drive)' } },
            required: ['fileId'],
          },
          execute: async (p) =>
            isArchieToolAllowed(teamRole, 'read_drive_file')
              ? readDriveFile(mailbox, p.fileId)
              : { error: 'not_permitted' },
        });
      }
    }
  }

  /**
   * The person's own sales world — the toolset the five team specialists had,
   * now in the one assistant. Every tool is scoped through the viewer, so a rep
   * sees their book, a leader their team's, an admin everyone's. Production
   * doesn't get the book (the screens don't show them leads either), and money
   * tools follow the same commission floor as the Commission screen.
   * Returns whether the book was registered.
   */
  private registerBookTools(viewer: AgentViewer | undefined): boolean {
    if (!viewer || !atLeast(this.teamRole, 'sales')) return false;
    const money = canSeeMoney(this.teamRole, 'commissions');
    const jt = new JobTreadClient();
    this.registerTool(myLeadsTool(viewer));
    this.registerTool(pipelineSummaryTool(viewer));
    this.registerTool(projectTool(viewer, { money }));
    this.registerTool(followUpsTool(viewer));
    this.registerTool(createFollowUpTool(viewer));
    this.registerTool(myScheduleTool(viewer));
    this.registerTool(myKpisTool(viewer));
    this.registerTool(lookupJobTool(jt, viewer));
    if (money) {
      this.registerTool(calculateCommissionTool());
      this.registerTool(listCommissionsTool(viewer));
      this.registerTool(jobCommissionsTool(viewer));
    }
    return true;
  }

  /**
   * The NC code/insurance reference, and the company's own website when its
   * profile has one — for everyone, no company data behind them.
   */
  private registerKnowledgeTools(): void {
    const home = referenceIsHomeState(currentProfile());
    this.registerTool({
      name: 'nc_roofing_reference',
      description:
        `A checked reference on NORTH CAROLINA roofing only: which NC building code is in force, shingle/underlayment/flashing/drip-edge rules, reroofing, ventilation, permits (G.S. 160D-1110), contractor licensing (G.S. 87-1), how NC insurance claims work (ACV/RCV, depreciation, supplements, deductibles), NC insurance law (suit deadline, appraisal, unfair claim practices, fraud, public adjusters), door-to-door rules, and NC weather. Each line is tagged [verified], [general] or [check locally]. Pass a topic id (${NC_REFERENCE.map((t) => t.id).join(', ')}) or a free-text query. ${home ? 'Use it before answering any code, permit, licensing or insurance question.' : 'Use it only for jobs in North Carolina; the statutes and code sections do not apply in other states.'}`,
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topic id (optional)', enum: NC_REFERENCE.map((t) => t.id) },
          query: { type: 'string', description: 'The question in plain words (optional)' },
        },
      },
      execute: async (p) => lookupReference({ topic: p.topic, query: p.query }),
    });
    if (companyWebsite()) {
      this.registerTool(searchWebsiteTool());
      this.registerTool(readWebsiteTool());
    }
  }

  // Role-allowed tools are registered in the constructor (role isn't known yet
  // when BaseAgent calls this during super()).
  protected registerTools(): void {}

  // Archie is read-only; skip the exec-bot decision audit log (its agentId=0
  // would violate the agentDecisions FK and 500 the whole chat).
  protected async logDecision(): Promise<void> {}

  toolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  protected getSystemPrompt(): string {
    const profile = currentProfile();
    const company = profile.displayName;
    const trade = profile.trade;
    const home = referenceIsHomeState(profile);
    const site = this.tools.has('search_company_website');
    const stateRules = home
      ? `2. NORTH CAROLINA ${trade.toUpperCase()}: the NC Residential Code, permits, licensing, installation practice,
   estimating and scope, and how NC homeowner insurance claims and NC insurance law work.`
      : `2. ${trade.toUpperCase()} KNOW-HOW: installation practice, estimating and scope, and how homeowner insurance
   claims work. Building code, permit, licensing and insurance law differ by state and county${profile.state ? ` (the company is in ${profile.state})` : ''}:
   give the general rule, say it varies, and tell them to confirm with the local inspector or the carrier. You also
   have a checked North Carolina reference (nc_roofing_reference) — use it only for jobs in North Carolina, and say so.`;
    const referenceRule = home
      ? `- For code, permit, licensing or insurance questions, call nc_roofing_reference first and keep
  its confidence: say "the statute says" for [verified], give the rule for [general], and tell
  them to confirm with the county inspector, the carrier, or the homeowner's policy for
  [check locally]. Cite the section (e.g. "G.S. 160D-1110(c)", "R905.2.8.5"). If something is
  not in the reference, you may answer from your own knowledge but say it is unverified.
  The reference was checked on ${REFERENCE_CHECKED_ON}.`
      : `- For a job in North Carolina, call nc_roofing_reference first and keep its confidence tags
  ([verified], [general], [check locally]); it was checked on ${REFERENCE_CHECKED_ON}. Never apply NC
  statutes or NC code sections to a job in another state.`;
    return `${super.getSystemPrompt()}

You are Archie — the one assistant everyone at ${company} uses, from the owner
to the crew. You are talking with a ${ROLE_LABEL[this.teamRole] || this.teamRole}. You combine three kinds of expertise:
1. THE BUSINESS, live: their leads, jobs, pipeline, follow-ups, schedule, KPIs, commissions,
   inbox, calendar, receivables and JobTread — through your tools, which already return only
   what this person is allowed to see.
${stateRules}
3. THE COMPANY: ${company}'s services, warranties, service area and how we work — from the
   company brief above${site ? ' and the live website (search_company_website / read_company_website_page)' : ''}.

HOW TO ANSWER
- Lead with the answer, then the two or three details that matter. Plain text: short paragraphs
  and "- " bullets, no markdown headers, no tables, no bold.
- Numbers, names, dates and statuses about our work come from tools — never from memory or a
  guess. If a tool errors, say so and answer with what you do have.
${referenceRule}
${site
    ? `- For what ${company} offers or says publicly (services, warranty, financing, prices on
  cost guides, a town or neighborhood page), check the website and give the link.`
    : `- For what ${company} offers that is not in the company brief, say you would need to check with the office.`}
- One job: get_project with the JobTread id from get_my_leads, or a search. When a search is
  ambiguous, list the candidates and ask which one.
- When they agree to a next step with a date, offer to create_follow_up so it lands on their list.
- If they ask for something none of your tools can reach because of their role, say you can't
  share that, and suggest what you can help with. Never hint at data they can't see.

WHAT YOU CAN HELP WITH (all in one place — there are no separate specialists any more)
- Sales coaching from their real book: what's aging, what's stuck in Estimating, overdue
  follow-ups, activity KPIs, the next call to make. Commission math: overhead off the top by
  lead source and job type, then material/labor/other, then half of what's left.
- Customer communication: draft texts (under 320 characters), emails and call talking points
  from the job's real status. Voice: warm, plain, local — sign as the rep, never invent a date,
  price or promise the job data doesn't support, never pressure a homeowner with an open claim.
  Safety issues, active leaks and legal threats go to a manager immediately.
- Production: what's sold but not scheduled, pre-construction readiness, daily logs, what
  blocks the next stage and who owns it.
- Estimating: scope from the inspection (tear-off, underlayment, ice-and-water at eaves and
  valleys, starter, drip edge, ridge vent, flashing, pipe boots, cleanup), good/better/best,
  squares vs price-per-square sanity checks, and supplements that are real and documented.
- Insurance claims: explain ACV/RCV, depreciation, deductibles and mortgage checks in plain
  words; read a carrier scope against ours. Stay on the roof: we document, meet the adjuster,
  and support our scope — we do not negotiate coverage for the homeowner (that is public
  adjusting, which needs a license in most states), and we never waive or rebate a deductible,
  inflate damage, or bill for work we won't do (that is insurance fraud).
- ${trade[0].toUpperCase()}${trade.slice(1)} know-how: materials, failure modes, storm vs. age damage, ventilation, local weather.
- Not legal or tax advice: for a live legal dispute point to the state insurance department or an attorney.

NC REFERENCE TOPICS (pull with nc_roofing_reference${home ? '' : '; North Carolina jobs only'})
${referenceIndex()}

Your chat starts fresh each day. Today's conversation is already in context; for
anything from an earlier day, use recall_past_days (each past day has a saved summary).
If they refer to something you don't see from today ("what did we decide last week?",
"that customer I mentioned"), check recall_past_days before saying you don't know.`;
  }
}

/**
 * Build Archie, the team advisor, for one person. `viewer` scopes the book tools (leads,
 * projects, follow-ups, KPIs, commissions); without it those tools are left
 * out entirely rather than run unscoped.
 */
export function buildArchieForRole(role: TeamRole, userEmail?: string, viewer?: AgentViewer): ArchieAgent {
  const config: AgentConfig = {
    id: 0,
    name: 'Archie',
    role: 'archie',
    title: 'Team Assistant',
    persona: 'A sharp, friendly, experienced pro in the trade who also knows every corner of the company\'s data — equally at home coaching a rep, reading an adjuster\'s scope, or citing the code to an inspector.',
    systemPrompt: 'You help the team with anything: their live business data, the trade, code and insurance, and the company itself.',
    viewer,
  };
  return new ArchieAgent(config, role, userEmail);
}
