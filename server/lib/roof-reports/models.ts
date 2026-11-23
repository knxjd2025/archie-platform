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
  labels: { provider: 'anthropic', id: 'claude-haiku-4-5' },
  measurement: { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  /** Text-only follow-up pass of the enhanced photo analysis (no image sent). */
  enhancement: { provider: 'groq', id: 'llama-3.3-70b-versatile' },
} as const satisfies Record<string, { provider: ModelProvider; id: string }>;

export type ModelRole = keyof typeof ROOF_REPORT_MODELS;

/**
 * Cents per million tokens, input and output. The only prices in the folder.
 *
 * Entered 2026-11-24 from the providers' published list prices as last known
 * to the person who wrote this; no price page was fetched while writing it.
 * The Sonnet figure in particular is NOT confirmed against the current list
 * and must be checked before the cost record is relied on. A model id that is
 * missing here is recorded as 0 cents with priced: false (see the metered
 * call), never guessed.
 */
export const MODEL_PRICES_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  'meta-llama/llama-4-scout-17b-16e-instruct': { input: 11, output: 34 },
  'meta-llama/llama-4-maverick-17b-128e-instruct': { input: 20, output: 60 },
  'gemini-2.5-flash': { input: 30, output: 250 },
  'llama-3.3-70b-versatile': { input: 59, output: 79 },
  'claude-haiku-4-5': { input: 100, output: 500 },
  'claude-sonnet-5': { input: 300, output: 1500 },
};

/** How the photo analysis names its fallback providers in messages and logs. */
export const VISION_PROVIDER_LABELS = {
  google: 'Gemini',
  anthropic: 'Haiku',
} as const;
