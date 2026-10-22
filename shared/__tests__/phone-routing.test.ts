import { describe, it, expect } from 'vitest';
import { routeInbound, routingGaps, isNumberPurpose, isRingTo, type OwnedNumber, type Person } from '../phone-routing';

const OFFICE = '+19809902042';
const CS = '+19802527879';

const people: Person[] = [
  { id: 2, name: 'Office Admin', phone: '+17045550001', active: true },
  { id: 6, name: 'Customer Service', phone: '+17045550002', active: true },
  { id: 9, name: 'No Phone Nigel', phone: null, active: true },
  { id: 10, name: 'Gone Gary', phone: '+17045550009', active: false },
];

const nums = (over: Partial<OwnedNumber>[] = []): OwnedNumber[] => ([
  { e164: OFFICE, purpose: 'direct', teamMemberId: 2, forwardsTo: null, active: true },
  { e164: CS, purpose: 'direct', teamMemberId: 6, forwardsTo: null, active: true },
  ...over as OwnedNumber[],
]);

describe('routeInbound', () => {
  it('rings the person the number belongs to', () => {
    const d = routeInbound(OFFICE, nums(), people);
    expect(d.ring).toEqual(['+17045550001']);
    expect(d.forTeamMemberId).toBe(2);
    expect(d.voicemail).toBe(false);
  });

  it('keeps each number on its own person', () => {
    expect(routeInbound(CS, nums(), people).ring).toEqual(['+17045550002']);
    expect(routeInbound(CS, nums(), people).forTeamMemberId).toBe(6);
  });

  it('an explicit forward on the number beats the owner', () => {
    const list = nums();
    list[0].forwardsTo = '+17045559999';
    const d = routeInbound(OFFICE, list, people);
    expect(d.ring).toEqual(['+17045559999']);
    expect(d.reason).toMatch(/own forwarding/);
  });

  it('says plainly when the owner has no phone on file', () => {
    const list = nums();
    list[0].teamMemberId = 9;
    const d = routeInbound(OFFICE, list, people, null);
    expect(d.ring).toEqual([]);
    expect(d.voicemail).toBe(true);
    expect(d.reason).toMatch(/No Phone Nigel has no phone number on file/);
  });

  it('does not ring someone who has left', () => {
    const list = nums();
    list[0].teamMemberId = 10;
    const d = routeInbound(OFFICE, list, people, null);
    expect(d.ring).toEqual([]);
    expect(d.reason).toMatch(/no longer active/);
  });

  it('falls back rather than dropping the call, when a fallback exists', () => {
    const list = nums();
    list[0].teamMemberId = 9;
    const d = routeInbound(OFFICE, list, people, '+17045550000');
    expect(d.ring).toEqual(['+17045550000']);
    expect(d.voicemail).toBe(false);
  });

  it('takes a message for a number that is switched off', () => {
    const list = nums();
    list[0].active = false;
    const d = routeInbound(OFFICE, list, people, '+17045550000');
    expect(d.ring).toEqual([]);
    expect(d.voicemail).toBe(true);
    expect(d.reason).toMatch(/switched off/);
  });

  it('sends a call back to an outbound-only number somewhere real', () => {
    const list = nums([{ e164: '+19998887777', purpose: 'outbound', teamMemberId: null, forwardsTo: null, active: true }]);
    const d = routeInbound('+19998887777', list, people, '+17045550000');
    expect(d.ring).toEqual(['+17045550000']);
    expect(d.reason).toMatch(/outbound-only/);
  });

  it('handles a number we do not own at all', () => {
    const d = routeInbound('+12125550000', nums(), people, null);
    expect(d.voicemail).toBe(true);
    expect(d.reason).toMatch(/not one of our numbers/);
  });

  it('an unassigned number says so', () => {
    const list = nums();
    list[0].teamMemberId = null;
    expect(routeInbound(OFFICE, list, people, null).reason).toMatch(/nobody is assigned/);
  });
});

describe('routingGaps', () => {
  it('is empty when every number reaches somebody', () => {
    expect(routingGaps(nums(), people)).toEqual([]);
  });

  it('names every number that would go to voicemail, and why', () => {
    const list = nums();
    list[0].teamMemberId = 9;   // no phone
    list[1].teamMemberId = null; // unassigned
    const gaps = routingGaps(list, people, null);
    expect(gaps).toHaveLength(2);
    expect(gaps.find((g) => g.e164 === OFFICE)!.reason).toMatch(/no phone number on file/);
    expect(gaps.find((g) => g.e164 === CS)!.reason).toMatch(/nobody is assigned/);
  });

  it('ignores outbound-only numbers — they are not meant to ring', () => {
    const list = nums([{ e164: '+19998887777', purpose: 'outbound', teamMemberId: null, forwardsTo: null, active: true }]);
    expect(routingGaps(list, people).map((g) => g.e164)).not.toContain('+19998887777');
  });

  it('today: two numbers, nobody has a phone on file', () => {
    const nobody: Person[] = [
      { id: 2, name: 'Office Admin', phone: null, active: true },
      { id: 6, name: 'Customer Service', phone: null, active: true },
    ];
    const gaps = routingGaps(nums(), nobody, null);
    expect(gaps).toHaveLength(2);
    for (const g of gaps) expect(g.reason).toMatch(/no phone number on file/);
  });
});

describe('isNumberPurpose', () => {
  it('accepts only the four we handle', () => {
    for (const v of ['direct', 'main', 'ai_answer', 'outbound']) expect(isNumberPurpose(v)).toBe(true);
    for (const v of ['Direct', 'sms', '', null, 7]) expect(isNumberPurpose(v)).toBe(false);
  });
});

describe('answering in the browser', () => {
  const OFFICE = '+19809902042';
  const people: Person[] = [
    { id: 2, name: 'Office Admin', phone: '+17045550001', active: true },
    { id: 6, name: 'Deskbound Dee', phone: null, active: true },
  ];
  const num = (over: Partial<OwnedNumber> = {}): OwnedNumber[] => ([{
    e164: OFFICE, purpose: 'main', teamMemberId: 2, forwardsTo: null, active: true,
    ringTo: 'browser', clientIdentity: 'office', ...over,
  }]);

  it('rings the browser, and no phone at all', () => {
    const d = routeInbound(OFFICE, num(), people);
    expect(d.ringClients).toEqual(['office']);
    expect(d.ring).toEqual([]);
    expect(d.voicemail).toBe(false);
  });

  it('a browser-only number does not need a phone on file', () => {
    // This is the whole point of the office case: Dee has no mobile and does
    // not need one.
    const d = routeInbound(OFFICE, num({ teamMemberId: 6 }), people);
    expect(d.ringClients).toEqual(['office']);
    expect(d.voicemail).toBe(false);
  });

  it('"both" rings the browser and the phone together', () => {
    const d = routeInbound(OFFICE, num({ ringTo: 'both' }), people);
    expect(d.ringClients).toEqual(['office']);
    expect(d.ring).toEqual(['+17045550001']);
    expect(d.reason).toMatch(/browser and/);
  });

  it('"both" still works when only one half is available', () => {
    const d = routeInbound(OFFICE, num({ ringTo: 'both', teamMemberId: 6 }), people);
    expect(d.ringClients).toEqual(['office']);
    expect(d.ring).toEqual([]);
    expect(d.voicemail).toBe(false);
  });

  it('says so when a number is set to ring a browser that was never named', () => {
    const d = routeInbound(OFFICE, num({ clientIdentity: null }), people, null);
    expect(d.voicemail).toBe(true);
    expect(d.reason).toMatch(/no browser identity/);
  });

  it('an unset ring mode behaves exactly as before — a phone', () => {
    const d = routeInbound(OFFICE, num({ ringTo: null, clientIdentity: null }), people);
    expect(d.ring).toEqual(['+17045550001']);
    expect(d.ringClients).toEqual([]);
  });

  it('an explicit forward still beats the browser', () => {
    const d = routeInbound(OFFICE, num({ forwardsTo: '+17045559999' }), people);
    expect(d.ring).toEqual(['+17045559999']);
    expect(d.ringClients).toEqual([]);
  });

  it("today's setup: both numbers answer in the browser with nobody holding a phone", () => {
    const live: OwnedNumber[] = [
      { e164: '+19809902042', purpose: 'main', teamMemberId: 2, forwardsTo: null, active: true, ringTo: 'browser', clientIdentity: 'office' },
      { e164: '+19802527879', purpose: 'direct', teamMemberId: 6, forwardsTo: null, active: true, ringTo: 'browser', clientIdentity: 'cs' },
    ];
    const noPhones: Person[] = [
      { id: 2, name: 'Office Admin', phone: null, active: true },
      { id: 6, name: 'Customer Service', phone: null, active: true },
    ];
    expect(routingGaps(live, noPhones, null)).toEqual([]);
    expect(routeInbound('+19809902042', live, noPhones).ringClients).toEqual(['office']);
    expect(routeInbound('+19802527879', live, noPhones).ringClients).toEqual(['cs']);
  });
});

describe('isRingTo', () => {
  it('accepts only the three modes', () => {
    for (const v of ['browser', 'phone', 'both']) expect(isRingTo(v)).toBe(true);
    for (const v of ['Browser', 'sms', '', null, 3]) expect(isRingTo(v)).toBe(false);
  });
});
