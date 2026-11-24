/**
 * metered.ts: one cost row for every paid model call the roof reports make.
 *
 * Every call goes through `meteredModelCall`. It refuses a provider that is
 * not on the United States list before calling anything, runs the call, and
 * writes one `model_costs` row for the current company whether the call
 * succeeded or threw. A call that failed but was still billed (the error
 * carries the usage the provider reported) is recorded with that usage.
 *
 * A model whose price is not confirmed in models.ts is recorded with its
 * tokens, 0 cents and `priced: false`: never a guessed number. NOAA and IEM
 * are free and are not recorded.
 *
 * A row that cannot be written never fails the call. The failure is logged by
 * its kind only (a database code or an error name): never a message, a value,
 * a company or a report.
 */

import { db } from '../db';
import { modelCosts } from '../../shared/schema';
import {
  MODEL_PRICES_CENTS_PER_MTOK,
  ROOF_REPORT_MODELS,
  US_MODEL_PROVIDERS,
  type ModelRole,
} from '../lib/roof-reports/models.js';
import type { ModelCaller } from '../lib/roof-reports/model-call.js';

export type CostOperation =
  | 'photo_analysis'
  | 'narrative'
  | 'photo_labels'
  | 'rewrite'
  | 'measurement_detect'
  | 'satellite_image'
  | 'geocode';

/** The Google Static Maps picture the satellite measurement looks at. It has no model id and no confirmed price. */
const STATIC_MAP = { provider: 'google', id: 'google-static-maps' } as const;

/** The Google Geocoding lookup the storm step places the address with. A paid service, not a model: no model id and no confirmed price. */
const GEOCODING = { provider: 'google', id: 'google-geocoding' } as const;

export interface MeteredInput {
  operation: CostOperation;
  role: ModelRole | 'staticMap' | 'geocode';
  /** The report the call is for, when there is one. */
  ref: string | null;
}

export interface Usage { input: number; output: number }

/** A provider outside the United States list was asked for. Nothing was called. */
export class NotUsProviderError extends Error {
  constructor() {
    super('That model provider is not allowed for roof reports.');
    this.name = 'NotUsProviderError';
  }
}

/** Cents for one call, from the only price list (models.ts). An unknown model, or tokens not reported, is unpriced. */
export function estimateCents(modelId: string, usage: Usage | undefined): { cents: number; priced: boolean } {
  const price = MODEL_PRICES_CENTS_PER_MTOK[modelId];
  if (!price || !usage) return { cents: 0, priced: false };
  const cents = (usage.input * price.input + usage.output * price.output) / 1_000_000;
  return { cents: Math.round(cents * 10_000) / 10_000, priced: true };
}

function whoIs(role: MeteredInput['role']): { provider: string; id: string } {
  return role === 'staticMap' ? STATIC_MAP : role === 'geocode' ? GEOCODING : ROOF_REPORT_MODELS[role];
}

function tokenCount(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Token counts in either shape the library uses ({input, output} or {inputTokens, outputTokens}). */
function readUsage(value: unknown): Usage | undefined {
  const u = value as { input?: unknown; output?: unknown; inputTokens?: unknown; outputTokens?: unknown } | null | undefined;
  const input = tokenCount(u?.input ?? u?.inputTokens);
  const output = tokenCount(u?.output ?? u?.outputTokens);
  return input === null || output === null ? undefined : { input, output };
}

/** What kind of failure this was, for a log line: a database code or an error name. Never its message. */
function kindOf(error: unknown): string {
  const e = error as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string' && /^[\w.-]{1,16}$/.test(code)) return code;
  return typeof e?.name === 'string' && /^\w{1,40}$/.test(e.name) ? e.name : 'unknown';
}

async function writeCost(input: MeteredInput, who: { provider: string; id: string }, usage: Usage | undefined, threw: boolean): Promise<void> {
  try {
    const estimate = estimateCents(who.id, usage);
    // A call that threw and reported nothing cost nothing we can see: when the
    // model's price is known, 0 there means 0. A call that succeeded but did
    // not report its tokens cannot be priced.
    const priced = usage ? estimate.priced : threw && MODEL_PRICES_CENTS_PER_MTOK[who.id] !== undefined;
    await db.insert(modelCosts).values({
      operation: input.operation,
      provider: who.provider,
      model: who.id,
      inputTokens: usage?.input ?? null,
      outputTokens: usage?.output ?? null,
      cents: estimate.cents.toFixed(4),
      priced,
      ref: input.ref,
    });
  } catch (error) {
    console.warn('[roof-reports] a cost row could not be written', kindOf(error));
  }
}

/**
 * Run one paid call and record what it cost for the company in context.
 * Returns the call's value; rethrows the call's own error after recording it.
 */
export async function meteredModelCall<T>(
  input: MeteredInput,
  call: () => Promise<{ value: T; usage?: Usage }>,
): Promise<T> {
  const who = whoIs(input.role);
  if (!(US_MODEL_PROVIDERS as readonly string[]).includes(who.provider)) throw new NotUsProviderError();
  let result: { value: T; usage?: Usage };
  try {
    result = await call();
  } catch (error) {
    // A failure that was still billed carries the usage the provider reported.
    await writeCost(input, who, readUsage((error as { usage?: unknown } | null)?.usage), true);
    throw error;
  }
  await writeCost(input, who, readUsage(result.usage), false);
  return result.value;
}

/**
 * Records one paid call that is not a model call and has no tokens (today, the
 * Google geocoding lookup), for the company in context. The same provider list
 * and the same price list apply: a service with no confirmed price is recorded
 * as unpriced (0 cents, `priced = false`), never a guess. Like every cost row,
 * a row that cannot be written is logged by its kind and never fails the work.
 */
export async function recordServiceCall(input: MeteredInput): Promise<void> {
  const who = whoIs(input.role);
  if (!(US_MODEL_PROVIDERS as readonly string[]).includes(who.provider)) throw new NotUsProviderError();
  await writeCost(input, who, undefined, false);
}

/**
 * The seam the narrative and the photo labels already use (model-call.ts):
 * wraps any `ModelCaller` so each call it makes is recorded. The model comes
 * from the request's role.
 */
export function meteredModelCaller(base: ModelCaller, meta: { operation: CostOperation; ref: string | null }): ModelCaller {
  return (request) => meteredModelCall(
    { operation: meta.operation, role: request.role, ref: meta.ref },
    async () => {
      const result = await base(request);
      return { value: result, usage: readUsage(result.usage) };
    },
  );
}
