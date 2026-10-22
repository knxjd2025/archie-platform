import { describe, it, expect } from 'vitest';
import { withProfile } from '../../../tenant/context';
import { resolveCompanyProfile } from '../../../../shared/company';
import { TEST_PROFILE } from '../../../__tests__/helpers/tenant';
import {
  ROOF_WORDS, chapterAboutCompany, chapterRoofWords, aboutCompanySectionDocument, roofWordsSectionDocument, brandCloser, brandLogo,
} from '../sections/commercial-brand';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
const BARE = resolveCompanyProfile({ id: '11111111-1111-4111-8111-111111111111', name: 'Bare Roofing' });

describe('the company on commercial documents', () => {
  it('writes for a building owner, not a roofer: short sentences throughout', () => {
    for (const [, text] of ROOF_WORDS) {
      for (const s of sentences(text)) expect(words(s), s).toBeLessThanOrEqual(22);
    }
  });

  it("carries the company's logo, promise and values, addressed to a building owner", () => {
    withProfile(TEST_PROFILE, () => {
      expect(brandLogo()).toContain('https://acme.test/logo.png');
      const doc = aboutCompanySectionDocument();
      expect(doc).toContain('We do it right the first time.');
      expect(doc).toContain('Honesty');
      expect(doc).toContain('your building');
      expect(doc).not.toMatch(/your home|homeowner/i);
      expect(doc).toContain('Springfield Chamber member');
      // The scroll documents tell the story in Who We Are; this chapter does not repeat the values.
      const scroll = chapterAboutCompany();
      expect(scroll).not.toContain('Honesty');
      expect(scroll).toContain('Chapter {{CH}}');
      const close = brandCloser();
      expect(close).toContain('https://acme.test/logo.png');
      expect(close).toContain('tel:+15550102030');
    });
  });

  it('a company that entered nothing gets no logo, no promise, no values and no contact line', () => {
    withProfile(BARE, () => {
      expect(brandLogo()).toBe('');
      const doc = aboutCompanySectionDocument();
      expect(doc).not.toContain('bx-promise');
      expect(doc).not.toContain('What we believe');
      expect(doc).not.toContain('Part of our community');
      const close = brandCloser();
      expect(close).toContain('Bare Roofing');
      expect(close).not.toContain('bx-close-contact');
    });
  });

  it('explains the roof words used in the report', () => {
    for (const html of [chapterRoofWords(), roofWordsSectionDocument()]) {
      for (const t of ['Membrane', 'Core cut', 'Ponding', 'Recover (layover)', 'Tear-off (replace)']) expect(html).toContain(t);
    }
  });
});
