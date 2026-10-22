import { describe, it, expect } from 'vitest';
import {
  scorecardStatus, quarterOf, weeksOpen, topIssues, isOpenIssue,
  todoCompletion, averageRating, isValidRating, TODO_BAR,
  type MeetingIssue,
} from '../monday-meetings';

const issue = (id: number, over: Partial<MeetingIssue> = {}): MeetingIssue => ({
  id, meeting: 'leadership', title: `issue ${id}`, detail: null, source: 'pack',
  sourceKey: null, raisedBy: null, raisedAt: null, firstSeenWeek: '2026-09-21',
  priority: null, solvedAt: null, solvedNote: null, droppedAt: null, ...over,
});

describe('scorecardStatus', () => {
  it('judges a number against its goal in the direction that matters', () => {
    expect(scorecardStatus(10, 10, 'at_least')).toBe('on');
    expect(scorecardStatus(9, 10, 'at_least')).toBe('off');
    expect(scorecardStatus(3, 5, 'at_most')).toBe('on');
    expect(scorecardStatus(6, 5, 'at_most')).toBe('off');
  });

  it('calls a goalless metric unset rather than passing it', () => {
    // An unset goal is the finding. Defaulting it to "on track" would hide
    // exactly the metric nobody has taken responsibility for.
    expect(scorecardStatus(6, null, 'at_least')).toBe('unset');
    expect(scorecardStatus(null, 10, 'at_least')).toBe('nodata');
    expect(scorecardStatus(6, NaN, 'at_least')).toBe('unset');
  });

  it('treats zero as a real goal and a real reading', () => {
    expect(scorecardStatus(0, 0, 'at_most')).toBe('on');
    expect(scorecardStatus(1, 0, 'at_most')).toBe('off');
    expect(scorecardStatus(0, 1, 'at_least')).toBe('off');
  });
});

describe('quarterOf', () => {
  it('maps a date to its quarter', () => {
    expect(quarterOf('2026-01-01')).toBe('2026-Q1');
    expect(quarterOf('2026-03-31')).toBe('2026-Q1');
    expect(quarterOf('2026-09-21')).toBe('2026-Q3');
    expect(quarterOf('2026-12-31')).toBe('2026-Q4');
  });
});

describe('weeksOpen', () => {
  it('counts whole weeks since the issue first appeared', () => {
    expect(weeksOpen('2026-09-21', '2026-09-21')).toBe(0);
    expect(weeksOpen('2026-09-14', '2026-09-21')).toBe(1);
    expect(weeksOpen('2026-08-24', '2026-09-21')).toBe(4);
  });

  it('never goes negative, and survives a missing or broken week', () => {
    expect(weeksOpen('2026-10-05', '2026-09-21')).toBe(0);
    expect(weeksOpen(null, '2026-09-21')).toBe(0);
    expect(weeksOpen('nonsense', '2026-09-21')).toBe(0);
  });
});

describe('topIssues', () => {
  it("takes the room's own picks first, in the order it picked them", () => {
    const picked = topIssues([
      issue(1), issue(2, { priority: 2 }), issue(3, { priority: 1 }),
    ], '2026-09-21');
    expect(picked.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('otherwise surfaces the longest-running issue first', () => {
    const picked = topIssues([
      issue(1, { firstSeenWeek: '2026-09-14' }),
      issue(2, { firstSeenWeek: '2026-07-06' }),
      issue(3, { firstSeenWeek: '2026-09-21' }),
    ], '2026-09-21');
    expect(picked.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('never offers a solved or dropped issue, and stops at three', () => {
    const all = [
      issue(1, { solvedAt: '2026-09-15T00:00:00Z' }),
      issue(2, { droppedAt: '2026-09-15T00:00:00Z' }),
      issue(3), issue(4), issue(5), issue(6),
    ];
    const picked = topIssues(all, '2026-09-21');
    expect(picked).toHaveLength(3);
    expect(picked.some((i) => !isOpenIssue(i))).toBe(false);
  });

  it('does not mutate the list it was handed', () => {
    const all = [issue(3), issue(1), issue(2)];
    topIssues(all, '2026-09-21');
    expect(all.map((i) => i.id)).toEqual([3, 1, 2]);
  });
});

describe('todoCompletion', () => {
  it('measures last week against the 90% bar', () => {
    const nine = Array.from({ length: 10 }, (_, i) => ({ doneAt: i < 9 ? 'x' : null }));
    expect(todoCompletion(nine)).toMatchObject({ done: 9, total: 10, meetsBar: true });
    expect(todoCompletion(nine).pct).toBeCloseTo(TODO_BAR);

    const eight = Array.from({ length: 10 }, (_, i) => ({ doneAt: i < 8 ? 'x' : null }));
    expect(todoCompletion(eight).meetsBar).toBe(false);
  });

  it('does not fail a week that committed to nothing', () => {
    expect(todoCompletion([])).toMatchObject({ done: 0, total: 0, pct: null, meetsBar: true });
  });
});

describe('meeting rating', () => {
  it('accepts whole scores of 1 to 10 and nothing else', () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(10)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(11)).toBe(false);
    expect(isValidRating(7.5)).toBe(false);
    expect(isValidRating('8')).toBe(false);
  });

  it('averages the room to one decimal, ignoring junk', () => {
    expect(averageRating([8, 9, 10])).toBe(9);
    expect(averageRating([8, 9])).toBe(8.5);
    expect(averageRating([7, 8, 8])).toBe(7.7);
    expect(averageRating([8, 99, -1])).toBe(8);
    expect(averageRating([])).toBeNull();
  });
});
