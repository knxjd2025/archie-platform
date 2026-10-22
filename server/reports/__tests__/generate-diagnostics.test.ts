import { describe, it, expect } from 'vitest';
import { countAnalyzedPhotos, configStatus, visionConfigured, ASSESSES_DAMAGE, VALID_TYPES, imageAnalysisEnabled } from '../generate-local';

// A report that examined zero photos still renders — and reads as "no damage".
// That's a claim a rep could put in front of a customer, so the gap has to be
// counted and surfaced rather than silently passing as a clean inspection.
describe('report photo-analysis diagnostics', () => {
  it('counts the photos the engine actually analysed', () => {
    expect(countAnalyzedPhotos({ photos: [{ id: 'photo-0' }, { id: 'photo-1' }] })).toBe(2);
    expect(countAnalyzedPhotos({ analyzedPhotos: [{ id: 'photo-0' }] })).toBe(1);
    // The engine's real shape.
    expect(countAnalyzedPhotos({ damageAnalysis: { photos: [{ aiSummary: 'Roof looks worn.' }] } })).toBe(1);
  });

  it('does not count photos the model could not read', () => {
    // A live run returned 8 photos ALL marked "Unable to analyze this image."
    // while the report still said "No significant damage detected" — those must
    // never count as examined.
    const failed = { damageAnalysis: { photos: Array.from({ length: 8 }, () => ({ aiSummary: 'Unable to analyze this image.' })) } };
    expect(countAnalyzedPhotos(failed)).toBe(0);

    const mixed = { damageAnalysis: { photos: [
      { aiSummary: 'Missing shingles on the south slope.' },
      { aiSummary: 'Unable to analyze this image.' },
    ] } };
    expect(countAnalyzedPhotos(mixed)).toBe(1);
  });

  it('reports zero when nothing was analysed', () => {
    expect(countAnalyzedPhotos({ photos: [] })).toBe(0);
    expect(countAnalyzedPhotos({})).toBe(0);
    expect(countAnalyzedPhotos(null)).toBe(0);
    expect(countAnalyzedPhotos({ photos: 'not-an-array' })).toBe(0);
  });

  it('counts a real vision provider, not any generically-named key', () => {
    const saved = {
      groq: process.env.GROQ_API_KEY, fal: process.env.FAL_AI_API_KEY,
      falAlt: process.env.FAL_KEY, or: process.env.OPENROUTER_API_KEY, generic: process.env.API_KEY,
    };
    try {
      for (const k of ['GROQ_API_KEY', 'FAL_AI_API_KEY', 'FAL_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
      // A stray API_KEY must NOT make the app claim it can analyse photos — that
      // mismatch produced reports with zero analysis and "no damage".
      process.env.API_KEY = 'some-unrelated-key';
      expect(visionConfigured()).toBe(false);
      // The missing-key message only matters once image analysis is switched on.
      const prevSwitch = process.env.REPORT_IMAGE_ANALYSIS;
      process.env.REPORT_IMAGE_ANALYSIS = 'on';
      expect(configStatus().missing.join(' ')).toMatch(/FAL_AI_API_KEY/);
      if (prevSwitch === undefined) delete process.env.REPORT_IMAGE_ANALYSIS; else process.env.REPORT_IMAGE_ANALYSIS = prevSwitch;

      // fal.ai alone is enough — it's the primary provider now.
      process.env.FAL_AI_API_KEY = 'fal_test';
      expect(visionConfigured()).toBe(true);
      expect(configStatus().configured).toBe(true);

      // Groq alone also works (secondary provider).
      delete process.env.FAL_AI_API_KEY;
      process.env.GROQ_API_KEY = 'gsk_test';
      expect(visionConfigured()).toBe(true);
    } finally {
      delete process.env.API_KEY; delete process.env.GROQ_API_KEY; delete process.env.FAL_AI_API_KEY;
      if (saved.groq !== undefined) process.env.GROQ_API_KEY = saved.groq;
      if (saved.fal !== undefined) process.env.FAL_AI_API_KEY = saved.fal;
      if (saved.falAlt !== undefined) process.env.FAL_KEY = saved.falAlt;
      if (saved.or !== undefined) process.env.OPENROUTER_API_KEY = saved.or;
      if (saved.generic !== undefined) process.env.API_KEY = saved.generic;
    }
  });
});

// Proposal's "What We Found" chapter shows real damage photos too (the
// scroll-craft rebuild reuses Estimate's stored inspection data), so a
// hollow proposal deserves the same warning as the other damage-claim types.
describe('which types warn about photo analysis', () => {
  it('warns for the types that make a damage claim', () => {
    for (const t of ['estimate', 'presentation', 'proposal', 'combined']) {
      expect(ASSESSES_DAMAGE, `${t} should warn`).toContain(t);
    }
  });

  it('image analysis is off unless the owner turns it on', () => {
    // Every report carries photos as taken and takes its findings from the
    // field checklist until REPORT_IMAGE_ANALYSIS=on is set.
    const prev = process.env.REPORT_IMAGE_ANALYSIS;
    delete process.env.REPORT_IMAGE_ANALYSIS;
    expect(imageAnalysisEnabled()).toBe(false);
    expect(configStatus().configured).toBe(true);
    process.env.REPORT_IMAGE_ANALYSIS = 'on';
    expect(imageAnalysisEnabled()).toBe(true);
    if (prev === undefined) delete process.env.REPORT_IMAGE_ANALYSIS; else process.env.REPORT_IMAGE_ANALYSIS = prev;
  });

  it('does not warn for the Inspection, which never analyses photos', () => {
    // The Inspection is the inspector's record: photos as taken, checklist,
    // notes. Zero analysed photos is the design, not a failed vision pass.
    expect(ASSESSES_DAMAGE).not.toContain('inspection');
  });

  it('never counts an unanalysed record photo as analysed', () => {
    expect(countAnalyzedPhotos({ damageAnalysis: { photos: [
      { id: 'a', url: 'u', aiSummary: 'Not analysed — inspection record.' },
      { id: 'b', url: 'u', aiSummary: 'Unable to analyze this image.' },
      { id: 'c', url: 'u', aiSummary: 'Analysis complete.' },
    ] } })).toBe(1);
  });

  it('covers every valid report type one way or the other', () => {
    // A new type must be a deliberate choice, not an accidental omission.
    for (const t of VALID_TYPES) {
      expect(['inspection', 'estimate', 'presentation', 'combined', 'proposal']).toContain(t);
    }
  });
});
