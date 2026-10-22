import { useEffect, useState } from 'react';
import {
  type MeetingDef, meetingClock, meetingTime, shortDuration, clockUrgency,
} from '../../../shared/monday-meetings';

/**
 * Where the meeting is, across the top of the page.
 *
 * An L10 is time-boxed or it is not an L10 — the running order gives IDS sixty
 * of the ninety minutes, and without something showing the room where it
 * actually is, that stays an intention. The bar is the running order drawn to
 * scale: each item's width is its time box, the fill is the clock, and the
 * item the room should be in is the one lit up.
 *
 * It only runs live on the day. Opening last week's pack shows the plan
 * without a "now" marker, because a countdown against a meeting that finished
 * days ago is noise.
 */
export function MeetingBar({ meeting, live }: { meeting: MeetingDef; live: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!live) return;
    // Fifteen seconds: the readout is in whole minutes, so this is frequent
    // enough that the number is never visibly stale and rare enough to be free.
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, [live]);

  const clock = meetingClock(meeting, now);
  const urgency = live ? clockUrgency(clock) : 'idle';

  const fill =
    urgency === 'over' ? 'bg-red-500'
    : urgency === 'soon' ? 'bg-amber-500'
    : 'bg-blue-600';
  const edge =
    urgency === 'over' ? 'border-red-200 bg-red-50'
    : urgency === 'soon' ? 'border-amber-200 bg-amber-50'
    : 'border-gray-200 bg-white';

  const headline =
    !live ? meetingTime(meeting)
    : clock.state === 'before' ? `starts in ${shortDuration(-clock.elapsed)}`
    : clock.state === 'over' ? `over by ${shortDuration(-clock.remaining)}`
    : `${shortDuration(clock.remaining)} left`;

  return (
    <div className={`sticky top-0 z-20 -mx-3 sm:mx-0 px-3 sm:px-3.5 py-2.5 border-b sm:border sm:rounded-xl ${edge}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {meeting.label}
          <span className="ml-2 text-[11px] font-normal text-gray-500">{meetingTime(meeting)}</span>
        </p>
        <p
          className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
            urgency === 'over' ? 'text-red-700' : urgency === 'soon' ? 'text-amber-700' : 'text-gray-700'
          }`}
        >
          {headline}
        </p>
      </div>

      {/* The running order, drawn to scale. Segment widths are the time boxes. */}
      <div
        className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clock.progress * 100)}
        aria-label={`${meeting.label} progress`}
      >
        {clock.segments.map((s, i) => {
          const done = live ? Math.min(1, Math.max(0, (clock.elapsed - s.startMin) / s.item.minutes)) : 0;
          return (
            <div
              key={i}
              style={{ width: `${s.share * 100}%` }}
              className={`relative h-full ${i > 0 ? 'border-l border-white' : ''}`}
              title={`${s.item.title} · ${s.item.minutes} min`}
            >
              <div className={`h-full ${fill}`} style={{ width: `${done * 100}%` }} />
            </div>
          );
        })}
      </div>

      {/* Labels only where they can be read; below that the line underneath carries it. */}
      <div className="mt-1 hidden md:flex w-full text-[10px] leading-tight">
        {clock.segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${s.share * 100}%` }}
            className={`truncate pr-1 ${
              live && clock.currentIndex === i ? 'font-semibold text-gray-900' : 'text-gray-400'
            }`}
          >
            {s.item.title.replace(' — identify, discuss, solve', '')}
          </div>
        ))}
      </div>

      {live && clock.state === 'running' && clock.currentItem && (
        <p className="mt-1 text-[11px] text-gray-600">
          <span className="font-semibold text-gray-900">Now: {clock.currentItem.title}</span>
          {' — '}{shortDuration(clock.intoItem)} in, {shortDuration(clock.itemRemaining)} left
          {clock.currentItem.note && <span className="hidden sm:inline text-gray-400"> · {clock.currentItem.note}</span>}
        </p>
      )}
      {live && clock.state === 'before' && (
        <p className="mt-1 text-[11px] text-gray-500">First up: {meeting.runningOrder[0]?.title}</p>
      )}
      {live && clock.state === 'over' && (
        <p className="mt-1 text-[11px] text-red-700">Past time — close it out and agree who does what.</p>
      )}
    </div>
  );
}
