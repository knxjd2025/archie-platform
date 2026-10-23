import { describe, it, expect } from 'vitest';
import {
  meetingClock, minutesOfDay, shortDuration, clockUrgency,
  MEETING_BY_KEY, agendaMinutes, meetingMinutes,
} from '../monday-meetings';

const LEADERSHIP = MEETING_BY_KEY.get('leadership')!;
/** A Monday in September at the given Charlotte wall-clock time (EDT = UTC-4). */
const et = (t: string) => {
  const parts = t.split(':');
  const stamp = `${parts[0]}:${parts[1]}:${parts[2] ?? '00'}`;
  const d = new Date(`2026-09-21T${stamp}-04:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad test time: ${t}`);
  return d;
};

describe('minutesOfDay', () => {
  it("reads the clock in the company's time zone wherever the viewer is", () => {
    expect(minutesOfDay(et('08:00'))).toBeCloseTo(8 * 60, 1);
    expect(minutesOfDay(et('09:30'))).toBeCloseTo(9 * 60 + 30, 1);
    // Same instant, a viewer in London. The meeting is still at 8am Charlotte.
    expect(minutesOfDay(new Date('2026-09-21T12:00:00Z'))).toBeCloseTo(8 * 60, 1);
  });
});

describe('meetingClock', () => {
  it('waits quietly before the meeting starts', () => {
    const c = meetingClock(LEADERSHIP, et('07:30'));
    expect(c.state).toBe('before');
    expect(c.currentItem).toBeNull();
    expect(c.progress).toBe(0);
    expect(c.elapsed).toBeCloseTo(-30, 1);
    expect(clockUrgency(c)).toBe('idle');
  });

  it('knows which item the room should be in', () => {
    // 8:00 Segue · 8:05 Scorecard · 8:10 Rocks · 8:15 Headlines · 8:20 To-dos
    // · 8:25 IDS (60) · 9:25 Conclude
    expect(meetingClock(LEADERSHIP, et('08:02')).currentItem?.title).toBe('Segue');
    expect(meetingClock(LEADERSHIP, et('08:07')).currentItem?.title).toBe('Scorecard');
    expect(meetingClock(LEADERSHIP, et('08:21')).currentItem?.title).toBe('To-dos');
    expect(meetingClock(LEADERSHIP, et('08:30')).currentItem?.title).toContain('IDS');
    expect(meetingClock(LEADERSHIP, et('09:26')).currentItem?.title).toBe('Conclude');
  });

  it('counts down the item and the meeting together', () => {
    const c = meetingClock(LEADERSHIP, et('08:29'));       // four minutes into IDS
    expect(c.currentItem?.title).toContain('IDS');
    expect(c.intoItem).toBeCloseTo(4, 1);
    expect(c.itemRemaining).toBeCloseTo(56, 1);
    expect(c.remaining).toBeCloseTo(61, 1);
  });

  it('takes a boundary as the start of the next item, not the end of the last', () => {
    // 8:05 exactly belongs to Scorecard. Getting this wrong leaves the bar a
    // minute behind the room for the whole meeting.
    expect(meetingClock(LEADERSHIP, et('08:05')).currentItem?.title).toBe('Scorecard');
    expect(meetingClock(LEADERSHIP, et('08:00')).currentItem?.title).toBe('Segue');
  });

  it('goes over rather than pretending the meeting ended on time', () => {
    const c = meetingClock(LEADERSHIP, et('09:45'));
    expect(c.state).toBe('over');
    expect(c.remaining).toBeLessThan(0);
    expect(c.progress).toBe(1);
    expect(clockUrgency(c)).toBe('over');
  });

  it('warns on a proportion of the item, not a flat five minutes', () => {
    // Six of the seven items ARE five minutes long. A flat "5 minutes left"
    // threshold held every one of them amber from the moment it began, which
    // made the warning meaningless — the browser showed Segue amber at 8:02.
    expect(clockUrgency(meetingClock(LEADERSHIP, et('08:02')))).toBe('ok');    // 3m of a 5m Segue
    expect(clockUrgency(meetingClock(LEADERSHIP, et('08:04:30')))).toBe('soon'); // 30s of it left
    expect(clockUrgency(meetingClock(LEADERSHIP, et('08:30')))).toBe('ok');    // 55m of a 60m IDS
    expect(clockUrgency(meetingClock(LEADERSHIP, et('09:10')))).toBe('ok');    // 15m left, still calm
    expect(clockUrgency(meetingClock(LEADERSHIP, et('09:14')))).toBe('soon');  // 11m of 60 = a fifth
    expect(clockUrgency(meetingClock(LEADERSHIP, et('09:45')))).toBe('over');
  });

  it('gives segments that fill the bar exactly once', () => {
    for (const key of ['leadership', 'claims', 'sales', 'payroll'] as const) {
      const m = MEETING_BY_KEY.get(key)!;
      const c = meetingClock(m, et('08:00'));
      expect(c.segments).toHaveLength(m.runningOrder.length);
      const shares = c.segments.reduce((s, x) => s + x.share, 0);
      expect(shares, `${key} segments must fill the bar`).toBeCloseTo(1, 6);
      expect(c.segments[0].startMin).toBe(0);
      expect(c.segments[c.segments.length - 1].endMin).toBe(agendaMinutes(m));
      // Segments must be contiguous — a gap would draw as a rendering fault.
      for (let i = 1; i < c.segments.length; i++) {
        expect(c.segments[i].startMin).toBe(c.segments[i - 1].endMin);
      }
    }
  });

  it('runs the whole length of every meeting without a gap or an early finish', () => {
    for (const key of ['leadership', 'claims', 'sales', 'payroll'] as const) {
      const m = MEETING_BY_KEY.get(key)!;
      expect(agendaMinutes(m), `${key}`).toBe(meetingMinutes(m));
    }
  });
});

describe('shortDuration', () => {
  it('reads at a glance', () => {
    expect(shortDuration(53)).toBe('53m');
    expect(shortDuration(64)).toBe('1h 04m');
    expect(shortDuration(90)).toBe('1h 30m');
    expect(shortDuration(-5)).toBe('0m');
  });
});
