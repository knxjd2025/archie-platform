import OpenAI from 'openai';
import { db } from '../db';
import { agents, agentTasks, agentDecisions, messages, conversations } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getKnowledgeService, type KnowledgeCategory } from '../rag/knowledge-service';
import type { AgentViewer } from './viewer';
import { ROLE_LABEL } from '../../shared/rbac';
import { currentProfile } from '../tenant/context';
import { companyBrief } from './advisor-knowledge';

// Types for chat completions (matching OpenAI/Groq format)
export interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ChatCompletionToolCall[];
}

export interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  execute: (params: Record<string, any>) => Promise<any>;
}

export interface AgentConfig {
  id: number;
  name: string;
  role: string;
  title: string;
  persona: string;
  systemPrompt: string;
  /**
   * Who is asking, for tools that must scope their results. Carried on the
   * config rather than a subclass field because registerTools() runs inside
   * BaseAgent's constructor, before subclass fields are initialized — a field
   * would still be undefined when the tools are built.
   * `repNames: null` = unrestricted. See ./viewer.ts.
   */
  viewer?: AgentViewer;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCall[];
}

// LLM configuration - Anthropic Claude for high-stakes advisors, an
// open-weight model (via fal.ai) for the rest — see getProviderForRole below.
// Default: Claude Sonnet 4. Override per agent with ANTHROPIC_MODEL_<ROLE>
// (e.g. ANTHROPIC_MODEL_CEO=claude-opus-4-1-20250805). Global default
// ANTHROPIC_MODEL applies if no role-specific override is set.
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 4096;

// Model selection helper - allows per-agent model override
export function getModelForRole(role: string): string {
  const roleModelKey = `ANTHROPIC_MODEL_${role.toUpperCase()}`;
  if (process.env[roleModelKey]) {
    return process.env[roleModelKey]!;
  }
  return process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL;
}

// ---- Open-model backend (fal.ai-hosted open-weight models) -----------------
// Some advisors run on Claude (highest financial/legal/strategic stakes);
// the rest run on an open-weight model via fal.ai's OpenAI-compatible router
// (same mechanism as server/ai/assist-service.ts — no new integration, just a
// different model slug) for cost and control. Falls back to OpenRouter
// directly if only OPENROUTER_API_KEY is set.
export type AdvisorProvider = 'anthropic' | 'open';

const DEFAULT_PROVIDER_FOR_ROLE: Record<string, AdvisorProvider> = {
  ceo: 'anthropic',
  cfo: 'anthropic',
  cpa: 'anthropic',
  tax_accountant: 'anthropic',
  tax_lawyer: 'anthropic',
  coo: 'open',
  cmo: 'open',
  sales_manager: 'open',
  customer_service: 'open',
  estimator: 'open',
  // Archie, the team advisor — the one assistant everyone uses. Open-weight by
  // decision: it runs on every question from every person, all day.
  archie: 'open',
  project_coordinator: 'open',
};

// Per-role override, e.g. ADVISOR_PROVIDER_CEO=open. Unknown roles fail
// closed to Claude (the safer default when a role isn't in the table).
export function getProviderForRole(role: string): AdvisorProvider {
  const override = process.env[`ADVISOR_PROVIDER_${role.toUpperCase()}`];
  if (override === 'anthropic' || override === 'open') return override;
  return DEFAULT_PROVIDER_FOR_ROLE[role] ?? 'anthropic';
}

// Advisor chat is conversational, not report-grade: Maverick is fast and cheap
// and handles it well. The heavy models are reserved for reports — Qwen3-VL for
// photo analysis, Kimi K2.6 for written copy. Override per role with
// OPEN_MODEL_<ROLE> if one advisor needs more muscle.
const OPEN_DEFAULT_MODEL = 'meta-llama/llama-4-maverick';
const FAL_BASE_URL = 'https://fal.run/openrouter/router/openai/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Archie (the team advisor) is the exception to "Maverick for chat": it is the one
// assistant the whole company leans on, answering code, insurance and
// multi-step data questions, so it gets the strongest open model the app
// already runs (Kimi K2.6, the report-writing model — a reasoning model with
// strong tool use). A global OPEN_MODEL does not override this; only
// OPEN_MODEL_ARCHIE does, so tuning the specialists can't quietly downgrade it.
const OPEN_ROLE_DEFAULT_MODEL: Record<string, string> = {
  archie: 'moonshotai/kimi-k2.6',
};

// OPEN_MODEL_<ROLE> > the role's own default > OPEN_MODEL > default.
export function getOpenModelForRole(role: string): string {
  const roleModelKey = `OPEN_MODEL_${role.toUpperCase()}`;
  if (process.env[roleModelKey]) return process.env[roleModelKey]!;
  return OPEN_ROLE_DEFAULT_MODEL[role] || process.env.OPEN_MODEL || OPEN_DEFAULT_MODEL;
}

/**
 * The model to retry on when the primary open model errors (provider outage,
 * a model slug the router has retired). One retry, then the error stands.
 */
export function getOpenFallbackModel(): string {
  return process.env.OPEN_FALLBACK_MODEL || OPEN_DEFAULT_MODEL;
}

/** Tool-call rounds before the agent must answer with what it has — an open model can loop. */
export const MAX_TOOL_ROUNDS = 8;

// Ceilings on one model call. Neither call had one: fetch() waits as long as
// the socket stays open, and the OpenAI SDK defaults to 10 minutes with two
// retries, so one hung provider held the request until Vercel killed the
// function at 300s and the person got nothing.
const ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS || 90_000);
const OPEN_TIMEOUT_MS = Number(process.env.OPEN_TIMEOUT_MS || 90_000);
// Open models had no max_tokens, so a looping model could generate until the
// timeout. Generous because Kimi K2.6 spends output tokens reasoning first.
const OPEN_MAX_TOKENS = Number(process.env.OPEN_MAX_TOKENS || 8192);

/** Longest tool result handed back to the model, in characters. */
export const MAX_TOOL_RESULT_CHARS = 20_000;

/**
 * Serialize a tool result for the model, cut to `max` characters. A tool that
 * returned a few hundred rows went to the model whole, which blew past the
 * context window and failed the whole chat. The cut ends with a plain note
 * (not re-wrapped in JSON, which would escape every quote and double the size)
 * so the model knows it saw part and can ask for less.
 */
export function toolResultContent(result: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  let s: string;
  try {
    s = JSON.stringify(result) ?? 'null';
  } catch {
    s = JSON.stringify({ error: 'The tool returned something that could not be serialized.' });
  }
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[TRUNCATED: this result was ${s.length} characters and only the first ${max} are shown. Ask again with a narrower filter or a smaller limit if you need the rest.]`;
}

const LOG_TEXT_KEYS = new Set(['message', 'body', 'content', 'text', 'note', 'notes', 'html', 'subject']);
// A US number in any usual spelling (+1 312 555 0199, (312) 555-0199,
// 3125550199). Shaped 3-3-4 so dates and ids are left alone.
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/**
 * Tool arguments as they may appear in server logs. Vercel logs are read by
 * more people than customer data should be: send_sms_to_lead logged the full
 * text, and phone-number arguments were logged as-is. Message bodies become
 * their length; anything shaped like a phone number keeps its last 4 digits.
 */
export function redactForLog(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (LOG_TEXT_KEYS.has(key.toLowerCase())) return `[${value.length} chars]`;
    return value.replace(PHONE_RE, (m) => `***${m.replace(/\D/g, '').slice(-4)}`);
  }
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactForLog(v, k)]));
  }
  return value;
}

/**
 * Should a failed open-model call be retried on the fallback model? Not after
 * a timeout (the person has already waited the full ceiling) and not on a 4xx
 * (the same request fails the same way), except 404, which is how the router
 * answers for a retired model slug, the case the fallback exists for.
 */
export function shouldTryOpenFallback(err: unknown): boolean {
  const e = err as { status?: number; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === 'APIConnectionTimeoutError' || e.name === 'AbortError' || e.name === 'TimeoutError' || /timed? ?out/i.test(e.message || '')) return false;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) return e.status === 404;
  return true;
}

function falKey(): string | undefined {
  return process.env.FAL_AI_API_KEY || process.env.FAL_KEY;
}

function openClient(): OpenAI {
  const fk = falKey();
  if (fk) {
    // fal.ai's OpenAI-compatible endpoint authenticates with `Authorization: Key <FAL_KEY>` (not Bearer).
    return new OpenAI({
      apiKey: 'not-needed',
      baseURL: FAL_BASE_URL,
      defaultHeaders: { Authorization: `Key ${fk}`, 'X-Title': 'Archie' },
    });
  }
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: { 'X-Title': 'Archie' },
  });
}

export abstract class BaseAgent {
  protected apiKey: string;
  protected config: AgentConfig;
  protected tools: Map<string, Tool> = new Map();
  protected model: string;
  protected provider: AdvisorProvider;
  protected knowledgeService = getKnowledgeService();

  constructor(config: AgentConfig) {
    this.config = config;
    this.provider = getProviderForRole(config.role);

    if (this.provider === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.');
      }
      this.apiKey = process.env.ANTHROPIC_API_KEY;
      this.model = getModelForRole(config.role);
      console.log(`[${config.name}] Using Anthropic with model: ${this.model}`);
    } else {
      if (!falKey() && !process.env.OPENROUTER_API_KEY) {
        throw new Error('FAL_AI_API_KEY (or FAL_KEY / OPENROUTER_API_KEY) is not set. Add one to your Vercel environment variables.');
      }
      this.apiKey = '';
      this.model = getOpenModelForRole(config.role);
      console.log(`[${config.name}] Using open model: ${this.model}`);
    }

    this.registerBaseTools(); // Register shared tools first
    this.registerTools();     // Then agent-specific tools
  }

  /**
   * Dispatches to the provider resolved for this advisor's role. Both branches
   * return the same OpenAI-shaped `{ choices: [{ message }] }`, so the
   * tool-calling loop in chat() and every agent subclass are provider-agnostic.
   */
  private async fetchChatCompletion(
    messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: ChatCompletionToolCall[] }>,
    tools?: ChatCompletionTool[],
    toolChoice?: string
  ): Promise<{ choices: Array<{ message: ChatCompletionMessage }> }> {
    return this.provider === 'anthropic'
      ? this.fetchAnthropicChatCompletion(messages, tools, toolChoice)
      : this.fetchOpenChatCompletion(messages, tools, toolChoice);
  }

  /**
   * Chat completion against fal.ai's OpenAI-compatible router (open-weight
   * models — Kimi, GLM, Qwen, Llama, etc. via model slug). messages/tools are
   * already OpenAI-shaped, so this is a near-direct pass-through — no
   * translation layer needed, unlike the Anthropic adapter below.
   */
  private async fetchOpenChatCompletion(
    messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: ChatCompletionToolCall[] }>,
    tools?: ChatCompletionTool[],
    toolChoice?: string
  ): Promise<{ choices: Array<{ message: ChatCompletionMessage }> }> {
    const request = (model: string) => openClient().chat.completions.create({
      model,
      messages: messages as any,
      tools: tools as any,
      tool_choice: (tools && tools.length > 0 ? (toolChoice ?? 'auto') : undefined) as any,
      max_tokens: OPEN_MAX_TOKENS,
    }, { timeout: OPEN_TIMEOUT_MS, maxRetries: 0 });
    let res;
    try {
      res = await request(this.model);
    } catch (err) {
      const fallback = getOpenFallbackModel();
      if (fallback === this.model || !shouldTryOpenFallback(err)) throw err;
      console.warn(`[${this.config.name}] ${this.model} failed, retrying on ${fallback}:`, (err as Error)?.message || err);
      res = await request(fallback);
    }
    const choice = res.choices[0];
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: choice.message.content ?? null,
          tool_calls: (choice.message.tool_calls as unknown as ChatCompletionToolCall[]) || undefined,
        },
      }],
    };
  }

  /**
   * Chat completion against Anthropic's /v1/messages API.
   * Accepts the existing OpenAI-shaped messages/tools/response to minimize
   * churn in the chat loop and tool-calling code — this adapter handles
   * all request/response translation in one place.
   */
  private async fetchAnthropicChatCompletion(
    messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: ChatCompletionToolCall[] }>,
    tools?: ChatCompletionTool[],
    _toolChoice?: string
  ): Promise<{ choices: Array<{ message: ChatCompletionMessage }> }> {
    // 1. Pull out system message(s) — Anthropic takes system as a top-level param
    const systemParts: string[] = [];
    const nonSystem: typeof messages = [];
    for (const m of messages) {
      if (m.role === 'system') {
        if (m.content) systemParts.push(String(m.content));
      } else {
        nonSystem.push(m);
      }
    }
    const systemPrompt = systemParts.join('\n\n');

    // 2. Convert OpenAI messages → Anthropic messages.
    //    Tool results become tool_result content blocks inside a user message;
    //    consecutive tool results coalesce so user/assistant roles still alternate.
    const anthMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];
    for (const m of nonSystem) {
      if (m.role === 'user') {
        // Roles must alternate: a user turn right after tool results joins them.
        const prev = anthMessages[anthMessages.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          prev.content.push({ type: 'text', text: m.content || '' });
        } else {
          anthMessages.push({ role: 'user', content: m.content || '' });
        }
      } else if (m.role === 'assistant') {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls || []) {
          let input: any = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch { /* leave as empty object */ }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
        // If there are no blocks at all, skip — Anthropic rejects empty assistant messages
        if (blocks.length > 0) {
          anthMessages.push({ role: 'assistant', content: blocks });
        }
      } else if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: m.content ?? '',
        };
        const last = anthMessages[anthMessages.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(block);
        } else {
          anthMessages.push({ role: 'user', content: [block] });
        }
      }
    }

    // 3. Convert tool definitions
    const anthTools = (tools || []).map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    // 4. Call Anthropic
    const body: Record<string, any> = {
      model: this.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages: anthMessages,
    };
    if (systemPrompt) body.system = systemPrompt;
    if (anthTools.length > 0) body.tools = anthTools;

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(`Chat completion timed out after ${Math.round(ANTHROPIC_TIMEOUT_MS / 1000)}s`);
      }
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat completion error (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();

    // 5. Convert Anthropic response → OpenAI-shaped message
    let content = '';
    const toolCalls: ChatCompletionToolCall[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text') {
        content += (content ? '\n' : '') + (block.text || '');
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        });
      }
    }

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
      }],
    };
  }

  // Register tools available to all agents (like knowledge base search)
  private registerBaseTools(): void {
    // Knowledge base search tool - available to all agents
    this.registerTool({
      name: 'search_knowledge_base',
      description: 'Search the company knowledge base for information about the company, its services, pricing, service area, policies, scripts, and more. Use this when you need accurate company information to answer questions or make decisions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query - what information are you looking for?',
          },
          categories: {
            type: 'string',
            description: 'Optional: Comma-separated list of categories to search. Options: company, services, pricing, service_area, industry, faq, scripts, competitors, reviews, legal',
          },
        },
        required: ['query'],
      },
      execute: async (params: Record<string, any>) => {
        const { query, categories } = params as { query: string; categories?: string };
        const categoryList = categories
          ? categories.split(',').map(c => c.trim()) as KnowledgeCategory[]
          : undefined;

        const results = await this.knowledgeService.search(query, {
          categories: categoryList,
          limit: 3,
        });

        if (results.length === 0) {
          return { found: false, message: 'No relevant information found in the knowledge base.' };
        }

        return {
          found: true,
          results: results.map(r => ({
            title: r.document.title,
            category: r.document.category,
            relevance: Math.round(r.relevanceScore * 100) + '%',
            content: r.snippet,
          })),
        };
      },
    });
  }

  /**
   * Get context from knowledge base for a user query
   * Called automatically before chat to enrich the system prompt
   */
  protected async getKnowledgeContext(query: string): Promise<string> {
    try {
      return await this.knowledgeService.getContextForQuery(query, this.config.id);
    } catch (error) {
      console.error(`[${this.config.name}] Knowledge retrieval error:`, error);
      return '';
    }
  }

  // Subclasses must implement this to register their tools
  protected abstract registerTools(): void;

  // Get the full system prompt including persona and context
  protected getSystemPrompt(): string {
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Who is on the other side of the chat. The tools are already scoped to
    // them, so the advisor can use them freely and address the person by name.
    const v = this.config.viewer;
    const viewerLine = v?.name
      ? `\nYou are talking with ${v.name}${v.role ? ` (${ROLE_LABEL[v.role] || v.role})` : ''}. Every tool you have already returns only what ${v.name} is allowed to see, so use them freely and speak to their own work directly. Never guess a number a tool can fetch.\n`
      : '';

    // The company comes from its profile when the prompt is built, so an
    // edit to the profile reaches the next chat without re-seeding.
    const company = currentProfile();
    const where = company.cityState ? ` based in ${company.cityState}` : '';
    const serviceArea = company.serviceArea ? `\n- The company's service area: ${company.serviceArea}` : '';

    return `${this.config.systemPrompt}

You are ${this.config.name}, the ${this.config.title} at ${company.legalName}, a ${company.trade} company${where}.

${this.config.persona}
${viewerLine}
Today's date is ${currentDate}.

IMPORTANT GUIDELINES:
- Always be professional and helpful
- Make decisions based on data when available
- Log important decisions with clear reasoning
- Coordinate with other agents when needed
- Prioritize customer satisfaction and business growth${serviceArea}
- Never state a company fact (warranty, certification, price, service area, years in business) that is not in the company brief below or the knowledge base. If the two disagree, the brief is current.

When using tools, always explain what you're doing and why.

${companyBrief(company)}`;
  }

  // Register a tool that the agent can use
  protected registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  // Convert tools to OpenAI/Groq format
  protected getOpenAITools(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  // Process a message and generate a response
  async chat(
    userMessage: string,
    conversationHistory: AgentMessage[] = [],
    options: { includeKnowledgeContext?: boolean } = {}
  ): Promise<{ response: string; toolsUsed: string[] }> {
    const toolsUsed: string[] = [];
    const { includeKnowledgeContext = true } = options;

    // Get relevant knowledge context for the query
    let knowledgeContext = '';
    if (includeKnowledgeContext) {
      knowledgeContext = await this.getKnowledgeContext(userMessage);
    }

    // Build system prompt with knowledge context
    const systemPromptWithContext = knowledgeContext
      ? this.getSystemPrompt() + knowledgeContext
      : this.getSystemPrompt();

    // Build messages array
    const chatMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: ChatCompletionToolCall[] }> = [
      { role: 'system', content: systemPromptWithContext },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Initial API call using fetch
    const tools = this.getOpenAITools();
    let response = await this.fetchChatCompletion(
      chatMessages,
      tools.length > 0 ? tools : undefined,
      tools.length > 0 ? 'auto' : undefined
    );

    let assistantMessage = response.choices[0].message;

    // Handle tool calls in a loop (for multi-step reasoning). Bounded: an open
    // model can keep calling tools; after MAX_TOOL_ROUNDS it must answer.
    let rounds = 0;
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      if (rounds >= MAX_TOOL_ROUNDS) {
        if (assistantMessage.content) chatMessages.push({ role: 'assistant', content: assistantMessage.content });
        chatMessages.push({ role: 'user', content: 'Stop calling tools now. Answer with what you have found so far, and say plainly what you could not check.' });
        response = await this.fetchChatCompletion(chatMessages);
        assistantMessage = response.choices[0].message;
        break;
      }
      rounds++;
      // Add assistant's message with tool calls
      chatMessages.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls,
      });

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const tool = this.tools.get(toolCall.function.name);
        // A made-up tool name or malformed arguments go back to the model as
        // an error it can correct, rather than failing the whole chat.
        if (!tool) {
          chatMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `There is no tool called "${toolCall.function.name}". Use only the tools you were given.` }),
          });
          continue;
        }
        let args: Record<string, any>;
        try {
          const parsed = JSON.parse(toolCall.function.arguments || '{}');
          args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
          chatMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: 'The arguments were not valid JSON. Call the tool again with a JSON object.' }),
          });
          continue;
        }

        toolsUsed.push(toolCall.function.name);
        console.log(`[${this.config.name}] Executing tool: ${toolCall.function.name}`, redactForLog(args));

        let result: unknown;
        try {
          result = await tool.execute(args);
        } catch (error: any) {
          console.error(`Tool execution error:`, error);
          chatMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message }),
          });
          continue;
        }

        // The result goes to the model before the audit write, and the audit
        // write has its own catch. Both used to share one try, so when
        // logDecision failed after a tool had already sent an SMS or created
        // an invoice, the model was told the tool errored, called it again,
        // and the customer got a second text or a second invoice.
        chatMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResultContent(result),
        });

        try {
          let resultText = '';
          try { resultText = JSON.stringify(result) ?? ''; } catch { resultText = '[unserializable]'; }
          await this.logDecision(
            `Tool call: ${toolCall.function.name}`,
            `Executed with args: ${JSON.stringify(args)}`,
            `Result: ${resultText.substring(0, 500)}`
          );
        } catch (e: any) {
          console.warn(`[${this.config.name}] could not log decision for ${toolCall.function.name}:`, e?.message || e);
        }
      }

      // Get next response
      response = await this.fetchChatCompletion(
        chatMessages,
        this.getOpenAITools(),
        'auto'
      );

      assistantMessage = response.choices[0].message;
    }

    return {
      response: assistantMessage.content || 'I apologize, I was unable to generate a response.',
      toolsUsed,
    };
  }

  // Execute a specific task
  async executeTask(taskType: string, payload: Record<string, any>): Promise<any> {
    // Create task record
    const [task] = await db
      .insert(agentTasks)
      .values({
        agentId: this.config.id,
        type: taskType,
        payload,
        status: 'in_progress',
        startedAt: new Date(),
      })
      .returning();

    try {
      // Generate a prompt for the task
      const taskPrompt = this.buildTaskPrompt(taskType, payload);

      // Execute via chat
      const { response, toolsUsed } = await this.chat(taskPrompt);

      // Update task as completed
      await db
        .update(agentTasks)
        .set({
          status: 'completed',
          result: { response, toolsUsed },
          completedAt: new Date(),
        })
        .where(eq(agentTasks.id, task.id));

      return { success: true, response, toolsUsed };
    } catch (error: any) {
      // Update task as failed
      await db
        .update(agentTasks)
        .set({
          status: 'failed',
          error: error.message,
          completedAt: new Date(),
        })
        .where(eq(agentTasks.id, task.id));

      return { success: false, error: error.message };
    }
  }

  // Build a prompt for a specific task type
  protected buildTaskPrompt(taskType: string, payload: Record<string, any>): string {
    // Override in subclasses for task-specific prompts
    return `Please execute the following task: ${taskType}\n\nDetails: ${JSON.stringify(payload, null, 2)}`;
  }

  // Log an agent decision for audit trail.
  //
  // Never throws. Tools call this right after a side effect (cfo-agent's
  // send_payment_reminder and create_invoice, cmo-agent's qualify_lead), inside
  // their own try, so a failed audit insert turned a reminder that had been
  // sent into { success: false } and the model sent it again.
  protected async logDecision(
    context: string,
    decision: string,
    reasoning?: string,
    confidence?: number
  ): Promise<void> {
    try {
      await db.insert(agentDecisions).values({
        agentId: this.config.id,
        context,
        decision,
        reasoning,
        confidence: confidence?.toString(),
      });
    } catch (e: any) {
      console.warn(`[${this.config.name}] could not record a decision:`, e?.message || e);
    }
  }

  // Get agent info
  getInfo(): AgentConfig {
    return this.config;
  }
}

// Helper to convert DB row to AgentConfig
function toAgentConfig(row: any): AgentConfig {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    title: row.title,
    persona: row.persona,
    systemPrompt: row.systemPrompt,
  };
}

// Agent factory to create agents by role
export async function createAgent(role: string, viewer?: AgentViewer): Promise<BaseAgent | null> {
  const [agentRow] = await db
    .select()
    .from(agents)
    .where(eq(agents.role, role as any));

  if (!agentRow) {
    console.error(`No agent found for role: ${role}`);
    return null;
  }

  const agentConfig = { ...toAgentConfig(agentRow), viewer };

  // Import the appropriate agent class based on role
  switch (role) {
    case 'cmo':
      const { CMOAgent } = await import('./cmo-agent');
      return new CMOAgent(agentConfig);
    case 'ceo':
      const { CEOAgent } = await import('./ceo-agent');
      return new CEOAgent(agentConfig);
    case 'cfo':
      const { CFOAgent } = await import('./cfo-agent');
      return new CFOAgent(agentConfig);
    case 'cpa':
      const { CPAAgent } = await import('./cpa-agent');
      return new CPAAgent(agentConfig);
    case 'tax_accountant':
      const { TaxAccountantAgent } = await import('./tax-accountant-agent');
      return new TaxAccountantAgent(agentConfig);
    case 'tax_lawyer':
      const { TaxLawyerAgent } = await import('./tax-lawyer-agent');
      return new TaxLawyerAgent(agentConfig);
    case 'sales_manager': {
      const { SalesManagerAgent } = await import('./team-agents');
      return new SalesManagerAgent(agentConfig);
    }
    case 'customer_service': {
      const { CustomerServiceAgent } = await import('./team-agents');
      return new CustomerServiceAgent(agentConfig);
    }
    case 'coo': {
      const { COOAgent } = await import('./team-agents');
      return new COOAgent(agentConfig);
    }
    case 'project_coordinator': {
      const { ProjectCoordinatorAgent } = await import('./team-agents');
      return new ProjectCoordinatorAgent(agentConfig);
    }
    case 'estimator': {
      const { EstimatorAgent } = await import('./team-agents');
      return new EstimatorAgent(agentConfig);
    }
    default:
      console.error(`Unknown agent role: ${role}`);
      return null;
  }
}

export { toAgentConfig };
