import { describe, it, expect } from 'vitest';
import {
  xmlEscape, bridgeTwiml, inboundTwiml, statusToUpdate, isFinalStatus, recordingMediaUrl,
  handoffTwiml, nobodyAnswered, RINGS_TO_SECONDS, browserDialTwiml,
} from '../twilio-voice';

const OURS = '+19809902042';

describe('xmlEscape', () => {
  it('escapes what breaks TwiML', () => {
    expect(xmlEscape('Jones & Sons')).toBe('Jones &amp; Sons');
    expect(xmlEscape('<script>')).toBe('&lt;script&gt;');
    expect(xmlEscape(`O'Brien "Bob"`)).toBe('O&apos;Brien &quot;Bob&quot;');
  });
  it('survives nothing', () => {
    expect(xmlEscape(undefined as any)).toBe('');
    expect(xmlEscape(null as any)).toBe('');
  });
});

describe('bridgeTwiml', () => {
  const base = { repNumber: '+17045551111', customerNumber: '+19545550000', callerId: OURS };

  it('dials the customer with our number as the caller id', () => {
    const x = bridgeTwiml(base);
    expect(x).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(x).toContain(`callerId="${OURS}"`);
    expect(x).toContain('<Number>+19545550000</Number>');
    expect(x).toContain('</Response>');
  });

  it('records both sides', () => {
    expect(bridgeTwiml(base)).toContain('record="record-from-answer-dual"');
  });

  it('says the call is recorded when asked — both parties, not just ours', () => {
    expect(bridgeTwiml({ ...base, announceRecording: true })).toContain('This call is recorded');
    expect(bridgeTwiml(base)).not.toContain('This call is recorded');
  });

  it('whispers to the rep before the customer is dialled', () => {
    const x = bridgeTwiml({ ...base, whisper: 'Calling Dana Whitfield' });
    expect(x.indexOf('Calling Dana Whitfield')).toBeLessThan(x.indexOf('<Dial'));
  });

  it('escapes a name that would otherwise produce invalid XML', () => {
    const x = bridgeTwiml({ ...base, whisper: 'Calling Jones & Sons' });
    expect(x).toContain('Jones &amp; Sons');
    expect(x).not.toMatch(/Jones & Sons/);
  });

  it('never sets a time limit under a minute, however it is asked', () => {
    expect(bridgeTwiml({ ...base, timeLimitSeconds: 5 })).toContain('timeLimit="60"');
    expect(bridgeTwiml({ ...base, timeLimitSeconds: 1800 })).toContain('timeLimit="1800"');
    expect(bridgeTwiml(base)).not.toContain('timeLimit');
  });
});

describe('inboundTwiml', () => {
  it('rings everyone on the list', () => {
    const x = inboundTwiml({ forwardTo: ['+17045551111', '+17045552222'] });
    expect(x).toContain('<Number>+17045551111</Number>');
    expect(x).toContain('<Number>+17045552222</Number>');
  });

  it('takes a message rather than ringing out when nobody is listed', () => {
    const x = inboundTwiml({ forwardTo: [] });
    expect(x).toContain('<Record');
    expect(x).toContain('leave a message');
    expect(x).not.toContain('<Dial');
  });

  it('ignores blanks in the forward list', () => {
    const x = inboundTwiml({ forwardTo: ['', '+17045551111', ''] });
    expect((x.match(/<Number>/g) || []).length).toBe(1);
  });

  it('keeps the ring time somewhere a caller will actually wait', () => {
    expect(inboundTwiml({ forwardTo: ['+1'], ringSeconds: 1 })).toContain('timeout="5"');
    expect(inboundTwiml({ forwardTo: ['+1'], ringSeconds: 600 })).toContain('timeout="60"');
    expect(inboundTwiml({ forwardTo: ['+1'] })).toContain('timeout="20"');
  });
});

describe('statusToUpdate', () => {
  it('reads a completed call', () => {
    const u = statusToUpdate({
      CallSid: 'CA123', CallStatus: 'completed', CallDuration: '372', AnsweredBy: 'human',
    })!;
    expect(u.providerSid).toBe('CA123');
    expect(u.durationSeconds).toBe(372);
    expect(u.answeredBy).toBe('human');
    expect(u.endedAt).toBeInstanceOf(Date);
  });

  it('treats every flavour of machine detection as a machine', () => {
    for (const v of ['machine_start', 'machine_end_beep', 'machine_end_silence', 'MACHINE_START']) {
      expect(statusToUpdate({ CallSid: 'CA1', AnsweredBy: v })!.answeredBy).toBe('machine');
    }
    expect(statusToUpdate({ CallSid: 'CA1', AnsweredBy: 'unknown' })!.answeredBy).toBeNull();
  });

  it('leaves endedAt alone while the call is still going', () => {
    expect(statusToUpdate({ CallSid: 'CA1', CallStatus: 'ringing' })!.endedAt).toBeNull();
    expect(statusToUpdate({ CallSid: 'CA1', CallStatus: 'in-progress' })!.endedAt).toBeNull();
    expect(statusToUpdate({ CallSid: 'CA1', CallStatus: 'no-answer' })!.endedAt).toBeInstanceOf(Date);
  });

  it('refuses a callback with nothing to attach it to', () => {
    expect(statusToUpdate({ CallStatus: 'completed' })).toBeNull();
    expect(statusToUpdate({})).toBeNull();
  });

  it('does not invent a duration out of rubbish', () => {
    expect(statusToUpdate({ CallSid: 'CA1', CallDuration: '' })!.durationSeconds).toBeNull();
    expect(statusToUpdate({ CallSid: 'CA1', CallDuration: 'abc' })!.durationSeconds).toBeNull();
    expect(statusToUpdate({ CallSid: 'CA1', CallDuration: '-5' })!.durationSeconds).toBeNull();
    expect(statusToUpdate({ CallSid: 'CA1', CallDuration: '0' })!.durationSeconds).toBe(0);
  });
});

describe('isFinalStatus', () => {
  it('knows which statuses mean the call is over', () => {
    for (const s of ['completed', 'busy', 'no-answer', 'canceled', 'failed']) expect(isFinalStatus(s)).toBe(true);
    for (const s of ['queued', 'ringing', 'in-progress', 'initiated']) expect(isFinalStatus(s)).toBe(false);
  });
});

describe('recordingMediaUrl', () => {
  it('adds the extension Twilio leaves off', () => {
    expect(recordingMediaUrl('https://api.twilio.com/RE123')).toBe('https://api.twilio.com/RE123.mp3');
    expect(recordingMediaUrl('https://api.twilio.com/RE123', 'wav')).toBe('https://api.twilio.com/RE123.wav');
  });
  it('does not double it up', () => {
    expect(recordingMediaUrl('https://api.twilio.com/RE123.mp3')).toBe('https://api.twilio.com/RE123.mp3');
  });
});

describe('handing an unanswered call to the AI', () => {
  const AI = '+17043683951';   // the GoHighLevel line Dakota answers on

  it('three rings is about eighteen seconds', () => {
    expect(RINGS_TO_SECONDS(3)).toBe(18);
    expect(RINGS_TO_SECONDS(1)).toBe(6);
  });

  it('never rings so briefly or so long that a caller notices', () => {
    expect(RINGS_TO_SECONDS(0)).toBe(5);
    expect(RINGS_TO_SECONDS(100)).toBe(60);
  });

  it('lets an action decide, rather than falling through to voicemail', () => {
    const x = inboundTwiml({ forwardTo: ['+17045551111'], noAnswerAction: '/api/voice/no-answer', ringSeconds: 18 });
    expect(x).toContain('action="/api/voice/no-answer"');
    expect(x).toContain('timeout="18"');
    // The whole point: an answered call that ends must not then reach the AI.
    expect(x).not.toContain('<Record');
  });

  it('still takes a message when there is no handoff configured', () => {
    const x = inboundTwiml({ forwardTo: ['+17045551111'] });
    expect(x).toContain('<Record');
    expect(x).not.toContain('action=');
  });

  it('with nobody to ring, hands over immediately instead of ringing at nothing', () => {
    const x = inboundTwiml({ forwardTo: [], noAnswerAction: '/api/voice/no-answer' });
    expect(x).toContain('<Redirect');
    expect(x).not.toContain('<Dial');
    expect(x).not.toContain('<Record');
  });

  it('hands the caller over with our number as the caller id', () => {
    const x = handoffTwiml(AI, '+19809902042');
    expect(x).toContain(`<Number>${AI}</Number>`);
    expect(x).toContain('callerId="+19809902042"');
  });

  it('knows which dial outcomes mean nobody picked up', () => {
    for (const s of ['no-answer', 'busy', 'failed', 'canceled', 'NO-ANSWER']) expect(nobodyAnswered(s)).toBe(true);
    // Someone answered and the call ended normally — that must NOT go to the AI.
    for (const s of ['completed', 'answered', undefined, '']) expect(nobodyAnswered(s)).toBe(false);
  });
});

describe('browserDialTwiml', () => {
  const base = { to: '+19545550000', callerId: '+19809902042' };

  it('dials the customer showing the business number', () => {
    const x = browserDialTwiml(base);
    expect(x).toContain('callerId="+19809902042"');
    expect(x).toContain('<Number>+19545550000</Number>');
  });

  it('records both sides', () => {
    expect(browserDialTwiml(base)).toContain('record="record-from-answer-dual"');
  });

  it('waits for the customer to answer before the browser hears anything', () => {
    // Without answerOnBridge the caller hears silence rather than ringing,
    // and reliably hangs up thinking the call failed.
    expect(browserDialTwiml(base)).toContain('answerOnBridge="true"');
  });

  it('announces recording on the leg that needs to hear it', () => {
    const x = browserDialTwiml({ ...base, announceRecording: true });
    expect(x.indexOf('This call is recorded')).toBeLessThan(x.indexOf('<Dial'));
  });

  it('escapes a caller id that would break the XML', () => {
    expect(browserDialTwiml({ ...base, to: '+1954555<script>' })).toContain('&lt;script&gt;');
  });
});
