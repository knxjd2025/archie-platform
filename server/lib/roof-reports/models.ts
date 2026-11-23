/**
 * The only place the roof reports library names a model.
 *
 * US providers only: Groq, Google and Anthropic. Anything made by a provider
 * outside the United States is deliberately absent. A new provider is closed
 * until it is added here on purpose (module-boundary.test.ts holds this).
 */

export type ModelProvider = 'groq' | 'google' | 'anthropic';

export const US_MODEL_PROVIDERS: readonly ModelProvider[] = ['groq', 'google', 'anthropic'];

export const ROOF_REPORT_MODELS = {
  vision: { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  visionAlternative: { provider: 'groq', id: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
  visionFallback: { provider: 'google', id: 'gemini-2.5-flash' },
  visionLastResort: { provider: 'anthropic', id: 'claude-haiku-4-5' },
  narrative: { provider: 'anthropic', id: 'claude-sonnet-5' },
  /** Rewriting one finding and regenerating the executive summary: short, cheap passes. */
  rewrite: { provider: 'anthropic', id: 'claude-haiku-4-5' },
  labels: { provider: 'anthropic', id: 'claude-haiku-4-5' },
  measurement: { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  /** Text-only follow-up pass of the enhanced photo analysis (no image sent). */
  enhancement: { provider: 'groq', id: 'llama-3.3-70b-versatile' },
} as const satisfies Record<string, { provider: ModelProvider; id: string }>;

export type ModelRole = keyof typeof ROOF_REPORT_MODELS;

/**
 * The role, among `roles`, whose model has exactly this id; null for anything
 * else. A caller that lets a person or a stored option name a model must go
 * through this, so only an id written above can ever be sent to a provider.
 */
export function roleForModelId(id: unknown, roles: readonly ModelRole[]): ModelRole | null {
  if (typeof id !== 'string') return null;
  return roles.find((role) => ROOF_REPORT_MODELS[role].id === id) ?? null;
}

/**
 * Cents per million tokens, input and output. The only prices in the folder.
 *
 * CONFIRMED (2026-11-24, against Anthropic's published model list as served by
 * the claude-api reference, itself cached 2026-11-03): claude-sonnet-5 is $2 in
 * and $10 out per million tokens; claude-haiku-4-5 is $1 in and $5 out.
 * Both ids are current Anthropic ids.
 *
 * UNCONFIRMED, deliberately left without a price: the Groq ids
 * (llama-4-scout, llama-4-maverick, llama-3.3-70b-versatile) and the Google id
 * (gemini-2.5-flash). Neither provider's model page could be fetched while
 * writing this, so whether those ids are still listed, and at what price, is
 * not known. A model id missing here is recorded as 0 cents with
 * priced: false (see the metered call), never guessed. Add each entry only
 * after reading the provider's own page.
 */
export const MODEL_PRICES_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 100, output: 500 },
  'claude-sonnet-5': { input: 200, output: 1000 },
};

/** How the photo analysis names its fallback providers in messages and logs. */
export const VISION_PROVIDER_LABELS = {
  google: 'Gemini',
  anthropic: 'Haiku',
} as const;
