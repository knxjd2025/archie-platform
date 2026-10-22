import { describe, it, expect } from 'vitest';
import { withProfile } from '../../../../tenant/context';
import { resolveCompanyProfile } from '../../../../../shared/company';
import { TEST_PROFILE } from '../../../../__tests__/helpers/tenant';
import { howTheJobRuns } from '../how-the-job-runs';
import { financing, hasFinancing } from '../financing';
import { whyUs } from '../why-us';
import { SCROLL_STYLE, DOCUMENT_STYLE } from '../style';

const BARE = resolveCompanyProfile({ id: '11111111-1111-4111-8111-111111111111', name: 'Bare Roofing' });

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
  it("links the company's own lender", () => {
    withProfile(TEST_PROFILE, () => {
      expect(hasFinancing()).toBe(true);
      const html = financing(SCROLL_STYLE);
      expect(html).toContain('https://lender.test/apply');
      expect(html).toContain('Test Lender');
    });
  });

  it('invents no APR or monthly payment', () => {
    // The numbers come from the lender's own application, never this template.
    const html = withProfile(TEST_PROFILE, () => financing(SCROLL_STYLE));
    expect(html).not.toMatch(/\d+(\.\d+)?\s*%\s*APR/i);
    expect(html).not.toMatch(/\$\d[\d,]*\s*\/\s*(mo|month)/i);
  });

  it('is left out when the company offers no financing', () => {
    withProfile(BARE, () => {
      expect(hasFinancing()).toBe(false);
      expect(financing(SCROLL_STYLE)).toBe('');
    });
  });
});

describe('why us', () => {
  it("shows the company's own credentials, stats and badges", () => {
    const html = withProfile(TEST_PROFILE, () => whyUs(SCROLL_STYLE));
    expect(html).toContain('Acme Credential One');
    expect(html).toContain('4.9★ on Google · 50 reviews');
    expect(html).toContain('https://acme.test/award.png');
  });

  it('a company with no credentials shows no credential strip, and nothing at all with no claims', () => {
    const html = withProfile(BARE, () => whyUs(SCROLL_STYLE));
    expect(html).not.toContain('class="cred"');
    expect(html.trim()).toBe('');
  });

  it('never implies a general contractor licence', () => {
    expect(withProfile(TEST_PROFILE, () => whyUs(SCROLL_STYLE))).not.toMatch(/general contractor|GC licen/i);
  });

  it('compact mode drops the stats and keeps the credentials', () => {
    // The Estimate gets a band, not a chapter.
    const full = withProfile(TEST_PROFILE, () => whyUs(SCROLL_STYLE));
    const compact = withProfile(TEST_PROFILE, () => whyUs(DOCUMENT_STYLE, { compact: true }));
    expect(compact).toContain('Acme Credential One');
    expect(compact).not.toContain('50 reviews');
    expect(compact.length).toBeLessThan(full.length);
  });
});
