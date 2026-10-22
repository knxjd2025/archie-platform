import { describe, it, expect } from 'vitest';
import { visionModelChain, isModelUnavailable, isRetryableModelFailure, GROQ_VISION_MODELS } from '../groq-vision';

// A model that's retired or not enabled on the account fails for EVERY image,
// which silently turned entire reports into "no damage detected". The chain
// keeps the inspection working instead of losing it.
describe('vision model fallback', () => {
  it('tries the preferred model first, then falls back', () => {
    const chain = visionModelChain();
    expect(chain[0]).toBe(GROQ_VISION_MODELS.LLAMA4_MAVERICK);
    expect(chain).toContain(GROQ_VISION_MODELS.LLAMA4_SCOUT);
  });

  it('honours an explicit model but still keeps fallbacks behind it', () => {
    const chain = visionModelChain(GROQ_VISION_MODELS.LLAMA4_SCOUT);
    expect(chain[0]).toBe(GROQ_VISION_MODELS.LLAMA4_SCOUT);
    expect(chain).toContain(GROQ_VISION_MODELS.LLAMA4_MAVERICK);
  });

  it('never repeats a model', () => {
    const chain = visionModelChain(GROQ_VISION_MODELS.LLAMA4_MAVERICK);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('recognises a model-availability failure', () => {
    expect(isModelUnavailable('Analysis failed: Groq API error: 404 - {"error":{"code":"model_not_found"}}')).toBe(true);
    expect(isModelUnavailable('model has been decommissioned')).toBe(true);
    expect(isModelUnavailable('Groq API error: 400 - bad request')).toBe(true);
  });

  it('does not treat a rate limit or timeout as a model problem', () => {
    // Walking the chain on a 429 would just burn quota on another model.
    expect(isModelUnavailable('Groq API error: 429 - rate limit exceeded')).toBe(false);
    expect(isModelUnavailable('groq-vision timed out after 45000ms')).toBe(false);
  });
});

// A model that replies but can't produce parseable JSON is useless for a report.
// Treating that as fatal (rather than "try the next model") is what let a single
// chatty model empty an entire inspection.
describe('retryable model failures', () => {
  it('retries when the response cannot be parsed', () => {
    expect(isRetryableModelFailure('Analysis failed: Could not parse AI response. Trying fallback...')).toBe(true);
    expect(isRetryableModelFailure('Vision API returned an empty response')).toBe(true);
  });

  it('still retries on an unavailable model', () => {
    expect(isRetryableModelFailure('Vision API error: 404 - model_not_found')).toBe(true);
  });

  it('does not retry on a bad photo or a rate limit', () => {
    // These fail identically on every model — walking the list just wastes money.
    expect(isRetryableModelFailure('Received 403 status code when fetching image from URL')).toBe(false);
    // A 400 here reads like a model error but is the image — must not walk the chain.
    expect(isRetryableModelFailure('Received 400 status code when fetching image from URL: https://x/y.jpg')).toBe(false);
    expect(isRetryableModelFailure('Vision API error: 429 - rate limit exceeded')).toBe(false);
  });
});
