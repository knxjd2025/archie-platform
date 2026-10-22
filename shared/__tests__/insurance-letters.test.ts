import { describe, it, expect } from 'vitest';
import {
  INSURANCE_LETTERS, buildInsuranceLetter, depreciationDue, letterDef, letterHtml, letterSubject,
  letterText, letterWarnings, longDate, looksLikeFinalInvoice, missingLetterFields,
  type ClaimLetterFields, type InsuranceLetterKind,
} from '../insurance-letters';

const fields = (over: Partial<ClaimLetterFields> = {}): ClaimLetterFields => ({
  date: '2026-09-18',
  carrier: 'State Farm',
  adjusterName: 'Dana Reyes',
  claimNumber: '55-ABCD-123',
  policyNumber: 'HO-9911',
  insuredName: 'Karen Whitfield',
  propertyAddress: '1420 Sardis Rd, Charlotte, NC 28270',
  dateOfLoss: '2026-05-04',
  eventDate: '2026-09-11', amount: 7300, items: [], note: '',
  manualTotal: false, invoiceTotal: 0,
  rcv: 24500, supplements: 0, acv: 17200, deductible: 2500, deductibleCollected: true,
  payableTo: 'Karen Whitfield',
  enclosures: [...letterDef('depreciation').enclosures],
  senderName: 'James Turner', senderTitle: 'Owner', senderPhone: '(704) 605-6047', senderEmail: 'james@bestroofingnow.com',
  companyName: 'Best Roofing Now', officeAddress: '10130 Mallard Creek Road, Suite 300, Charlotte, NC 28262', companyPhone: '(704) 605-6047',
  ...over,
});

/** The depreciation letter, which is what most of these assertions are about. */
const dep = (f: ClaimLetterFields, format: 'letter' | 'email' = 'letter') => buildInsuranceLetter('depreciation', f, format);

describe('depreciationDue', () => {
  it('is the approved scope plus approved supplements, less what the carrier already paid', () => {
    expect(depreciationDue({ rcv: 24500, supplements: 0, acv: 17200 })).toBe(7300);
    expect(depreciationDue({ rcv: 24500, supplements: 1800, acv: 17200 })).toBe(9100);
  });
  it('leaves the deductible out of it — that is the homeowner\'s to pay, not the carrier\'s to release', () => {
    const f = fields({ deductible: 5000 });
    expect(depreciationDue(f)).toBe(7300);
  });
  it('never goes negative when the carrier has already paid more than the scope', () => {
    expect(depreciationDue({ rcv: 10000, supplements: 0, acv: 12000 })).toBe(0);
  });
});

describe('what has to be filled in', () => {
  it('passes a complete letter', () => {
    expect(missingLetterFields('depreciation', fields())).toEqual([]);
  });
  it('names every blank a carrier would reject it for', () => {
    expect(missingLetterFields('depreciation', fields({ carrier: '', claimNumber: '  ', eventDate: '', amount: 0 })))
      .toEqual(['Carrier', 'Claim number', 'Completion date', 'Amount requested']);
  });
  it('warns when the amount asked for does not match the figures, without blocking', () => {
    expect(letterWarnings('depreciation', fields({ amount: 9000 }))[0]).toContain('$9,000.00');
    expect(letterWarnings('depreciation', fields({ amount: 9000 }))[0]).toContain('$7,300.00');
    expect(letterWarnings('depreciation', fields())).toEqual([]);
  });
  it('warns when the claim carried no ACV or RCV', () => {
    expect(letterWarnings('depreciation', fields({ rcv: 0, acv: 0, amount: 1 })).length).toBe(2);
  });
});

describe('the letter', () => {
  it('states the claim, the completion date and the arithmetic', () => {
    const { text } = dep(fields(), 'letter');
    expect(text).toContain('Claim number: 55-ABCD-123');
    expect(text).toContain('completed on September 11, 2026');
    expect(text).toContain('$24,500.00');
    expect(text).toContain('-$17,200.00');
    expect(text).toContain('$7,300.00');
    expect(text).toContain('Dear Dana Reyes,');
    expect(text).toContain('Certificate of completion');
  });
  it('mentions the deductible only once it has actually been collected', () => {
    expect(dep(fields(), 'letter').text).toContain("deductible of $2,500.00 has been collected");
    expect(dep(fields({ deductibleCollected: false }), 'letter').text).not.toContain('deductible of');
  });
  it('falls back to a generic salutation and drops empty reference lines', () => {
    const { text } = dep(fields({ adjusterName: '', policyNumber: '', dateOfLoss: '' }), 'letter');
    expect(text).toContain('To whom it may concern,');
    expect(text).not.toContain('Policy number:');
    expect(text).not.toContain('Date of loss:');
  });
  it('escapes anything a carrier name or address drags in, so the HTML preview stays intact', () => {
    const { html } = dep(fields({ insuredName: 'Karen <b>Whitfield</b> & Co' }), 'letter');
    expect(html).toContain('Karen &lt;b&gt;Whitfield&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>Whitfield</b>');
  });
  it('shows the supplement line only when there is one', () => {
    expect(dep(fields(), 'letter').text).not.toContain('Approved supplements');
    expect(dep(fields({ supplements: 1800, amount: 9100 }), 'letter').text).toContain('Approved supplements');
  });
});

describe('the adjuster email', () => {
  it('is a short cover note naming the amount, with a subject a carrier can file', () => {
    const { subject, text, html } = dep(fields(), 'email');
    expect(subject).toBe('Depreciation release request — claim 55-ABCD-123 — Karen Whitfield');
    expect(text).toContain('Hi Dana,');
    expect(text).toContain('$7,300.00');
    expect(text).toContain('1420 Sardis Rd');
    expect(html).toContain('<p>');
  });
});

describe('dates', () => {
  it('reads a YYYY-MM-DD as a calendar day, whatever timezone the browser is in', () => {
    expect(longDate('2026-01-01')).toBe('January 1, 2026');
    expect(longDate('')).toBe('');
  });
  it('titles the letter even before the claim number is known', () => {
    expect(letterSubject('depreciation', fields({ claimNumber: '', insuredName: '' }))).toBe('Depreciation release request');
  });
});

describe('typing the total in by hand', () => {
  it('states the one figure and drops the arithmetic', () => {
    const { text } = dep(fields({ manualTotal: true, amount: 6400 }), 'letter');
    expect(text).toContain('Recoverable depreciation now due');
    expect(text).toContain('$6,400.00');
    expect(text).not.toContain('Replacement cost value');
    expect(text).not.toContain('Less actual cash value');
  });
  it('stops second-guessing the figure, since it was a deliberate choice', () => {
    expect(letterWarnings('depreciation', fields({ manualTotal: true, amount: 6400 }))).toEqual([]);
    expect(letterWarnings('depreciation', fields({ manualTotal: true, rcv: 0, acv: 0, amount: 6400 }))).toEqual([]);
  });
  it('still insists on an amount', () => {
    expect(missingLetterFields('depreciation', fields({ manualTotal: true, amount: 0 }))).toContain('Amount requested');
  });
});

describe('the final invoice total', () => {
  it('is stated in the letter once it is filled in, and left out when it is not', () => {
    expect(dep(fields({ invoiceTotal: 26300 }), 'letter').text).toContain('final invoice, totalling $26,300.00, is enclosed');
    expect(dep(fields(), 'letter').text).toContain('final invoice is enclosed');
  });
});

describe('photos', () => {
  it('shows what it is given, captioned, and escapes the source', () => {
    const html = letterHtml('depreciation', fields(), [
      { src: 'cid:photo1', caption: 'Front elevation' },
      { src: 'https://x.test/a.jpg?a=1&b=2' },
    ]);
    // <b>…</b>, not the bare phrase — that also appears in the enclosures list.
    expect(html).toContain('<b>Photos of the completed work</b>');
    expect(html).toContain('src="cid:photo1"');
    expect(html).toContain('Front elevation');
    expect(html).toContain('a=1&amp;b=2');
  });
  it('adds nothing at all when there are none', () => {
    const html = letterHtml('depreciation', fields());
    expect(html).not.toContain('<b>Photos of the completed work</b>');
    expect(html).not.toContain('<img');
  });
});

describe('spotting the final invoice among a job\'s files', () => {
  it('picks the invoice', () => {
    expect(looksLikeFinalInvoice('Final Invoice 1042.pdf', 'application/pdf')).toBe(true);
    expect(looksLikeFinalInvoice('whitfield-invoice.pdf', 'application/pdf')).toBe(true);
    expect(looksLikeFinalInvoice('Final bill.pdf', 'application/pdf')).toBe(true);
  });
  it('leaves the documents that are not it — attaching the wrong money is worse than attaching nothing', () => {
    for (const n of ['Estimate 1042.pdf', 'Proposal.pdf', 'Signed quote.pdf', 'Payment receipt.pdf', 'Scope of loss.pdf']) {
      expect(looksLikeFinalInvoice(n, 'application/pdf'), n).toBe(false);
    }
  });
  it('ignores anything that is not a PDF', () => {
    expect(looksLikeFinalInvoice('invoice photo.jpg', 'image/jpeg')).toBe(false);
    expect(looksLikeFinalInvoice('invoice.pdf', 'image/jpeg')).toBe(true);  // name wins when the type is wrong
    expect(looksLikeFinalInvoice('invoice', null)).toBe(true);
  });
});

describe('the rest of the carrier letters', () => {
  const of = (kind: InsuranceLetterKind, over: Partial<ClaimLetterFields> = {}) =>
    buildInsuranceLetter(kind, fields({ enclosures: [...letterDef(kind).enclosures], ...over }), 'letter').text;

  it('covers every step of the claim where something is sent', () => {
    expect(INSURANCE_LETTERS.map((l) => l.kind)).toEqual([
      'estimate_package', 'status_follow_up', 'supplement', 'reinspection', 'lab_results', 'depreciation',
    ]);
  });

  it('sends the estimate package with what is enclosed and the total', () => {
    const text = of('estimate_package', { eventDate: '2026-06-02', amount: 24500 });
    expect(text).toContain("following the adjuster's inspection on June 2, 2026");
    expect(text).toContain('Our estimate totals $24,500.00.');
    expect(text).toContain('Xactimate estimate');
    expect(text).toContain('confirm receipt');
  });

  it('chases a quiet carrier, naming what was sent and when', () => {
    const text = of('status_follow_up', { eventDate: '2026-06-03', items: ['Xactimate estimate', 'Inspection report'] });
    expect(text).toContain('on June 3, 2026');
    expect(text).toContain('· Inspection report');
    expect(text).toContain('where the file stands');
  });

  it('itemises a supplement and totals it', () => {
    const text = of('supplement', { amount: 3120.5, items: ['Drip edge, 180 lf', 'Ice & water shield, 2 sq'] });
    expect(text).toContain('Items claimed:');
    expect(text).toContain('· Drip edge, 180 lf');
    expect(text).toContain('The supplement totals $3,120.50.');
  });

  it('asks for a re-inspection against the written decision only', () => {
    const text = of('reinspection', { eventDate: '2026-06-20', items: ['14 hail impacts on the north slope'] });
    expect(text).toContain("carrier's written decision");
    expect(text).toContain('dated June 20, 2026');
    expect(text).toContain('requesting a re-inspection');
    // Never argues the outcome, only asks for the look.
    expect(text).not.toMatch(/should be (approved|covered)/i);
  });

  it('submits lab results as evidence for the file', () => {
    const text = of('lab_results', { eventDate: '2026-06-10', items: ['Impact-related fracturing consistent with hail'] });
    expect(text).toContain('submitted for laboratory testing');
    expect(text).toContain('What the report found:');
    expect(text).toContain('Laboratory test report');
  });

  it('titles each one so a carrier can file it', () => {
    for (const l of INSURANCE_LETTERS) {
      expect(letterSubject(l.kind, fields())).toBe(`${l.subject} — claim 55-ABCD-123 — Karen Whitfield`);
    }
  });

  it('asks for what each letter cannot go without, and nothing more', () => {
    const blank = fields({ carrier: '', claimNumber: '', insuredName: '', propertyAddress: '', senderName: '', eventDate: '', amount: 0 });
    for (const l of INSURANCE_LETTERS) {
      expect(missingLetterFields(l.kind, blank), l.kind).toEqual(expect.arrayContaining(['Carrier', 'Claim number', 'Insured name', 'Property address', 'Your name']));
    }
    expect(missingLetterFields('supplement', fields({ amount: 0 }))).toContain('Supplement total');
    expect(missingLetterFields('reinspection', fields({ eventDate: '' }))).toContain("Carrier's written decision dated");
    // A status chase carries no money, so it must never demand a figure.
    expect(missingLetterFields('status_follow_up', fields({ amount: 0 }))).not.toContain('Amount requested');
    // Only the depreciation letter does arithmetic, so only it can disagree with itself.
    expect(letterWarnings('supplement', fields({ amount: 999, rcv: 0, acv: 0 }))).toEqual([]);
  });

  it("puts the sender's own note in, wherever the letter is otherwise fixed", () => {
    for (const l of INSURANCE_LETTERS) {
      expect(of(l.kind, { note: 'The homeowner is copied on this.' }), l.kind).toContain('The homeowner is copied on this.');
    }
  });

  it('carries photographs in the body of any of them, not just the depreciation one', () => {
    const html = letterHtml('reinspection', fields(), [{ src: 'cid:p1', caption: 'North slope' }]);
    expect(html).toContain('<b>Photographs</b>');
    expect(html).toContain('North slope');
    expect(letterHtml('depreciation', fields(), [{ src: 'cid:p1' }])).toContain('<b>Photos of the completed work</b>');
  });
});

