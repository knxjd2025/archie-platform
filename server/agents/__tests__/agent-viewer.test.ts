import { describe, it, expect } from 'vitest';
import { viewerOwnsRep, type AgentViewer } from '../team-agents';

const UNRESTRICTED: AgentViewer = { repNames: null };
const REP: AgentViewer = { repNames: ['banning rumsey'] };
const LEADER: AgentViewer = { repNames: ['james turner', 'banning rumsey', 'thomas bramhill'] };
const NOBODY: AgentViewer = { repNames: [] };

describe('viewerOwnsRep', () => {
  it('lets a director or admin see any rep', () => {
    expect(viewerOwnsRep(UNRESTRICTED, 'Anyone At All')).toBe(true);
    expect(viewerOwnsRep(UNRESTRICTED, null)).toBe(true);
  });

  it('limits a rep to their own work', () => {
    // The bug this closes: a sales rep could ask the sales advisor to
    // "list commissions" and receive every rep's revenue, profit and pay.
    expect(viewerOwnsRep(REP, 'Banning Rumsey')).toBe(true);
    expect(viewerOwnsRep(REP, 'Thomas Bramhill')).toBe(false);
    expect(viewerOwnsRep(REP, 'James Turner')).toBe(false);
  });

  it('gives a leader their whole team', () => {
    for (const r of ['James Turner', 'Banning Rumsey', 'Thomas Bramhill']) {
      expect(viewerOwnsRep(LEADER, r), r).toBe(true);
    }
    expect(viewerOwnsRep(LEADER, 'Someone Else')).toBe(false);
  });

  it('matches case-insensitively', () => {
    // JobTread stores the dropdown value with original casing; the visible
    // list is lowercased. A case mismatch here silently hides a rep's own work.
    for (const v of ['BANNING RUMSEY', 'banning rumsey', 'Banning Rumsey']) {
      expect(viewerOwnsRep(REP, v), v).toBe(true);
    }
  });

  it('treats unassigned work as not yours', () => {
    // An unassigned job belongs to nobody; handing it to whoever asks would
    // leak every un-attributed job to every rep.
    for (const empty of [null, undefined, '']) {
      expect(viewerOwnsRep(REP, empty)).toBe(false);
    }
  });

  it('shows nothing to a viewer who owns nothing', () => {
    expect(viewerOwnsRep(NOBODY, 'Banning Rumsey')).toBe(false);
  });

  it('treats a missing viewer as unrestricted only when explicitly absent', () => {
    // undefined means "no scoping requested" (internal/system callers).
    // An empty repNames array is the opposite and must show nothing — the two
    // must never be conflated.
    expect(viewerOwnsRep(undefined, 'Anyone')).toBe(true);
    expect(viewerOwnsRep(NOBODY, 'Anyone')).toBe(false);
  });
});
