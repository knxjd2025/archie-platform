/**
 * What happens to the browser's roof report drafts when a person signs out, a
 * session ends, someone else signs in on the same browser, or the roof reports
 * page loads. A draft holds a homeowner's name, email, phone, address and the
 * inspector's notes, so it must not outlive the sign-in it belongs to.
 * Pure functions over a fake storage.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRAFT_TTL_MS, draftKey, emptyDraft, writeDraft, type StorageLike } from '../draft';
import { forgetAllDrafts, forgetDraftsOfOthers, sweepExpiredDrafts } from '../draft-clean';

type Fake = StorageLike & { data: Map<string, string>; readonly length: number; key(i: number): string | null };
const memory = (): Fake => {
  const data = new Map<string, string>();
  return {
    data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); },
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
  };
};
const COMPANY = '5b0f3f0e-1f0a-4a3e-8a37-2f7f4b5a8a11';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const NOW = Date.parse('2026-11-24T15:00:00Z');
const dana = draftKey(COMPANY, 'dana@example.com')!;
const lee = draftKey(COMPANY, 'lee@example.com')!;
const danaElsewhere = draftKey(OTHER, 'dana@example.com')!;
const draft = () => ({ ...emptyDraft(), where: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', job: null } });

function seeded(): Fake {
  const s = memory();
  writeDraft(s, dana, draft(), NOW);
  writeDraft(s, lee, draft(), NOW);
  writeDraft(s, danaElsewhere, draft(), NOW);
  s.setItem(`${dana}.open`, '1');
  s.setItem(`${lee}.open`, '1');
  s.setItem('archie.session', '{"email":"dana@example.com"}');
  s.setItem('something.else', 'x');
  return s;
}

describe('forgetAllDrafts', () => {
  it('removes every roof report draft key, and the open markers, and nothing else', () => {
    const s = seeded();
    expect(forgetAllDrafts(s)).toBe(5);
    expect([...s.data.keys()].sort()).toEqual(['archie.session', 'something.else']);
  });
  it('does nothing, and does not throw, with no storage or storage that refuses', () => {
    expect(forgetAllDrafts(null)).toBe(0);
    const broken = { length: 1, key: () => { throw new Error('blocked'); }, getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => { throw new Error('blocked'); } } as unknown as Fake;
    expect(() => forgetAllDrafts(broken)).not.toThrow();
  });
});

describe('forgetDraftsOfOthers', () => {
  it('keeps this person\'s drafts in every company, and removes everyone else\'s', () => {
    const s = seeded();
    forgetDraftsOfOthers(s, 'Dana@Example.com');
    expect([...s.data.keys()].sort()).toEqual([`${dana}.open`, dana, danaElsewhere, 'archie.session', 'something.else'].sort());
  });
  it('removes every draft when nobody is signed in', () => {
    const s = seeded();
    forgetDraftsOfOthers(s, null);
    expect([...s.data.keys()].sort()).toEqual(['archie.session', 'something.else']);
  });
  it('does not mistake a longer email that ends the same way for this person', () => {
    const s = memory();
    writeDraft(s, draftKey(COMPANY, 'x@a.com')!, draft(), NOW);
    writeDraft(s, draftKey(COMPANY, 'foo.x@a.com')!, draft(), NOW);
    forgetDraftsOfOthers(s, 'x@a.com');
    expect([...s.data.keys()]).toEqual([draftKey(COMPANY, 'x@a.com')]);
  });
});

describe('sweepExpiredDrafts', () => {
  it('removes any draft past its day, one from a clock far ahead, one that is not JSON and one of another version, whoever it belongs to', () => {
    const s = memory();
    writeDraft(s, dana, draft(), NOW - 1000);
    writeDraft(s, lee, draft(), NOW - DRAFT_TTL_MS - 1);
    writeDraft(s, danaElsewhere, draft(), NOW + 60 * 60 * 1000);
    s.setItem(draftKey(OTHER, 'mia@example.com')!, 'not json');
    s.setItem(draftKey(OTHER, 'ned@example.com')!, JSON.stringify({ v: 99, savedAt: NOW, draft: {} }));
    s.setItem('archie.session', 'keep');
    expect(sweepExpiredDrafts(s, NOW)).toBe(4);
    expect([...s.data.keys()].sort()).toEqual([dana, 'archie.session'].sort());
  });
  it('leaves a draft saved just under a day ago', () => {
    const s = memory();
    writeDraft(s, dana, draft(), NOW - DRAFT_TTL_MS + 1000);
    expect(sweepExpiredDrafts(s, NOW)).toBe(0);
    expect(s.data.has(dana)).toBe(true);
  });
  it('does not throw with no storage', () => {
    expect(sweepExpiredDrafts(null, NOW)).toBe(0);
  });
});

describe('where the clearing is wired', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('runs on sign-out, on a session that ends (the event and a 401), and when someone signs in', () => {
    const auth = src('../../lib/auth.tsx');
    expect(auth.match(/forgetRoofReportDrafts\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(auth).toMatch(/forgetRoofReportDraftsOfOthers\(u\.email\)/);
    const signOut = auth.slice(auth.indexOf('async function signOut'));
    expect(signOut.slice(0, signOut.indexOf('\n  }\n'))).toMatch(/forgetRoofReportDrafts\(\)/);
    const expired = auth.slice(auth.indexOf('const onExpired'), auth.indexOf('window.addEventListener(SESSION_EXPIRED_EVENT'));
    expect(expired).toMatch(/forgetRoofReportDrafts\(\)/);
  });
  it('sweeps expired drafts when the roof reports page loads', () => {
    expect(src('../../pages/roof-reports.tsx')).toMatch(/sweepExpiredRoofReportDrafts\(\)/);
  });
});
