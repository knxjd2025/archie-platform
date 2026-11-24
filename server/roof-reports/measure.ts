/**
 * Finding the roof from a satellite picture while a report is being made:
 *
 *   POST /api/roof-reports/measurements/detect   { address, city, state, zip? }
 *
 * The result only PREFILLS the roof step of the wizard. It is an estimate, told
 * as one, and nothing of it is stored: no report, no photo, no outline. Behind
 * the switch and the sign-in, with the right to make a report (`measure`).
 *
 * The address is the one on the report draft. It is placed on the map by the
 * geocoder, the coordinates are checked to be real numbers, and a picture of
 * that spot is fetched ONLY from the one map host (`satellite-answer.ts` builds
 * the address and checks it again right before the fetch), server side, through
 * the pinned safe download. The map key rides in that address and goes nowhere
 * else: not to the person, not into a log, a cost row or an error record (every
 * failure is logged by its kind only, never its message). The model sees the
 * picture and nothing about the person or the address, and its answer is
 * accepted only if it is exactly what was asked for (`readSatelliteAnswer`);
 * anything else is one plain sentence.
 *
 * Both paid calls (the picture and the model), and the geocoder's, go through the
 * metered path and write a cost row for the company that caused them; a price
 * that is not confirmed in models.ts is recorded as unpriced. The model id is the
 * `measurement` role of models.ts and nowhere else. The whole thing runs under
 * ONE deadline.
 *
 * A company has a daily limit and a request key makes a double press count once;
 * both are held in one locked step (uses.ts, kind 'satellite', migration 0025),
 * before anything is paid for, so presses that arrive together cannot overrun
 * either.
 */
import { createHash } from 'node:crypto';
import type { Router } from 'express';
import {
  BAD_REQUEST_KEY, GEOCODE_FAILED, MAX_SATELLITE_PER_COMPANY_PER_DAY, NEEDS_ADDRESS, NEEDS_CITY_STATE, NOT_TEXT, NOT_FOUND, SATELLITE_CAPPED, SATELLITE_ESTIMATE_NOTE,
  SATELLITE_KEY_REUSED, SATELLITE_NOT_AVAILABLE, SATELLITE_NOT_FOUND, SATELLITE_NO_PICTURE, SATELLITE_REPEAT, SATELLITE_TOO_FAST, TEXT_TOO_LONG, decisionFor,
} from '../../shared/roof-reports';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { googleMapsKey } from '../lib/reports/google-key.js';
import { createDeadline } from '../lib/roof-reports/deadline.js';
import { providerCaller, type ModelCaller } from '../lib/roof-reports/model-call.js';
import { downloadPublicMedia } from '../lib/roof-reports/safe-download.js';
import { geocodeAddress } from '../lib/roof-reports/storm-history-service.js';
import { teamMemberIdByEmail } from '../access/rep-scope';
import { logWrite } from '../writes/log';
import { roofReportUser } from './access';
import { kindOf } from './failure-kind';
import { meteredModelCall, recordServiceCall } from './metered';
import { readRequestKey } from './request-key';
import { DETECT_PROMPT, IMAGE_HEIGHT, IMAGE_WIDTH, assertMapUrl, readSatelliteAnswer, staticMapUrl, validCoordinates } from './satellite-answer';
import { finishUse, reserveUse } from './uses';

export interface Where { address: string; city: string; state: string; zip: string }
export interface Picture { bytes: Buffer; contentType: string }

export interface MeasureOptions {
  /** The map key, or undefined when there is none. Only a test replaces it. */
  mapKey?: () => string | undefined;
  /** Places an address on the map. `paid` is told once for each paid lookup made, so its cost is recorded. Only a test replaces it. */
  geocode?: (where: Where, ctx: { signal: AbortSignal; paid: () => Promise<void>; key: string }) => Promise<{ latitude: number; longitude: number } | null>;
  /** Fetches the picture. Only a test replaces it, with a fake map host: the real one is `defaultFetchImage`. */
  fetchImage?: (url: string, ctx: { timeoutMs: number; signal: AbortSignal }) => Promise<Picture>;
  /** The model to ask, or null when none is set up. Only a test replaces the real one. */
  model?: () => ModelCaller | null;
  /** The daily limit, read on every press. Only a test replaces it. */
  caps?: () => { perCompany: number };
  /** The one deadline, in milliseconds. Only a test replaces it. */
  deadlineMs?: number;
}

/** The use of a press with no report yet: kept under the all-zero report id (the table has one column for a report, and a press has none). */
const NO_REPORT = '00000000-0000-0000-0000-000000000000';
const DEFAULT_DEADLINE_MS = 60_000;
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const MODEL_MAX_TOKENS = 2048;
const PICTURE_TYPES = ['image/jpeg', 'image/png'];

/** The real map host, reached only through the pinned safe download, and only for the one map address. */
export async function defaultFetchImage(url: string, ctx: { timeoutMs: number }): Promise<Picture> {
  assertMapUrl(url);
  const media = await downloadPublicMedia(url, { maxBytes: MAX_PICTURE_BYTES, timeoutMs: ctx.timeoutMs });
  return { bytes: media.bytes, contentType: media.contentType };
}

async function defaultGeocode(where: Where, ctx: { signal: AbortSignal; paid: () => Promise<void>; key: string }): Promise<{ latitude: number; longitude: number } | null> {
  const found = await geocodeAddress(where.address, where.city, where.state, where.zip || undefined, ctx.key, ctx.signal, ctx.paid);
  return found ? { latitude: found.latitude, longitude: found.longitude } : null;
}

/** The real model: the measurement role is Groq's, so without that key there is nothing to ask. */
function defaultModel(): ModelCaller | null {
  const key = process.env.GROQ_API_KEY;
  return key ? providerCaller({ groq: key }) : null;
}

/** What a person is told and with what status; the work stops there. */
class Said extends Error {
  constructor(public readonly status: number, public readonly sentence: string) { super('said'); this.name = 'Said'; }
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function text(v: unknown, max: number): Checked<string> {
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return { ok: false, error: NOT_TEXT };
  const t = v.trim();
  return t.length > max ? { ok: false, error: TEXT_TOO_LONG } : { ok: true, value: t };
}

/** The address from the report draft: exactly these four fields and nothing else (not coordinates, not a company). */
export function parseDetectBody(body: unknown): Checked<Where> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: NEEDS_ADDRESS };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !['address', 'city', 'state', 'zip'].includes(k))) return { ok: false, error: NEEDS_ADDRESS };
  const address = text(b.address, 200); if (!address.ok) return address.error === TEXT_TOO_LONG ? address : { ok: false, error: NEEDS_ADDRESS };
  if (!address.value) return { ok: false, error: NEEDS_ADDRESS };
  const city = text(b.city, 100); if (!city.ok) return city.error === TEXT_TOO_LONG ? city : { ok: false, error: NEEDS_CITY_STATE };
  const state = text(b.state, 50); if (!state.ok) return state.error === TEXT_TOO_LONG ? state : { ok: false, error: NEEDS_CITY_STATE };
  if (!city.value || !state.value) return { ok: false, error: NEEDS_CITY_STATE };
  const zip = text(b.zip, 20); if (!zip.ok) return zip;
  return { ok: true, value: { address: address.value, city: city.value, state: state.value, zip: zip.value } };
}

const fingerprint = (w: Where): string => createHash('sha256').update(JSON.stringify([w.address, w.city, w.state, w.zip].map((s) => s.toLowerCase()))).digest('hex').slice(0, 32);

/** Rejects when the one deadline passes, even for a call that does not look at the signal itself. */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('The time ran out.'));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error('The time ran out.'));
    signal.addEventListener('abort', stop, { once: true });
    work.then((v) => { signal.removeEventListener('abort', stop); resolve(v); }, (e) => { signal.removeEventListener('abort', stop); reject(e); });
  });
}

export function registerMeasureRoute(router: Router, options: MeasureOptions = {}): void {
  const mapKey = options.mapKey ?? googleMapsKey;
  const geocode = options.geocode ?? defaultGeocode;
  const fetchImage = options.fetchImage ?? defaultFetchImage;
  const modelFor = options.model ?? defaultModel;
  const caps = options.caps ?? (() => ({ perCompany: MAX_SATELLITE_PER_COMPANY_PER_DAY }));
  const limiter = rateLimit(30, 10 * 60 * 1000, (_req, res) => { res.status(429).json({ error: SATELLITE_TOO_FAST }); });

  router.post('/measurements/detect', limiter, async (req, res) => {
    const where = 'POST /api/roof-reports/measurements/detect';
    try {
      const user = roofReportUser(req)!;
      if (decisionFor(user.role, 'measure') === 'no') { res.status(404).json({ error: NOT_FOUND }); return; }
      const parsed = parseDetectBody(req.body);
      if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
      const requestKey = readRequestKey(req);
      if (!requestKey.ok) { res.status(400).json({ error: BAD_REQUEST_KEY }); return; }

      // Not set up: nothing is called, nothing is counted.
      const key = mapKey();
      const model = modelFor();
      if (!key || !model) { res.status(422).json({ error: SATELLITE_NOT_AVAILABLE }); return; }

      const limit = caps().perCompany;
      const reserved = await reserveUse({
        kind: 'satellite', reportId: NO_REPORT, memberId: await teamMemberIdByEmail(user.email), key: requestKey.key, hash: fingerprint(parsed.value), perReport: limit, perCompany: limit,
      });
      if (reserved.kind === 'repeat') { res.status(409).json({ error: SATELLITE_REPEAT }); return; }
      if (reserved.kind === 'key_reused') { res.status(409).json({ error: SATELLITE_KEY_REUSED }); return; }
      if (reserved.kind === 'report_capped' || reserved.kind === 'company_capped') { res.status(429).json({ error: SATELLITE_CAPPED }); return; }
      if (reserved.kind !== 'reserved') { res.status(409).json({ error: SATELLITE_NOT_FOUND }); return; }
      const useId = reserved.id;

      // Something paid for has been called: the use counts, even when the answer is no use.
      let paid = false;
      const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
      const startedAt = Date.now();
      const signal = createDeadline(deadlineMs);
      const remaining = (): number => Math.max(1, deadlineMs - (Date.now() - startedAt));
      try {
        // 1. The address on the map, and the coordinates checked to be real.
        const found = await within(geocode(parsed.value, { signal, key, paid: async () => { paid = true; await recordServiceCall({ operation: 'geocode', role: 'geocode', ref: null }); } }), signal)
          .catch((e) => { throw new Said(422, e instanceof Said ? e.sentence : GEOCODE_FAILED); });
        const place = validCoordinates(found?.latitude, found?.longitude);
        if (!place) throw new Said(422, GEOCODE_FAILED);

        // 2. The picture: the one map host only, through the pinned safe download, recorded as a paid call.
        const url = staticMapUrl(place.lat, place.lng, key);
        assertMapUrl(url);
        paid = true;
        const picture = await within(
          meteredModelCall({ operation: 'satellite_image', role: 'staticMap', ref: null }, async () => ({ value: await fetchImage(url, { timeoutMs: remaining(), signal }) })),
          signal,
        ).catch(() => { throw new Said(422, SATELLITE_NO_PICTURE); });
        const mediaType = typeof picture?.contentType === 'string' ? picture.contentType.split(';')[0].trim().toLowerCase() : '';
        if (!Buffer.isBuffer(picture?.bytes) || picture.bytes.length === 0 || !PICTURE_TYPES.includes(mediaType)) throw new Said(422, SATELLITE_NO_PICTURE);

        // 3. The model: the measurement role of models.ts, asked about the picture alone.
        const answer = await within(
          meteredModelCall({ operation: 'measurement_detect', role: 'measurement', ref: null }, async () => {
            const r = await model({
              role: 'measurement', prompt: DETECT_PROMPT, maxTokens: MODEL_MAX_TOKENS, temperature: 0.1, json: true,
              image: { base64: picture.bytes.toString('base64'), mediaType }, timeoutMs: remaining(), signal,
            });
            return { value: r.text, usage: r.usage ? { input: r.usage.inputTokens, output: r.usage.outputTokens } : undefined };
          }),
          signal,
        ).catch(() => { throw new Said(422, SATELLITE_NOT_FOUND); });

        // 4. Only an answer that is exactly what was asked for is used.
        const read = readSatelliteAnswer(answer, place.lat);
        if (!read) throw new Said(422, SATELLITE_NOT_FOUND);

        await finishUse(useId, 'done');
        await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_satellite', targetId: 'satellite', summary: 'roof found from a satellite picture', ok: true, error: null });
        res.json({
          outline: read.finding.outline, facets: read.finding.facets, roofType: read.finding.roofType, confidence: read.finding.confidence,
          estimate: read.estimate, imageSize: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }, note: SATELLITE_ESTIMATE_NOTE,
        });
      } catch (error) {
        try { await finishUse(useId, paid ? 'failed' : 'unused'); } catch { /* the place is let go of after ten minutes anyway */ }
        const sentence = error instanceof Said ? error.sentence : SATELLITE_NOT_FOUND;
        // The kind of failure only: a message can carry the map key's address or a provider's words.
        console.error('[roof-reports] a satellite look-up did not finish:', error instanceof Said ? 'said' : kindOf(error));
        await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_satellite', targetId: 'satellite', summary: 'roof not found from a satellite picture', ok: false, error: error instanceof Said ? 'said' : kindOf(error) });
        res.status(error instanceof Said ? error.status : 422).json({ error: sentence });
      }
    } catch (error) {
      sendFailure(res, error, where, 500, SATELLITE_NOT_FOUND);
    }
  });
}
