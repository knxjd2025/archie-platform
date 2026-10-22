import { describe, it, expect } from 'vitest';
import { streetOnly, reviewCountFrom, defaultFields, renderLetter, unfilledPlaceholders, SUBJECT_LINES } from '../neighbor-letters';

const filled = () => defaultFields({
  repName: 'Banning Rumsey', repCell: '(704) 555-0100', streetName: 'Farmleigh Ave', neighborhood: 'Palisades', yearBuilt: '2004', reviewCount: '65',
  gettingLines: ['A complete CertainTeed Integrity Roof System', 'A 50-year CertainTeed product warranty'],
  estimateUrl: 'https://bestroofingnow.com/estimate', bookingUrl: 'https://bestroofingnow.com/book', date: 'September 16, 2026',
});

describe('streetOnly', () => {
  it('drops the house number and everything after the street', () => {
    expect(streetOnly('14509 Farmleigh Ave, Charlotte, NC 28273, USA')).toBe('Farmleigh Ave');
    expect(streetOnly('550 Manning Dr')).toBe('Manning Dr');
    expect(streetOnly('1101-B Carrier Dr, Charlotte')).toBe('Carrier Dr');
    expect(streetOnly('')).toBe('');
  });
});

describe('reviewCountFrom', () => {
  it('reads the brand fact and rounds down to a 5', () => {
    expect(reviewCountFrom('5.0★ on Google · 65+ reviews')).toBe('65');
    expect(reviewCountFrom('5.0★ on Google · 73 reviews')).toBe('70');
    expect(reviewCountFrom(null)).toBe('65');
  });
});

describe('the three letters', () => {
  it('never contain a bracketed placeholder once the fields are filled', () => {
    for (const kind of ['leave_behind', 'email', 'mailer'] as const) {
      const r = renderLetter(kind, filled());
      expect(unfilledPlaceholders(r.text), kind).toEqual([]);
      expect(r.text).toContain('Banning Rumsey');
      expect(r.text).toContain('Farmleigh Ave');
      expect(r.text).toContain('65+ reviews');
      expect(r.text).toContain('(704) 605-6047');
    }
  });
  it('lists what is still to fill when the rep has not', () => {
    const r = renderLetter('leave_behind', defaultFields({ streetName: 'Elm St' }));
    expect(unfilledPlaceholders(r.text)).toEqual(['Rep Name', 'Rep Cell']);
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
    expect(e.html).toContain('https://bestroofingnow.com/estimate');
    expect(e.html).toContain('https://bestroofingnow.com/book');
    expect(e.html).toContain('Unsubscribe');
    expect(e.text).toContain('10130 Mallard Creek Road');
  });
  it('mailer addresses "Neighbor" for a current resident and by name otherwise', () => {
    expect(renderLetter('mailer', filled()).text).toContain('Dear Neighbor,');
    expect(renderLetter('mailer', { ...filled(), recipientName: 'Ms. Lee' }).text).toContain('Dear Ms. Lee,');
    expect(renderLetter('mailer', filled()).html).toContain('data-qr="https://bestroofingnow.com/estimate"');
  });
  it('escapes anything a rep types into the HTML', () => {
    const r = renderLetter('email', { ...filled(), repName: '<script>x</script>' });
    expect(r.html).not.toContain('<script>');
  });
});
