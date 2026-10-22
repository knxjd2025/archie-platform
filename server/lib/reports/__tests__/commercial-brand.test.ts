import { describe, it, expect } from 'vitest';
import { COMMERCIAL_BRAND_FACTS, BRAND_PROMISE } from '../brand-facts';
import { BRN_ASSETS } from '../brn-brand';
import {
  ROOF_WORDS, chapterAboutBrn, chapterRoofWords, aboutBrnSectionDocument, roofWordsSectionDocument, brandCloser, brandLogo,
} from '../sections/commercial-brand';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim());

describe('Best Roofing Now on commercial documents', () => {
  it('sources every commercial claim', () => {
    for (const f of COMMERCIAL_BRAND_FACTS) {
      expect(f.source).toMatch(/^https:\/\/bestroofingnow\.com\//);
      expect(f.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.text).not.toMatch(/general contractor|GC licen/i);
    }
  });

  it('writes for a building owner, not a roofer: short sentences throughout', () => {
    const plain = [
      ...COMMERCIAL_BRAND_FACTS.map((f) => f.text),
      ...ROOF_WORDS.map(([, d]) => d),
    ];
    for (const text of plain) {
      for (const s of sentences(text)) expect(words(s), s).toBeLessThanOrEqual(22);
    }
  });

  it('carries the logo, the promise and the values', () => {
    expect(brandLogo()).toContain(BRN_ASSETS.logo);
    const doc = aboutBrnSectionDocument();
    expect(doc).toContain(BRAND_PROMISE.text);
    expect(doc).toContain('Integrity First');
    expect(doc).toContain('Fred Turner');
    expect(doc).not.toMatch(/your home|homeowner/i);
    // The scroll documents tell the founders' story in Who We Are; this chapter does not repeat it.
    const scroll = chapterAboutBrn();
    expect(scroll).not.toContain('Integrity First');
    expect(scroll).toContain('Chapter {{CH}}');
    expect(brandCloser()).toContain(BRN_ASSETS.logo);
  });

  it('explains the roof words used in the report', () => {
    for (const html of [chapterRoofWords(), roofWordsSectionDocument()]) {
      for (const t of ['Membrane', 'Core cut', 'Ponding', 'Recover (layover)', 'Tear-off (replace)']) expect(html).toContain(t);
    }
  });
});
