import { describe, it, expect } from 'vitest';
import {
  WALKTHROUGH_FIELDS, WALKTHROUGH_SECTIONS, missingRequiredWalkthroughFields, walkthroughIssues, walkthroughTally, verifyAnswer,
} from '../final-walkthrough';

/** Every required field answered the "all clear" way. */
function allClear(): Record<string, any> {
  const a: Record<string, any> = {};
  for (const f of WALKTHROUGH_FIELDS) {
    if (f.type === 'verify') a[f.name] = { state: 'ok' };
    else if (f.type === 'photo') a[f.name] = [{ fileId: 'x', name: 'x.jpg' }];
    else if (f.type === 'checkbox') a[f.name] = true;
    else if (f.type === 'option') a[f.name] = f.options![0];
    else if (f.type === 'date') a[f.name] = '2026-09-14';
    else a[f.name] = 'filled';
  }
  return a;
}

describe('the final walkthrough schema', () => {
  it('covers the three things it exists for: nails, damage, leftovers — plus the roof and the homeowner', () => {
    expect(WALKTHROUGH_SECTIONS).toEqual(['Basics', 'Nail Sweep', 'Cleanup & Leftovers', 'Property Check', 'Roof Check', 'Homeowner', 'Sign-Off']);
    const names = WALKTHROUGH_FIELDS.map((f) => f.name.toLowerCase());
    expect(names.filter((n) => n.includes('magnetic sweep')).length).toBeGreaterThanOrEqual(4);
    expect(names.some((n) => n.includes('leftover material'))).toBe(true);
    expect(names.some((n) => n.includes('dumpster'))).toBe(true);
    expect(names.some((n) => n.includes('gutters and downspouts cleared'))).toBe(true);
    expect(names.some((n) => n.includes('exposed nails'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a fully-passed walkthrough has nothing missing and no issues', () => {
    const a = allClear();
    expect(missingRequiredWalkthroughFields(a)).toEqual([]);
    expect(walkthroughIssues(a)).toEqual([]);
    expect(walkthroughTally(a).issue).toBe(0);
    expect(walkthroughTally(a).unanswered).toBe(0);
  });

  it('an Issue needs a note before it counts as answered, and then becomes a follow-up', () => {
    const a = allClear();
    a['Gutters and downspouts cleared of nails, granules and debris'] = { state: 'issue' };
    expect(missingRequiredWalkthroughFields(a)).toEqual(['Gutters and downspouts cleared of nails, granules and debris']);
    a['Gutters and downspouts cleared of nails, granules and debris'] = { state: 'issue', note: 'Rear gutter still full of granules' };
    expect(missingRequiredWalkthroughFields(a)).toEqual([]);
    expect(walkthroughIssues(a)).toEqual([{ item: 'Gutters and downspouts cleared of nails, granules and debris', section: 'Nail Sweep', note: 'Rear gutter still full of granules' }]);
    // An optional item flagged as an Issue still needs its note.
    a['Satellite dish reinstalled and pointing; homeowner confirmed signal'] = { state: 'issue' };
    expect(missingRequiredWalkthroughFields(a)).toContain('Satellite dish reinstalled and pointing; homeowner confirmed signal');
  });

  it('the homeowner signature is required exactly when the homeowner was present', () => {
    const a = allClear();
    a['Homeowner present'] = 'Yes'; delete a['Homeowner signature'];
    expect(missingRequiredWalkthroughFields(a)).toEqual(['Homeowner signature']);
    a['Homeowner present'] = 'No';
    expect(missingRequiredWalkthroughFields(a)).toEqual([]);
  });

  it('rejects malformed verify answers', () => {
    expect(verifyAnswer('ok')).toBeNull();
    expect(verifyAnswer({ state: 'maybe' })).toBeNull();
    expect(verifyAnswer({ state: 'na', note: '  ' })).toEqual({ state: 'na' });
    const a = allClear();
    a['Magnetic sweep — lawn, flower beds, mulch'] = 'ok';
    expect(missingRequiredWalkthroughFields(a)).toEqual(['Magnetic sweep — lawn, flower beds, mulch']);
    expect(walkthroughTally(a).unanswered).toBe(1);
  });
});
