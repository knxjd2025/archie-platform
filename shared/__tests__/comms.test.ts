import { describe, it, expect } from 'vitest';
import { toE164, last10Digits, ourSide, ghlCallToRow, ghlMessageToRow, callOutcome, connectStats } from '../comms';

/** The four numbers the business actually owns, read from GHL on 2026-09-19. */
const OURS = ['+19809466044', '+19804411330', '+17043683951', '+19804857732'];

describe('toE164', () => {
  it('settles on one spelling for the same number', () => {
    for (const v of ['+1 (704) 368-3951', '7043683951', '17043683951', '+17043683951']) {
      expect(toE164(v), v).toBe('+17043683951');
    }
  });
  it('leaves an email address alone', () => {
    expect(toE164('James@BestRoofingNow.com')).toBe('james@bestroofingnow.com');
  });
  it('has nothing to say about nothing', () => {
    expect(toE164('')).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164('   ')).toBeNull();
  });

  // Anything else used to get a `+` in front of whatever digits it held, so an
  // extension or a seven-digit number became a number that does not exist.
  it.each([
    ['(704) 368-3951', '+17043683951'],
    ['704.368.3951', '+17043683951'],
    ['1-704-368-3951', '+17043683951'],
    ['704-368-3951 x12', '+17043683951'],
    ['704-368-3951 ext. 12', '+17043683951'],
    ['704-368-3951 extension 4', '+17043683951'],
    ['7043683951#22', '+17043683951'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+1 (704) 368-3951', '+17043683951'],
  ])('reads %s as %s', (raw, want) => {
    expect(toE164(raw)).toBe(want);
  });

  it.each([
    ['555-1234'],
    ['70436839'],
    ['27043683951'],
    ['704368395112'],
    ['+1234567'],
    ['+1234567890123456'],
    ['call me'],
    ['client:james'],
  ])('refuses %s', (raw) => {
    expect(toE164(raw)).toBeNull();
  });
});

describe('last10Digits', () => {
  it('is the part a stored number and a provider number agree on', () => {
    expect(last10Digits('(704) 368-3951')).toBe('7043683951');
    expect(last10Digits('+17043683951')).toBe('7043683951');
    expect(last10Digits(null)).toBe('');
  });
});

describe('ourSide', () => {
  it('finds our number whichever end of the call it is on', () => {
    expect(ourSide('+17043683951', '+19542749588', OURS)).toBe('+17043683951');
    expect(ourSide('+19542749588', '+19809466044', OURS)).toBe('+19809466044');
  });
  it('returns nothing when neither end is ours', () => {
    expect(ourSide('+19542749588', '+12125550000', OURS)).toBeNull();
  });
});

describe('ghlCallToRow', () => {
  // Verbatim from the live GHL API, 2026-09-18.
  const real = {
    id: 'K1PPiUZZ71IufDhL659A', direction: 'outbound', status: 'completed', type: 1,
    dateAdded: '2026-09-18T15:34:27.744Z', dateUpdated: '2026-09-18T15:35:19.026Z',
    meta: { call: { duration: 4, status: 'completed' } },
    altId: 'CA27359f2464922d9c68ac722f604959f4',
    from: '+17043683951', to: '+19542749588', messageType: 'TYPE_CALL',
  };

  it('keys the row on the Twilio Call SID, which is what makes the cutover boring', () => {
    const row = ghlCallToRow(real, OURS)!;
    expect(row.providerSid).toBe('CA27359f2464922d9c68ac722f604959f4');
    expect(row.direction).toBe('outbound');
    expect(row.ourNumber).toBe('+17043683951');
    expect(row.durationSeconds).toBe(4);
    expect(row.endedAt!.getTime() - row.startedAt!.getTime()).toBe(4000);
  });

  it('falls back to GHL’s id when there is no Twilio SID, so the row still dedupes', () => {
    const row = ghlCallToRow({ ...real, altId: undefined }, OURS)!;
    expect(row.providerSid).toBe('K1PPiUZZ71IufDhL659A');
  });

  it('never guesses whether a human or the AI answered', () => {
    expect(ghlCallToRow(real, OURS)!.answeredBy).toBeNull();
  });

  it('ignores anything that is not a call', () => {
    expect(ghlCallToRow({ ...real, messageType: 'TYPE_SMS' })).toBeNull();
  });
});

describe('ghlMessageToRow', () => {
  it('reads a text', () => {
    const row = ghlMessageToRow({
      id: 'm1', direction: 'inbound', messageType: 'TYPE_SMS', status: 'delivered',
      from: '+19542749588', to: '+19809466044', body: 'sounds good', dateAdded: '2026-09-18T15:00:00.000Z',
    }, OURS)!;
    expect(row.channel).toBe('sms');
    expect(row.direction).toBe('inbound');
    expect(row.ourNumber).toBe('+19809466044');
    expect(row.body).toBe('sounds good');
  });

  it('calls a text with a picture on it an MMS', () => {
    const row = ghlMessageToRow({ id: 'm2', messageType: 'TYPE_SMS', from: '+19809466044', to: '+19542749588', attachments: ['https://x/y.jpg'] }, OURS)!;
    expect(row.channel).toBe('mms');
  });

  it('reads an email, address and subject intact', () => {
    const row = ghlMessageToRow({ id: 'm3', messageType: 'TYPE_EMAIL', from: 'office@bestroofingnow.com', to: 'someone@example.com', subject: 'Your inspection' }, OURS)!;
    expect(row.channel).toBe('email');
    expect(row.subject).toBe('Your inspection');
  });

  it('leaves calls to the call mapper', () => {
    expect(ghlMessageToRow({ id: 'm4', messageType: 'TYPE_CALL', from: '+1', to: '+2' })).toBeNull();
  });
});

describe('callOutcome', () => {
  it('does not let a four-second pickup count as a conversation', () => {
    expect(callOutcome({ status: 'completed', durationSeconds: 4, direction: 'outbound' })).toBe('no_conversation');
    expect(callOutcome({ status: 'completed', durationSeconds: 19, direction: 'outbound' })).toBe('no_conversation');
    expect(callOutcome({ status: 'completed', durationSeconds: 21, direction: 'outbound' })).toBe('connected');
  });
  it('reports the provider’s own verdicts plainly', () => {
    expect(callOutcome({ status: 'no-answer', durationSeconds: 0, direction: 'outbound' })).toBe('no_answer');
    expect(callOutcome({ status: 'busy', durationSeconds: 0, direction: 'outbound' })).toBe('busy');
    expect(callOutcome({ status: 'failed', durationSeconds: 0, direction: 'outbound' })).toBe('failed');
  });
  it('stays silent rather than inventing an outcome', () => {
    expect(callOutcome({ status: 'queued', durationSeconds: 0, direction: 'outbound' })).toBeNull();
    expect(callOutcome({ status: null, durationSeconds: null, direction: 'outbound' })).toBeNull();
  });
});

describe('connectStats', () => {
  it('measures a dialling day the way James described his', () => {
    // 50 dials, 10 real conversations averaging 6 minutes.
    const rows = [
      ...Array.from({ length: 10 }, () => ({ status: 'completed', durationSeconds: 360, direction: 'outbound' as const })),
      ...Array.from({ length: 35 }, () => ({ status: 'no-answer', durationSeconds: 0, direction: 'outbound' as const })),
      ...Array.from({ length: 5 }, () => ({ status: 'completed', durationSeconds: 6, direction: 'outbound' as const })),
    ];
    const s = connectStats(rows);
    expect(s.dials).toBe(50);
    expect(s.connected).toBe(10);          // the five 6-second pickups do not count
    expect(s.talkSeconds).toBe(3600);
    expect(s.connectRate).toBeCloseTo(0.2);
  });

  it('ignores inbound calls, which are not dials', () => {
    const s = connectStats([
      { status: 'completed', durationSeconds: 300, direction: 'inbound' },
      { status: 'completed', durationSeconds: 300, direction: 'outbound' },
    ]);
    expect(s.dials).toBe(1);
  });

  it('does not divide by zero on a day nobody dialled', () => {
    expect(connectStats([]).connectRate).toBe(0);
  });
});
