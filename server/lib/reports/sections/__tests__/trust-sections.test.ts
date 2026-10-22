import { describe, it, expect } from 'vitest';
import { howTheJobRuns } from '../how-the-job-runs';
import { financing } from '../financing';
import { whyBRN } from '../why-brn';
import { SCROLL_STYLE, DOCUMENT_STYLE } from '../style';

describe('how the job runs', () => {
  const html = howTheJobRuns(SCROLL_STYLE);

  it('walks the five steps in order', () => {
    for (const step of ['Protect', 'Tear off', 'Dry in', 'Install', 'Clean up']) {
      expect(html).toContain(step);
    }
    expect(html.indexOf('Protect')).toBeLessThan(html.indexOf('Clean up'));
  });

  it('makes the decking promise explicit', () => {
    expect(html.toLowerCase()).toContain('rotten');
    expect(html.toLowerCase()).toContain('before');
  });
});

describe('financing', () => {
  const html = financing(SCROLL_STYLE);

  it('links the real HFS Financial application', () => {
    expect(html).toContain('https://www.hfsfinancial.net/promo/6a9220ac271898d8cd349096');
  });

  it('invents no APR or monthly payment', () => {
    // The numbers come from HFS Financial's own application, never this template.
    expect(html).not.toMatch(/\d+(\.\d+)?\s*%\s*APR/i);
    expect(html).not.toMatch(/\$\d[\d,]*\s*\/\s*(mo|month)/i);
  });
});

describe('why BRN', () => {
  const html = whyBRN(SCROLL_STYLE);

  it('leads with the real CertainTeed credential', () => {
    expect(html).toContain('ShingleMaster');
  });

  it('carries the stats James approved', () => {
    expect(html).toContain('500+');
    expect(html).toContain('$100,000');
    expect(html).toContain('Angi');
  });

  it('never implies a general contractor licence', () => {
    expect(html).not.toMatch(/general contractor|GC licen/i);
  });

  it('compact mode drops the stats and keeps the credentials', () => {
    // The Estimate gets a band, not a chapter.
    const compact = whyBRN(DOCUMENT_STYLE, { compact: true });
    expect(compact).toContain('ShingleMaster');
    expect(compact.length).toBeLessThan(html.length);
  });
});
