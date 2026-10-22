import { describe, it, expect } from 'vitest';
import { inferOwner, type RepIdentity, type JobEvidence } from '../infer-owner';

const JAMES: RepIdentity = { teamMemberId: 1, repName: 'James Turner', email: 'james@bestroofingnow.com', isFieldRep: false };
const BANNING: RepIdentity = { teamMemberId: 3, repName: 'Banning Rumsey', email: 'banning@bestroofingnow.com', isFieldRep: true };
const THOMAS: RepIdentity = { teamMemberId: 4, repName: 'Thomas Bramhill', email: 'thomas@bestroofingnow.com', isFieldRep: true };
const REPS = [JAMES, BANNING, THOMAS];

const ev = (o: Partial<JobEvidence> = {}): JobEvidence => ({
  taskAssignees: [], commenters: [], calendarMailboxes: [], jtSalesRep: null, ...o,
});

describe('inferOwner — the team\'s rules', () => {
  it('a field rep on the job IS the rep', () => {
    // "if you see Banning attached to any job then consider him the sales rep"
    const s = inferOwner(ev({ taskAssignees: ['Banning Rumsey'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.confidence).toBe('high');
    expect(s.secondary).toEqual([]);
  });

  it('Thomas on the job means Thomas', () => {
    // Real case: "L Hinson 0517" has a task assigned to Thomas while James and
    // an office admin appear in the comments.
    const s = inferOwner(ev({ taskAssignees: ['Thomas Bramhill'], commenters: ['Mac Jacinto', 'James Turner'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(4);
    expect(s.confidence).toBe('high');
  });

  it('the owner alone on a job means it is his', () => {
    const s = inferOwner(ev({ taskAssignees: ['James Turner'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(1);
    expect(s.secondary).toEqual([]);
  });

  it('a field rep beats the owner, who becomes the shared second', () => {
    // Real case: "D Carmicahel" has both James and Banning. Banning runs it;
    // James being there means he is helping, not that ownership is unclear.
    const s = inferOwner(ev({ taskAssignees: ['James Turner', 'Banning Rumsey'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.secondary.map((x) => x.teamMemberId)).toEqual([1]);
    expect(s.confidence).toBe('high');
  });

  it('two field reps is a real tie — flagged for a human, not guessed silently', () => {
    const s = inferOwner(ev({ taskAssignees: ['Banning Rumsey', 'Thomas Bramhill'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.secondary.map((x) => x.teamMemberId)).toEqual([4]);
    expect(s.confidence).toBe('medium');
    expect(s.reason).toMatch(/confirm who owns it/i);
  });
});

describe('evidence precedence', () => {
  it('an explicitly set Sales Rep wins over inference', () => {
    // Somebody already decided; do not second-guess it from task noise.
    const s = inferOwner(ev({ jtSalesRep: 'Thomas Bramhill', taskAssignees: ['Banning Rumsey'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(4);
    expect(s.source).toBe('jt_sales_rep');
    expect(s.confidence).toBe('high');
  });

  it('tasks beat comments', () => {
    const s = inferOwner(ev({ taskAssignees: ['Banning Rumsey'], commenters: ['Thomas Bramhill'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.source).toBe('jobtread_task');
  });

  it('rates the owner merely commenting as weak', () => {
    // James comments on nearly everything, so his comment is not ownership.
    const s = inferOwner(ev({ commenters: ['James Turner'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(1);
    expect(s.confidence).toBe('low');
  });

  it('rates a field rep commenting as worth a look', () => {
    const s = inferOwner(ev({ commenters: ['Banning Rumsey'] }), REPS);
    expect(s.confidence).toBe('medium');
  });

  it('falls back to whose calendar the appointment landed on', () => {
    const s = inferOwner(ev({ calendarMailboxes: ['banning@bestroofingnow.com'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.source).toBe('calendar');
    expect(s.confidence).toBe('medium');
  });
});

describe('safety', () => {
  it('never suggests someone who is not a rep', () => {
    // Mac Jacinto is a JobTread admin with no app login; office staff comment
    // on jobs constantly. Suggesting them would move commission to a
    // non-existent account.
    const s = inferOwner(ev({ taskAssignees: ['Mac Jacinto'], commenters: ['Office Admin'] }), REPS);
    expect(s.primary).toBeNull();
    expect(s.source).toBe('none');
  });

  it('returns no suggestion rather than a bad one when there is no evidence', () => {
    const s = inferOwner(ev(), REPS);
    expect(s.primary).toBeNull();
    expect(s.confidence).toBe('low');
    expect(s.reason).toMatch(/assign by hand/i);
  });

  it('ignores an unrecognised Sales Rep value instead of trusting it', () => {
    // A stale or misspelled dropdown value must fall through to evidence.
    const s = inferOwner(ev({ jtSalesRep: 'Former Employee', taskAssignees: ['Banning Rumsey'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.source).toBe('jobtread_task');
  });

  it('matches names case- and whitespace-insensitively', () => {
    expect(inferOwner(ev({ taskAssignees: ['  banning rumsey '] }), REPS).primary?.teamMemberId).toBe(3);
  });

  it('does not list the same person twice', () => {
    const s = inferOwner(ev({ taskAssignees: ['Banning Rumsey', 'Banning Rumsey', 'James Turner'] }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.secondary).toHaveLength(1);
  });

  it('always explains itself', () => {
    // Every suggestion is reviewed by a human, so a bare name is not enough.
    for (const e of [
      ev({ taskAssignees: ['Banning Rumsey'] }),
      ev({ commenters: ['James Turner'] }),
      ev({ calendarMailboxes: ['thomas@bestroofingnow.com'] }),
      ev(),
    ]) {
      expect(inferOwner(e, REPS).reason.length).toBeGreaterThan(10);
    }
  });
});

/**
 * The rule at the top of the module — a field rep on the job IS the rep, the
 * owner being there too means he is helping — used to apply only WITHIN one
 * signal. Across signals the owner won on precedence, and since he is assigned
 * tasks on most jobs, the calendar was never reached. Real cases: R Jones
 * 0257, R Taylor 0298 and Job 0391 all resolved to James on his tasks while
 * the only appointment sat in a field rep's diary.
 */
describe('a field rep\'s diary beats the owner\'s paperwork', () => {
  it('prefers the rep who drove there over the owner who has the task', () => {
    const s = inferOwner(ev({
      taskAssignees: ['James Turner'],
      calendarMailboxes: ['banning@bestroofingnow.com'],
    }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);
    expect(s.source).toBe('calendar');
    expect(s.secondary.map((x) => x.teamMemberId)).toEqual([1]);   // James kept as helping
    expect(s.reason).toMatch(/helping/);
  });

  it('does the same when the owner only commented', () => {
    const s = inferOwner(ev({
      commenters: ['James Turner'],
      calendarMailboxes: ['thomas@bestroofingnow.com'],
    }), REPS);
    expect(s.primary?.teamMemberId).toBe(4);
    expect(s.source).toBe('calendar');
  });

  it('leaves a field rep with tasks exactly where they were', () => {
    const s = inferOwner(ev({
      taskAssignees: ['Banning Rumsey'],
      calendarMailboxes: ['thomas@bestroofingnow.com'],
    }), REPS);
    expect(s.primary?.teamMemberId).toBe(3);     // tasks still win for a field rep
    expect(s.source).toBe('jobtread_task');
  });

  it('will not guess when two field reps both have it in their diary', () => {
    const s = inferOwner(ev({
      taskAssignees: ['James Turner'],
      calendarMailboxes: ['banning@bestroofingnow.com', 'thomas@bestroofingnow.com'],
    }), REPS);
    expect(s.primary?.teamMemberId).toBe(1);     // falls back to the owner's tasks
    expect(s.source).toBe('jobtread_task');
  });

  it('ignores a calendar that is only the office', () => {
    const s = inferOwner(ev({
      taskAssignees: ['James Turner'],
      calendarMailboxes: ['admin@bestroofingnow.com', 'james@bestroofingnow.com'],
    }), REPS);
    expect(s.primary?.teamMemberId).toBe(1);
    expect(s.source).toBe('jobtread_task');
  });
});
