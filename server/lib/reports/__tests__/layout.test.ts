import { describe, it, expect } from 'vitest';
import { arrangeSections, describeSections, normalizeLayout, tagSection, type ReportSection } from '../layout';

const S = (key: string, html = `<p>${key}</p>`, fixed = false): ReportSection => ({ key, label: key.toUpperCase(), html, fixed });
const keys = (s: ReportSection[]) => s.map((x) => x.key);
const base = () => [S('hero', '<h1/>', true), S('a'), S('b'), S('c'), S('d'), S('footer', '<f/>', true)];

describe('arrangeSections', () => {
  it('keeps the default order with no layout', () => {
    expect(keys(arrangeSections(base()))).toEqual(['hero', 'a', 'b', 'c', 'd', 'footer']);
  });
  it('drops empty sections', () => {
    expect(keys(arrangeSections([S('a'), S('b', ''), S('c')]))).toEqual(['a', 'c']);
  });
  it('hides what the rep switched off, but never a fixed section', () => {
    expect(keys(arrangeSections(base(), { hidden: ['b', 'hero', 'footer'] }))).toEqual(['hero', 'a', 'c', 'd', 'footer']);
  });
  it('reorders the mentioned sections and leaves the rest in place', () => {
    expect(keys(arrangeSections(base(), { order: ['d', 'a'] }))).toEqual(['hero', 'd', 'a', 'b', 'c', 'footer']);
    expect(keys(arrangeSections(base(), { order: ['c', 'b'] }))).toEqual(['hero', 'a', 'c', 'b', 'd', 'footer']);
  });
  it('ignores keys the document does not have', () => {
    expect(keys(arrangeSections(base(), { order: ['zzz', 'b', 'a'], hidden: ['nope'] }))).toEqual(['hero', 'b', 'a', 'c', 'd', 'footer']);
  });
  it('keeps fixed sections pinned even when everything else moves', () => {
    expect(keys(arrangeSections(base(), { order: ['d', 'c', 'b', 'a'] }))).toEqual(['hero', 'd', 'c', 'b', 'a', 'footer']);
  });
});

describe('describeSections', () => {
  it('lists every known section in display order with present/hidden/fixed', () => {
    const d = describeSections([S('hero', '<h1/>', true), S('a'), S('b', ''), S('c')], { order: ['c', 'a'], hidden: ['b'] });
    expect(d.map((x) => `${x.key}:${x.present ? 'p' : '-'}${x.hidden ? 'h' : ''}${x.fixed ? 'f' : ''}`)).toEqual(['hero:pf', 'c:p', 'a:p', 'b:-h']);
  });
});

describe('normalizeLayout', () => {
  it('accepts well-formed keys only and de-duplicates', () => {
    expect(normalizeLayout({ order: ['a', 'b', 'a', 'Bad Key', '<x>'], hidden: ['c'] })).toEqual({ order: ['a', 'b'], hidden: ['c'] });
  });
  it('returns null for nothing usable', () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({ order: 'a' })).toBeNull();
  });
});

describe('tagSection', () => {
  it('wraps a document section so the editor can find it', () => {
    expect(tagSection(S('storm', '<section><h2>Storm</h2></section>'))).toBe('<section data-section="storm"><h2>Storm</h2></section>');
    expect(tagSection(S('storm', '<div>x</div>'))).toBe('<div class="rpt-sec" id="sec-storm" data-section="storm"><div>x</div></div>');
    expect(tagSection(S('storm', ''))).toBe('');
  });
});

describe('a section that always closes the document', () => {
  const doc: ReportSection[] = [
    { key: 'a', label: 'A', html: '<p>a</p>' },
    { key: 'photos', label: 'Photos', html: '<p>photos</p>', last: true },
    { key: 'b', label: 'B', html: '<p>b</p>' },
    { key: 'c', label: 'C', html: '<p>c</p>' },
    { key: 'footer', label: 'Footer', html: '<p>f</p>', fixed: true },
  ];
  const keys = (l?: any) => arrangeSections(doc, l).map((s) => s.key);

  it('goes last, before the footer', () => {
    expect(keys()).toEqual(['a', 'b', 'c', 'photos', 'footer']);
  });
  it('stays last even when a saved order put it earlier', () => {
    expect(keys({ order: ['photos', 'c', 'b', 'a'] })).toEqual(['c', 'b', 'a', 'photos', 'footer']);
  });
  it('can still be switched off', () => {
    expect(keys({ hidden: ['photos'] })).toEqual(['a', 'b', 'c', 'footer']);
  });
  it('goes at the very end when there is no footer, and the editor lists it there', () => {
    const noFooter = doc.filter((s) => !s.fixed);
    expect(arrangeSections(noFooter).map((s) => s.key)).toEqual(['a', 'b', 'c', 'photos']);
    const info = describeSections(noFooter);
    expect(info[info.length - 1]).toMatchObject({ key: 'photos', last: true });
  });
});
