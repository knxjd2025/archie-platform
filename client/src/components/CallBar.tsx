import { useState } from 'react';
import { useSoftphone, callClock } from '../lib/softphone';

/**
 * The phone, for whoever answers calls at a computer.
 *
 * Renders nothing at all for everyone else — a sales rep whose number rings
 * their mobile should never see this, and should never be asked for the
 * microphone. The hook stays silent when the server says this person has no
 * browser line, so "nothing here" is the normal case rather than a failure.
 *
 * Fixed to the top because a ringing phone has to be findable from whatever
 * screen someone is on, and it sits above the header rather than pushing the
 * page down — a layout that shifts under you as the phone rings is its own
 * kind of awful.
 */
export default function CallBar({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const phone = useSoftphone(true);
  const [dialOpen, setDialOpen] = useState(false);
  const [toDial, setToDial] = useState('');

  // No browser line for this person, or still connecting: show nothing.
  if (phone.state === 'off' || phone.state === 'connecting') return null;

  // Connected and waiting. Stay out of the way, but leave a way to place a
  // call — an office phone you can only answer is half a phone.
  if (phone.state === 'ready') {
    if (!phone.canDial) return null;
    return (
      <div className="fixed bottom-4 right-4 z-40">
        {dialOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = toDial.trim();
              if (!n) return;
              phone.dial(n);
              setToDial('');
              setDialOpen(false);
            }}
            className="bg-white rounded-xl border border-gray-200 shadow-lg p-3 flex items-center gap-2"
          >
            <label htmlFor="softphone-to" className="sr-only">Number to call</label>
            <input
              id="softphone-to"
              value={toDial}
              onChange={(e) => setToDial(e.target.value)}
              placeholder="(555) 555-1234"
              type="tel"
              inputMode="tel"
              autoFocus
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-44 focus:ring-1 focus:ring-blue-400"
            />
            <button type="submit" className="text-sm px-4 py-2 rounded-lg bg-ink text-white font-medium">Call</button>
            <button
              type="button"
              onClick={() => { setDialOpen(false); setToDial(''); }}
              className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600 font-medium"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setDialOpen(true)}
            title={phone.number ? `Call from ${phone.number}` : undefined}
            className="text-sm px-4 py-2.5 rounded-full bg-ink text-white font-medium shadow-lg hover:bg-ink/90"
          >
            📞 New call
          </button>
        )}
      </div>
    );
  }

  const ringing = phone.state === 'ringing';
  const onCall = phone.state === 'on-call';
  const failed = phone.state === 'error';

  const tone = ringing
    ? 'bg-emerald-600'
    : onCall
      ? 'bg-ink'
      : 'bg-red-700';

  return (
    <div
      role="region"
      aria-label="Phone"
      aria-live="assertive"
      className={`fixed top-0 inset-x-0 z-50 ${tone} text-white shadow-lg`}
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
        {ringing && (
          <>
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-70" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">
                {phone.incoming?.name || 'Incoming call'}
              </p>
              <p className="text-xs text-white/80 leading-tight truncate">
                {phone.incoming?.from}
                {phone.label ? ` · to ${phone.label}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {phone.incoming?.leadExternalId && onOpenClient && (
                <button
                  onClick={() => onOpenClient(phone.incoming!.leadExternalId!)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 font-medium"
                >
                  Open their file
                </button>
              )}
              <button
                onClick={phone.decline}
                className="text-sm px-4 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 font-medium"
              >
                Decline
              </button>
              <button
                onClick={phone.answer}
                className="text-sm px-5 py-1.5 rounded-lg bg-white text-emerald-700 font-semibold hover:bg-white/90"
              >
                Answer
              </button>
            </div>
          </>
        )}

        {onCall && (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">
                {phone.incoming?.name || 'On a call'}
              </p>
              <p className="text-xs text-white/80 leading-tight tabular-nums">{callClock(phone.seconds)}</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={phone.toggleMute}
                aria-pressed={phone.muted}
                className={`text-sm px-4 py-1.5 rounded-lg font-medium ${
                  phone.muted ? 'bg-white text-ink' : 'bg-white/15 hover:bg-white/25'
                }`}
              >
                {phone.muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={phone.hangUp}
                className="text-sm px-5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 font-semibold"
              >
                Hang up
              </button>
            </div>
          </>
        )}

        {failed && (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-white shrink-0" aria-hidden="true" />
            <p className="text-sm min-w-0 truncate">
              {phone.error || 'The phone is not working.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 font-medium"
            >
              Reload
            </button>
          </>
        )}
      </div>
    </div>
  );
}
