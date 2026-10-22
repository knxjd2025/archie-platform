import { describe, it, expect } from 'vitest';
import {
  MEETINGS, agendaFits, agendaMinutes, canOpenMeeting, meetingDayLabel, meetingMinutes,
  meetingTime, mondayFor, visibleMeetings, weekBefore, ymd,
} from '../monday-meetings';

describe('the Monday schedule', () => {
  it('is the four meetings, back to back, in order', () => {
    expect(MEETINGS.map((m) => m.key)).toEqual(['leadership', 'claims', 'sales', 'payroll']);
    for (let i = 1; i < MEETINGS.length; i++) {
      expect(MEETINGS[i].startMin).toBe(MEETINGS[i - 1].endMin);   // no gaps, no overlaps
    }
  });

  it('runs 8am to 1pm', () => {
    expect(MEETINGS[0].startMin).toBe(8 * 60);
    expect(MEETINGS[MEETINGS.length - 1].endMin).toBe(13 * 60);
  });

  it('reads the times the way an agenda does', () => {
    expect(meetingTime(MEETINGS[0])).toBe('8:00 – 9:30 am');
    expect(meetingTime(MEETINGS[1])).toBe('9:30 – 10:30 am');
    expect(meetingTime(MEETINGS[2])).toBe('10:30 am – 12:00 pm');
    expect(meetingTime(MEETINGS[3])).toBe('12:00 – 1:00 pm');
  });

  it('knows how long each one is', () => {
    expect(MEETINGS.map(meetingMinutes)).toEqual([90, 60, 90, 60]);
  });
});

describe('which Monday a pack belongs to', () => {
  const on = (iso: string, hour = 12) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00-04:00`);

  it('looks forward from Sunday to tomorrow', () => {
    expect(mondayFor(on('2026-09-20'))).toBe('2026-09-21');
  });

  it('stays on this week once Monday has started', () => {
    expect(mondayFor(on('2026-09-21'))).toBe('2026-09-21');
    expect(mondayFor(on('2026-09-23'))).toBe('2026-09-21');   // opened on Wednesday
    expect(mondayFor(on('2026-09-26'))).toBe('2026-09-21');   // and on Saturday
  });

  /**
   * The job runs on Sunday evening in Charlotte, which is already Monday in
   * UTC. Filed by UTC day the pack would land on the wrong Monday and nobody
   * would find it.
   */
  it('files Sunday evening under tomorrow, not under the UTC day', () => {
    const sundayNight = new Date('2026-09-21T01:30:00Z');   // 9:30pm Sunday in Charlotte
    expect(mondayFor(sundayNight)).toBe('2026-09-21');
  });

  it('reports on the week that just finished', () => {
    expect(weekBefore('2026-09-21')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });

  it('crosses a month end without arithmetic trouble', () => {
    expect(weekBefore('2026-10-05')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(mondayFor(new Date('2026-01-01T17:00:00Z'))).toBe('2025-12-29');
  });

  it('labels the day the way it is said', () => {
    expect(meetingDayLabel('2026-09-21')).toBe('Monday, September 21');
  });

  it('formats a date without drifting a day through UTC', () => {
    expect(ymd(new Date(2026, 8, 21))).toBe('2026-09-21');
  });
});

describe('who is in the room', () => {
  it('keeps payroll and leadership to admins', () => {
    for (const role of ['sales', 'production', 'customer_service', 'manager']) {
      expect(canOpenMeeting(role, 'payroll')).toBe(false);
      expect(canOpenMeeting(role, 'leadership')).toBe(false);
    }
    expect(canOpenMeeting('admin', 'payroll')).toBe(true);
    expect(canOpenMeeting('sales_director', 'leadership')).toBe(true);
  });

  it('lets a rep see the sales meeting they sit in', () => {
    expect(canOpenMeeting('sales', 'sales')).toBe(true);
    expect(canOpenMeeting('production', 'sales')).toBe(true);
  });

  it('keeps claims to sales and up', () => {
    expect(canOpenMeeting('sales', 'claims')).toBe(true);
    expect(canOpenMeeting('manager', 'claims')).toBe(true);
    expect(canOpenMeeting('production', 'claims')).toBe(false);
  });

  it('gives an admin all four and a production user one', () => {
    expect(visibleMeetings('admin')).toHaveLength(4);
    expect(visibleMeetings('production').map((m) => m.key)).toEqual(['sales']);
  });
});

describe('the running order', () => {
  it('gives every meeting a written plan', () => {
    for (const m of MEETINGS) {
      expect(m.runningOrder.length, `${m.key} has no running order`).toBeGreaterThan(2);
      for (const item of m.runningOrder) expect(item.minutes).toBeGreaterThan(0);
    }
  });

  /**
   * An agenda totalling more than the meeting has is the commonest way a
   * meeting overruns, and it is checkable rather than a matter of taste.
   */
  it('fits inside the time the meeting actually has', () => {
    for (const m of MEETINGS) {
      expect(agendaFits(m), `${m.key}: ${agendaMinutes(m)} min of agenda in a ${meetingMinutes(m)} min meeting`).toBe(true);
    }
  });

  it('uses the time rather than leaving half the meeting unplanned', () => {
    for (const m of MEETINGS) {
      expect(agendaMinutes(m)).toBeGreaterThanOrEqual(meetingMinutes(m) * 0.75);
    }
  });

  it('ends each meeting by agreeing who does what', () => {
    // The rule is that the room leaves knowing who owes what, not that the
    // item is spelled "Actions" — the L10 meetings call it "Conclude".
    for (const m of MEETINGS) {
      const last = m.runningOrder[m.runningOrder.length - 1];
      const closing = `${last.title} ${last.note ?? ''}`.toLowerCase();
      expect(/action|to-do/.test(closing), `${m.key} does not close on who does what`).toBe(true);
    }
  });

  it('gives every L10 room a scorecard, an issues list and a rating', () => {
    for (const m of MEETINGS.filter((x) => x.key !== 'payroll')) {
      const titles = m.runningOrder.map((i) => i.title.toLowerCase()).join(' | ');
      expect(titles, `${m.key} has no scorecard`).toContain('scorecard');
      expect(titles, `${m.key} has no IDS`).toContain('ids');
      const closing = m.runningOrder[m.runningOrder.length - 1];
      expect(`${closing.note ?? ''}`.toLowerCase(), `${m.key} never rates itself`).toContain('rate');
    }
  });

  it('gives IDS most of the room in every L10 meeting', () => {
    // The whole point of the merge: solving outweighs reporting. If a future
    // edit quietly grows the report sections, this is what catches it.
    for (const m of MEETINGS.filter((x) => x.key !== 'payroll')) {
      const ids = m.runningOrder.find((i) => i.title.toLowerCase().includes('ids'))!;
      const rest = agendaMinutes(m) - ids.minutes;
      expect(ids.minutes, `${m.key}: ${ids.minutes} min solving vs ${rest} min reporting`).toBeGreaterThan(rest);
    }
  });
});
