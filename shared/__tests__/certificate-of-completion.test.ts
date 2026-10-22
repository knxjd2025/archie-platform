import { describe, it, expect } from 'vitest';
import {
  certificateBlockers, certificateFromWalkthrough, certificateHtml, certificateStatement, certDate,
  type CertificateSignatures,
} from '../certificate-of-completion';

const COMPANY = { companyName: 'Best Roofing Now', officeAddress: '10130 Mallard Creek Road, Charlotte, NC', companyPhone: '(704) 605-6047' };
const JOB = { customerName: 'Karen Whitfield', propertyAddress: '1420 Sardis Rd, Charlotte, NC', jobName: 'Whitfield roof', claimNumber: '55-ABCD-123' };

const answers = (over: Record<string, any> = {}) => ({
  'Walked by': 'Joven Mitchell',
  Role: 'Sales Rep',
  Date: '2026-09-11',
  'Homeowner present': 'Yes',
  'Magnetic sweep — driveway, walkways, garage apron': { state: 'ok' },
  'Magnetic sweep — lawn, flower beds, mulch': { state: 'ok' },
  'Ridge and hip caps straight, sealed, no exposed nails': { state: 'ok' },
  'Shingle courses straight; no lifted, torn or unsealed tabs': { state: 'issue', note: 'Two tabs lifted on the south slope' },
  'Satellite dish reinstalled and pointing; homeowner confirmed signal': { state: 'na' },
  'Explained the warranty, roof care and what to expect': true,
  'Final balance': 'Insurance — awaiting depreciation / final check',
  'Homeowner concerns': 'Wants the gutters checked again after the next storm.',
  ...over,
});

const sigs = (over: Partial<CertificateSignatures> = {}): CertificateSignatures => ({
  companySigner: 'James Turner', companySignedAt: '2026-09-12T14:00:00Z',
  homeownerSigner: 'Karen Whitfield', homeownerSignedAt: '2026-09-12T15:30:00Z',
  ...over,
});

describe('building the certificate from the walkthrough', () => {
  it('takes the date, the walker and the balance straight off the walkthrough', () => {
    const d = certificateFromWalkthrough(answers(), JOB, COMPANY);
    expect(d.completedOn).toBe('2026-09-11');
    expect(d.walkedBy).toBe('Joven Mitchell');
    expect(d.walkedByRole).toBe('Sales Rep');
    expect(d.homeownerPresent).toBe(true);
    expect(d.warrantyExplained).toBe(true);
    expect(d.balance).toBe('Insurance — awaiting depreciation / final check');
    expect(d.claimNumber).toBe('55-ABCD-123');
  });

  it('tallies each section by what was actually answered, counting nothing it was not told', () => {
    const d = certificateFromWalkthrough(answers(), JOB, COMPANY);
    expect(d.sections.find((s) => s.section === 'Nail Sweep')).toEqual({ section: 'Nail Sweep', ok: 2, issue: 0, na: 0 });
    expect(d.sections.find((s) => s.section === 'Roof Check')).toEqual({ section: 'Roof Check', ok: 1, issue: 1, na: 0 });
    // The satellite dish check lives under Property Check, so that is where its N/A lands.
    expect(d.sections.find((s) => s.section === 'Property Check')).toEqual({ section: 'Property Check', ok: 0, issue: 0, na: 1 });
    // A section nobody answered at all is left off rather than reported as clean.
    expect(d.sections.find((s) => s.section === 'Cleanup & Leftovers')).toBeUndefined();
  });

  it('prints what the walkthrough flagged instead of quietly dropping it', () => {
    const d = certificateFromWalkthrough(answers(), JOB, COMPANY);
    expect(d.openItems).toEqual([
      { label: 'Shingle courses straight; no lifted, torn or unsealed tabs', note: 'Two tabs lifted on the south slope' },
    ]);
    expect(certificateHtml(d, sigs())).toContain('Two tabs lifted on the south slope');
  });

  it('is honest when the homeowner was not there and nothing was explained', () => {
    const d = certificateFromWalkthrough(answers({ 'Homeowner present': 'No', 'Explained the warranty, roof care and what to expect': false }), JOB, COMPANY);
    expect(certificateStatement(d)).not.toContain('with the homeowner present');
    expect(certificateHtml(d, sigs())).not.toContain('warranties, roof care');
  });
});

describe('the certificate document', () => {
  it('states the completion date, the company and who walked it', () => {
    const d = certificateFromWalkthrough(answers(), JOB, COMPANY);
    expect(certificateStatement(d)).toBe(
      'The roofing work at the property described below was completed on September 11, 2026 by Best Roofing Now '
      + 'in accordance with the contracted scope of work. A final walkthrough of the roof and the property was carried out '
      + 'by Joven Mitchell (Sales Rep), with the homeowner present.',
    );
  });

  it('shows both signatures with the time each was typed', () => {
    const html = certificateHtml(certificateFromWalkthrough(answers(), JOB, COMPANY), sigs());
    expect(html).toContain('James Turner');
    expect(html).toContain('Karen Whitfield');
    expect(html).toContain('For Best Roofing Now');
    expect(html).toMatch(/Signed September 12, 2026/);
  });

  it('says plainly when a signature is missing rather than leaving a blank line', () => {
    const html = certificateHtml(certificateFromWalkthrough(answers(), JOB, COMPANY), sigs({ homeownerSigner: '', homeownerSignedAt: null }));
    expect(html).toContain('Not signed yet');
  });

  it('escapes what a customer name or a homeowner comment drags in', () => {
    const d = certificateFromWalkthrough(answers({ 'Homeowner concerns': 'Call me <b>before</b> 9 & after 5' }), JOB, COMPANY);
    const html = certificateHtml(d, sigs());
    expect(html).toContain('&lt;b&gt;before&lt;/b&gt; 9 &amp; after 5');
    expect(html).not.toContain('<b>before</b>');
  });
});

describe('what stops it going to a carrier', () => {
  it('is nothing, once both names are on a complete certificate', () => {
    expect(certificateBlockers(certificateFromWalkthrough(answers(), JOB, COMPANY), sigs())).toEqual([]);
  });

  it('names each missing signature separately', () => {
    const d = certificateFromWalkthrough(answers(), JOB, COMPANY);
    expect(certificateBlockers(d, sigs({ homeownerSigner: '' }))).toEqual(['Not signed by the homeowner yet']);
    expect(certificateBlockers(d, sigs({ companySigner: '' }))).toEqual(['Not signed by us yet']);
  });

  it('catches a walkthrough with no date on it', () => {
    const d = certificateFromWalkthrough(answers({ Date: '' }), JOB, COMPANY);
    expect(certificateBlockers(d, sigs())).toContain('The walkthrough has no completion date');
  });
});

describe('dates', () => {
  it('reads a calendar day, whatever the browser timezone', () => {
    expect(certDate('2026-01-01')).toBe('January 1, 2026');
    expect(certDate('')).toBe('');
  });
});
