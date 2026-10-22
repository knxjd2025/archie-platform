import { describe, it, expect } from 'vitest';
import { formatWalkthroughForJobTread, cleanAnswers } from '../routes';

describe('formatWalkthroughForJobTread', () => {
  it('leads with who / when / the tally, then every issue as its own line', () => {
    const text = formatWalkthroughForJobTread({
      'Walked by': 'Sam Rep', Role: 'Sales Rep', Date: '2026-09-14', 'Homeowner present': 'Yes', 'Final balance': 'Paid in full',
      'Magnetic sweep — driveway, walkways, garage apron': { state: 'ok' },
      'Driveway and concrete — no cracks, chips or dumpster marks': { state: 'issue', note: 'Scuff from the dumpster wheel, left of garage' },
      'Satellite dish reinstalled and pointing; homeowner confirmed signal': { state: 'na' },
      'Explained the warranty, roof care and what to expect': true,
      'Homeowner concerns': 'Wants the gutter guard quote',
    });
    expect(text).toContain('Walked by: Sam Rep (Sales Rep)');
    expect(text).toContain('Checks: 1 passed · 1 issue · 1 n/a');
    expect(text).toContain('ISSUES (1) — follow-ups created:');
    expect(text).toContain('• [Property Check] Driveway and concrete — no cracks, chips or dumpster marks — Scuff from the dumpster wheel, left of garage');
    expect(text).toContain('Explained the warranty, roof care and what to expect: Yes');
    expect(text).toContain('Homeowner concerns: Wants the gutter guard quote');
    expect(text).not.toContain('Additional notes:'); // empty long text is dropped
  });

  it('says so when there is nothing wrong', () => {
    expect(formatWalkthroughForJobTread({ 'Walked by': 'PM' })).toContain('No issues found.');
  });
});

describe('cleanAnswers', () => {
  it('keeps known fields, normalizes verify answers, drops junk', () => {
    const out = cleanAnswers({
      'Walked by': 'Sam',
      'Magnetic sweep — driveway, walkways, garage apron': { state: 'issue', note: ' nails by the mailbox ', extra: 1 },
      'Magnetic sweep — lawn, flower beds, mulch': { state: 'bogus' },
      'Not a field': 'x',
    });
    expect(out).toEqual({
      'Walked by': 'Sam',
      'Magnetic sweep — driveway, walkways, garage apron': { state: 'issue', note: 'nails by the mailbox' },
    });
    expect(cleanAnswers(null)).toEqual({});
    expect(cleanAnswers('str')).toEqual({});
  });

  it('keeps a null verify answer, because that is how a merged save clears a point', () => {
    const key = 'Magnetic sweep — driveway, walkways, garage apron';
    expect(cleanAnswers({ [key]: null })).toEqual({ [key]: null });
    expect(cleanAnswers({ [key]: undefined })).toEqual({});
  });
});
