import { describe, it, expect } from 'vitest';
import {
  streetOnly, defaultFields, renderLetter, unfilledPlaceholders, SUBJECT_LINES, letterCompanyFrom, officeAddressOf, type LetterCompany,
} from '../neighbor-letters';
import { resolveCompanyProfile } from '../company';

const ACME = resolveCompanyProfile({
  id: '0e5f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Acme Test Roofing',
  branding: { legalName: 'Acme Test Roofing LLC', shortName: 'Acme Roofing', phone: '(555) 010-2030', website: 'https://acme.test', address: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701', primaryColor: '#225588' },
  settings: { trustStats: ['4.9★ on Google · 50 reviews'], credentials: ['Fully insured'], workmanshipWarranty: '10-year workmanship warranty' },
});
const BARE = resolveCompanyProfile({ id: '11111111-1111-4111-8111-111111111111', name: 'Bare Roofing' });

const filled = (company: LetterCompany = letterCompanyFrom(ACME)) => defaultFields({
  repName: 'Casey Rep', repCell: '(555) 010-0100', streetName: 'Farmleigh Ave', neighborhood: 'Palisades', yearBuilt: '2004',
  gettingLines: ['A complete CertainTeed Integrity Roof System', 'A 50-year CertainTeed product warranty'],
  estimateUrl: 'https://acme.test/estimate', bookingUrl: 'https://acme.test/book', date: 'September 16, 2026',
  officeAddress: officeAddressOf(ACME), company,
});

/** The company this code was first written for: none of it may reach a letter. */
const FORMER_COMPANY = /Best Roofing|bestroof|Charlotte|father and son|\bAngi\b|\bBBB\b|500\+|hub\.com|Mallard Creek|\(704\)/i;

describe('streetOnly', () => {
  it('drops the house number and everything after the street', () => {
    expect(streetOnly('14509 Farmleigh Ave, Springfield, IL 62704, USA')).toBe('Farmleigh Ave');
    expect(streetOnly('550 Manning Dr')).toBe('Manning Dr');
    expect(streetOnly('1101-B Carrier Dr, Springfield')).toBe('Carrier Dr');
    expect(streetOnly('')).toBe('');
  });
});

describe('the company on the letters', () => {
  it('comes from its profile, and carries only what it entered', () => {
    expect(letterCompanyFrom(ACME)).toEqual({
      name: 'Acme Roofing', legalName: 'Acme Test Roofing LLC', trade: 'roofing', phone: '(555) 010-2030', website: 'acme.test', area: 'Springfield',
      trustLines: ['4.9★ on Google · 50 reviews', 'Fully insured', '10-year workmanship warranty'], color: '#225588',
    });
    expect(letterCompanyFrom(BARE).trustLines).toEqual([]);
    expect(officeAddressOf(ACME)).toBe('1 Test Way, Springfield, IL 62701');
    expect(officeAddressOf(BARE)).toBe('');
  });
});

describe('the three letters', () => {
  it('never contain a bracketed placeholder once the fields are filled', () => {
    for (const kind of ['leave_behind', 'email', 'mailer'] as const) {
      const r = renderLetter(kind, filled());
      expect(unfilledPlaceholders(r.text), kind).toEqual([]);
      expect(r.text).toContain('Casey Rep');
      expect(r.text).toContain('Farmleigh Ave');
      expect(r.text).toContain('Acme Roofing');
      expect(r.text).toContain('4.9★ on Google · 50 reviews');
      expect(r.text).toContain('(555) 010-2030');
      expect(r.text + r.html, kind).not.toMatch(FORMER_COMPANY);
    }
  });
  it('a company that entered no claims gets no trust section, and no one else\'s', () => {
    for (const kind of ['leave_behind', 'email', 'mailer'] as const) {
      const r = renderLetter(kind, filled(letterCompanyFrom(BARE)));
      expect(r.text, kind).not.toMatch(/trust us|choose us/);
      expect(r.text, kind).not.toContain('Office:');
      expect(r.text + r.html, kind).not.toMatch(FORMER_COMPANY);
      expect(r.text, kind).toContain('Bare Roofing');
    }
  });
  it('lists what is still to fill when the rep has not', () => {
    const r = renderLetter('leave_behind', defaultFields({ streetName: 'Elm St', company: letterCompanyFrom(ACME) }));
    expect(unfilledPlaceholders(r.text)).toEqual(['Rep Name', 'Rep Cell']);
    // With no company at all, its name is a blank the rep must see.
    expect(unfilledPlaceholders(renderLetter('leave_behind', defaultFields({ repName: 'A', repCell: 'B' })).text)).toEqual(['Company Name']);
  });
  it('offers the estimate tool and booking link only when the company set them', () => {
    const none = { ...filled(), estimateUrl: '', bookingUrl: '' };
    expect(renderLetter('leave_behind', none).text).not.toContain('price range');
    expect(renderLetter('email', none).html).not.toContain('Book My Inspection');
    expect(renderLetter('mailer', none).html).not.toContain('data-qr');
    expect(renderLetter('email', filled()).html).toContain('https://acme.test/book');
  });
  it('leave-behind says "this week", the mailer says "recently"', () => {
    expect(renderLetter('leave_behind', filled()).text).toContain("This week we're putting a brand new roof");
    expect(renderLetter('mailer', filled()).text).toContain('We recently installed a brand new roof');
  });
  it('keeps the "didn\'t wait" paragraph true on a storm job', () => {
    const storm = renderLetter('leave_behind', { ...filled(), insuranceJob: true }).text;
    expect(storm).toContain('damaged in a storm');
    expect(storm).not.toContain("didn't wait for a small problem");
  });
  it('omits "what your neighbor is getting" on a simple job', () => {
    const simple = renderLetter('leave_behind', { ...filled(), gettingLines: [] });
    expect(simple.text).not.toContain('What your neighbor is getting');
    expect(renderLetter('leave_behind', filled()).text).toContain('A complete CertainTeed Integrity Roof System');
  });
  it('email carries a subject, preview text, both buttons and the CAN-SPAM footer', () => {
    const e = renderLetter('email', { ...filled(), subjectIndex: 1 });
    expect(e.subject).toBe(SUBJECT_LINES({ streetName: 'Farmleigh Ave' })[1]);
    expect(e.previewText).toContain('Palisades');
    expect(e.html).toContain('https://acme.test/estimate');
    expect(e.html).toContain('https://acme.test/book');
    expect(e.html).toContain('background:#225588'); // the company's color
    expect(e.html).toContain('Unsubscribe');
    expect(e.text).toContain('Acme Test Roofing LLC, 1 Test Way, Springfield, IL 62701');
    // No mailing address: the footer shows a blank the rep must fill.
    expect(unfilledPlaceholders(renderLetter('email', { ...filled(), officeAddress: '' }).text)).toEqual(['Mailing Address']);
  });
  it('mailer addresses "Neighbor" for a current resident and by name otherwise', () => {
    expect(renderLetter('mailer', filled()).text).toContain('Dear Neighbor,');
    expect(renderLetter('mailer', { ...filled(), recipientName: 'Ms. Lee' }).text).toContain('Dear Ms. Lee,');
    expect(renderLetter('mailer', filled()).html).toContain('data-qr="https://acme.test/estimate"');
  });
  it('escapes anything a rep types into the HTML', () => {
    const r = renderLetter('email', { ...filled(), repName: '<script>x</script>' });
    expect(r.html).not.toContain('<script>');
  });
});
