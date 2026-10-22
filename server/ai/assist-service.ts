import OpenAI from 'openai';
import { currentProfile } from '../tenant/context';

// Open-source model access via an OpenAI-compatible router. Prefer fal.ai (uses
// the existing FAL_KEY; its LLM router is powered by OpenRouter's catalog, so the
// same model slugs work) and fall back to OpenRouter if only that key is set.
// Model is env-switchable — default Kimi K2.6; set WRITING_MODEL to e.g. z-ai/glm-4.6.
const FAL_BASE_URL = 'https://fal.run/openrouter/router/openai/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const WRITING_MODEL = process.env.WRITING_MODEL || 'moonshotai/kimi-k2.6';

// Accept either FAL_AI_API_KEY (the name set in Vercel) or FAL_KEY.
const falKey = (): string | undefined => process.env.FAL_AI_API_KEY || process.env.FAL_KEY;

export function assistConfigured(): boolean {
  return !!(falKey() || process.env.OPENROUTER_API_KEY);
}

/**
 * Shared fal.ai/OpenRouter client. Exported so other modules that talk to the
 * writing model (estimate-chat.ts's line-item and doc-builder chats) go
 * through the same FAL-first, OpenRouter-fallback resolution as everything
 * else here — a module that built its own client hardcoded to OPENROUTER_API_KEY
 * silently broke in production, where only FAL_AI_API_KEY is set.
 */
export function client(): OpenAI {
  // fal.ai's OpenAI-compatible endpoint authenticates with `Authorization: Key <FAL_KEY>`
  // (NOT Bearer); defaultHeaders override the SDK's default auth header.
  const fk = falKey();
  if (fk) {
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

/** "Acme Roofing, a roofing company in Springfield, IL" — only the parts the profile has. */
function companyLine(): string {
  const p = currentProfile();
  return `${p.displayName}, a ${p.trade} company${p.cityState ? ` in ${p.cityState}` : ''}`;
}

/**
 * The company's customer voice — the guardrail for every drafted message.
 * Built per call from the company's profile.
 */
export function voiceSystem(): string {
  const p = currentProfile();
  return `You write customer messages for ${companyLine()}, on behalf of the team member sending them.
Voice: warm, friendly, professional, concise, and human — like a trusted local ${p.trade} pro, not a corporate bot.
Rules:
- Never invent prices, dates, measurements, warranties, or commitments. If you don't have a fact, keep it general or say you'll confirm.
- Do not pressure a customer who has an active insurance claim.
- For text messages: short and plain — no markdown, no subject line, no email signature.
- For emails: you may add a simple sign-off like "— The ${p.displayName} team".
- Output ONLY the message text. No preamble, no quotes, no explanation.`;
}

// Every helper below has a person waiting on it (or the nightly summary job's
// time budget). Without an explicit timeout the SDK waits 10 minutes and then
// retries twice — a hung router held a Vercel function until it was killed at
// 300s. Retries stay off: the SDK retries timeouts too, doubling the wait.
const ASSIST_TIMEOUT_MS = Number(process.env.ASSIST_TIMEOUT_MS || 60_000);

// kimi-k2.6 is a reasoning model: it spends output tokens "thinking" before the
// answer. The ceiling must cover reasoning + the reply, or content comes back
// empty. Keep it generous — short messages only use what they need.
async function chat(system: string, user: string, maxTokens = 1800, timeoutMs = ASSIST_TIMEOUT_MS): Promise<string> {
  const res = await client().chat.completions.create({
    model: WRITING_MODEL,
    temperature: 0.6,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }, { timeout: timeoutMs, maxRetries: 0 });
  // `reasoning` holds the model's private chain-of-thought — never surface it.
  return (res.choices?.[0]?.message?.content || '').trim();
}

type TextResult = { text: string } | { error: string };
const NOT_CONFIGURED = { error: 'AI not configured — add OPENROUTER_API_KEY to enable it.' };

const summarySystem = (): string => `You summarize one day of an internal work chat between a ${currentProfile().displayName} team member and their AI assistant.
Write a compact daily record the assistant can re-read weeks later to recall what happened.
Rules:
- 3-8 short bullets, plain text (use "- " for bullets). No preamble, no closing line.
- Capture: what they asked about, key numbers/names/addresses mentioned, decisions made, and anything left open or promised.
- Keep concrete details (customer names, dollar amounts, dates). Drop chit-chat and repetition.
- If the day was trivial, one bullet is fine. Never invent anything that isn't in the transcript.`;

/**
 * Summarize a day's chat transcript for long-term recall. Returns null when the
 * AI isn't configured, the call fails or times out, or the model gives nothing
 * back. Callers check assistConfigured() to tell "never possible" (store a
 * fallback) from "failed this time" (retry later).
 */
export async function summarizeConversation(transcript: string, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  if (!assistConfigured() || !transcript.trim()) return null;
  try {
    const text = await chat(summarySystem(), `Transcript:\n\n${transcript}`, 1200, opts.timeoutMs ?? ASSIST_TIMEOUT_MS);
    return text.trim() || null;
  } catch {
    return null;
  }
}

export async function draftReply(p: { contactName: string; channel: string; recentMessages: string }): Promise<TextResult> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const text = await chat(
      voiceSystem(),
      `You are drafting the next ${p.channel} message to send to ${p.contactName || 'the customer'}.\n\nRecent conversation (most recent last):\n${p.recentMessages || '(no earlier messages yet — write a warm, helpful check-in)'}\n\nReply with ONLY the message text to send now — friendly and helpful. Do not leave it blank.`,
    );
    return { text };
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}

export async function fromInstruction(p: { contactName: string; channel: string; instruction: string; recentMessages?: string }): Promise<TextResult> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const ctx = p.recentMessages ? `\n\nFor context, recent conversation:\n${p.recentMessages}` : '';
    const text = await chat(
      voiceSystem(),
      `Write a ${p.channel} message to ${p.contactName || 'the customer'}. What to say: ${p.instruction}${ctx}`,
    );
    return { text };
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}

export async function polish(p: { text: string; channel: string }): Promise<TextResult> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const text = await chat(
      voiceSystem(),
      `Polish this ${p.channel} message — fix grammar and tone, keep the meaning. Return only the improved message:\n\n${p.text}`,
    );
    return { text };
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}

const TONE_MAP: Record<string, string> = {
  friendlier: 'warmer and friendlier',
  shorter: 'shorter and more to the point',
  formal: 'a bit more formal and professional',
};
export function isValidTone(t: string): boolean {
  // Own keys only: `in` let 'constructor' through, and the rewrite prompt asked
  // for the message to be "function Object() { [native code] }".
  return Object.hasOwn(TONE_MAP, t);
}

export async function adjustTone(p: { text: string; tone: string; channel: string }): Promise<TextResult> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  if (!isValidTone(p.tone)) return { error: `Unknown tone "${p.tone}"` };
  try {
    const text = await chat(
      voiceSystem(),
      `Rewrite this ${p.channel} message to be ${TONE_MAP[p.tone]}. Keep the meaning. Return only the message:\n\n${p.text}`,
    );
    return { text };
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}

// ---- Email security rating (defensive) --------------------------------------

export interface EmailRisk {
  risk: 'safe' | 'suspicious' | 'dangerous';
  score: number; // 0-100
  reasons: string[];
}

const SECURITY_SYSTEM = `You are an email security analyst. Assess an email for signs of phishing, sender spoofing, malicious or mismatched links, social engineering, and credential/payment fraud (fake invoices, wire-change requests, gift-card asks).
Return ONLY compact JSON: {"risk":"safe|suspicious|dangerous","score":0-100,"reasons":["short reason", ...]}.
score is 0 (clearly safe) to 100 (clearly malicious). Keep reasons short and specific. No text outside the JSON.`;

export function parseEmailRisk(raw: string): EmailRisk {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw);
    const risk = obj.risk === 'safe' || obj.risk === 'dangerous' ? obj.risk : 'suspicious';
    const score = Number.isFinite(obj.score) ? Math.max(0, Math.min(100, Math.round(obj.score))) : 50;
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.map((r: any) => String(r)).slice(0, 8) : [];
    return { risk, score, reasons };
  } catch {
    // Fail toward caution — never say "safe" when we couldn't parse.
    return { risk: 'suspicious', score: 50, reasons: ['Could not fully analyze this email.'] };
  }
}

// ---- Lead detection from email ---------------------------------------------

export interface LeadSignal {
  isLead: boolean;
  confidence: number; // 0-100
  name: string;
  service: string; // e.g. "Roof replacement", "Repair", "Inspection", "Insurance claim"
  summary: string;
}

const leadSystem = (): string => `You screen inbound emails for ${companyLine()}, to find NEW CUSTOMER LEADS — a person or business asking about ${currentProfile().trade === 'roofing' ? 'roof repair, replacement, inspection, a quote/estimate, storm/hail damage, or insurance-claim help' : `${currentProfile().trade} repair, replacement, installation, service, a quote/estimate, or insurance-claim help`} for THEIR OWN property.
NOT leads: vendor/supplier emails, invoices/bills, newsletters, marketing, job boards / bid invites (PlanHub, BuildingConnected), Google Alerts, internal team email, calendar/meeting notices, receipts, spam.
Return ONLY compact JSON: {"isLead":true|false,"confidence":0-100,"name":"person or company","service":"short label","summary":"one short line on what they want"}. No text outside the JSON.`;

export function parseLeadSignal(raw: string): LeadSignal {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : raw);
    return {
      isLead: o.isLead === true,
      confidence: Number.isFinite(o.confidence) ? Math.max(0, Math.min(100, Math.round(o.confidence))) : 0,
      name: String(o.name || '').slice(0, 120),
      service: String(o.service || '').slice(0, 60),
      summary: String(o.summary || '').slice(0, 200),
    };
  } catch {
    return { isLead: false, confidence: 0, name: '', service: '', summary: '' };
  }
}

export async function classifyLead(p: { from: string; subject: string; body: string }): Promise<LeadSignal | { error: string }> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const raw = await chat(
      leadSystem(),
      `From: ${p.from || '(unknown)'}\nSubject: ${p.subject || '(none)'}\nBody:\n${(p.body || '').slice(0, 3000)}`,
    );
    return parseLeadSignal(raw);
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}

export async function rateEmailSecurity(p: { from: string; subject: string; body: string }): Promise<EmailRisk | { error: string }> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const raw = await chat(
      SECURITY_SYSTEM,
      `From: ${p.from || '(unknown)'}\nSubject: ${p.subject || '(none)'}\nBody:\n${(p.body || '').slice(0, 4000)}`,
    );
    return parseEmailRisk(raw);
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}


/**
 * One turn of report-refinement conversation. Returns the raw model reply for
 * the caller to parse — the report layer owns what a patch may contain.
 */
const REFINE_TIMEOUT_MS = Number(process.env.REFINE_TIMEOUT_MS || 75_000);

export async function refineReport(p: { instruction: string; editable: string; transcript?: string; system: string }): Promise<TextResult> {
  if (!assistConfigured()) return NOT_CONFIGURED;
  try {
    const user = [
      p.transcript ? `Conversation so far:\n${p.transcript}` : '',
      `Editable content of the report:\n${p.editable}`,
      `The rep asks: ${p.instruction}`,
    ].filter(Boolean).join('\n\n');
    // Report edits must be literal, not creative — much lower temperature than
    // the customer-message helpers above.
    //
    // A person is waiting on this one, so it is bounded: without an explicit
    // timeout the SDK waits 10 minutes and the request just hangs. Retries are
    // off for the same reason — a retry doubles an already-slow turn.
    const res = await client().chat.completions.create({
      model: WRITING_MODEL,
      temperature: 0.2,
      max_tokens: 2400,
      messages: [{ role: 'system', content: p.system }, { role: 'user', content: user }],
    }, { timeout: REFINE_TIMEOUT_MS, maxRetries: 0 });
    const text = (res.choices?.[0]?.message?.content || '').trim();
    return text ? { text } : { error: 'The model returned an empty response.' };
  } catch (e: any) {
    const msg = String(e?.message || 'AI request failed');
    if (/timeout|aborted/i.test(msg)) return { error: 'That took too long to come back. Try a shorter, more specific instruction.' };
    return { error: msg };
  }
}
