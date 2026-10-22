import { describe, it, expect } from 'vitest';
import {
  normalizePhone, normalizeEmail, normalizeAddress, keysOf, KeyIndex,
  classifyStatus, mapJobToLead, partitionJobs, externalIdFor,
} from '../rooflink-sync';
import type { RlJob } from '../../integrations/rooflink';

const job = (over: Partial<RlJob> = {}): RlJob => ({
  id: 101,
  number: 'RL-2024-0101',
  name: 'Roof replacement',
  job_type: 'r',
  bid_type: 'i',
  address: '550 Manning Dr',
  city: 'Charlotte',
  state: 'NC',
  zipcode: '28209',
  full_address: '550 Manning Dr, Charlotte, NC 28209',
  date_created: '2024-03-01T10:00:00Z',
  date_last_edited: '2024-03-05T10:00:00Z',
  customer: { id: 7, first_name: 'Jane', last_name: 'Doe', cell: '(704) 555-1234', email: 'Jane@Example.com' },
  rep: { id: 1, name: 'Sam Seller' },
  lead_status: { id: 3, name: 'Prospect', color: '#000' },
  lead_source: { id: 2, name: 'Door Knock' },
  ...over,
});

describe('normalisers', () => {
  it('phones compare on their last 10 digits', () => {
    expect(normalizePhone('(704) 555-1234')).toBe('7045551234');
    expect(normalizePhone('+1 704-555-1234')).toBe('7045551234');
    expect(normalizePhone('555-1234')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it('emails are case-insensitive and must look like emails', () => {
    expect(normalizeEmail(' Jane@Example.com ')).toBe('jane@example.com');
    expect(normalizeEmail('not an email')).toBeNull();
  });
  it('addresses match across suffix spelling, punctuation and trailing city/state', () => {
    expect(normalizeAddress('550 Manning Drive, Charlotte, NC 28209, USA')).toBe('550 manning dr');
    expect(normalizeAddress('550 MANNING DR.')).toBe('550 manning dr');
    expect(normalizeAddress('550 Manning Dr Apt 4')).toBe('550 manning dr');
    expect(normalizeAddress('Manning Dr')).toBeNull(); // no house number → too vague to match
    expect(normalizeAddress('')).toBeNull();
  });
  it('KeyIndex matches on any one of phone, email or address', () => {
    const idx = new KeyIndex();
    idx.add(keysOf({ phone: '7045551234', email: null, address: null }));
    expect(idx.has(keysOf({ phone: '(704) 555-1234' }))).toBe(true);
    expect(idx.has(keysOf({ email: 'x@y.com' }))).toBe(false);
    expect(idx.has(keysOf({}))).toBe(false); // nothing to match on never matches
  });
});

describe('classifyStatus', () => {
  it('reads the workflow steps before the status wording', () => {
    expect(classifyStatus(job({ rejected_step: { date: '2024-04-01' } }))).toEqual({ status: 'lost', stage: 'Prospect' });
    expect(classifyStatus(job({ closed_step: { date: '2024-04-01' } }))).toEqual({ status: 'won', stage: 'Closed' });
    expect(classifyStatus(job({ date_completed: '2024-04-01' }))).toEqual({ status: 'won', stage: 'Closed' });
    expect(classifyStatus(job({ approved_step: { date: '2024-04-01' }, lead_status: { id: 9, name: 'Production' } }))).toEqual({ status: 'won', stage: 'Production' });
  });
  it('falls back to the status name', () => {
    expect(classifyStatus(job()).status).toBe('new');
    expect(classifyStatus(job({ lead_status: { id: 1, name: 'Lost - Went with competitor' } })).status).toBe('lost');
    expect(classifyStatus(job({ lead_status: { id: 1, name: 'Inspected' } })).status).toBe('contacted');
    expect(classifyStatus(job({ lead_status: undefined })).status).toBe('new');
  });
});

describe('mapJobToLead', () => {
  it('maps a RoofLink job onto the leads shape', () => {
    const r = mapJobToLead(job());
    expect(r.externalId).toBe('rl-101');
    expect(r.source).toBe('rooflink');
    expect(r.firstName).toBe('Jane');
    expect(r.lastName).toBe('Doe');
    expect(r.phone).toBe('(704) 555-1234');
    expect(r.email).toBe('Jane@Example.com');
    expect(r.address).toBe('550 Manning Dr, Charlotte, NC 28209');
    expect(r.city).toBe('Charlotte');
    expect(r.zip).toBe('28209');
    expect(r.propertyType).toBe('residential');
    expect(r.insuranceClaim).toBe(true);
    expect(r.jtSalesRep).toBe('Sam Seller');
    expect(r.jobNumber).toBe('RL-2024-0101');
    expect(r.stage).toBe('Prospect');
    expect(r.notes).toBe('RoofLink #RL-2024-0101 · status: Prospect · source: Door Knock');
    expect(r.createdAt).toEqual(new Date('2024-03-01T10:00:00Z'));
  });
  it('falls back to the display or company name, and the home phone', () => {
    const r = mapJobToLead(job({ customer: { id: 7, name: 'ACME Property Mgmt', company_name: 'ACME Property Mgmt', phone: '704-555-9999' } }));
    expect(r.firstName).toBe('ACME Property Mgmt');
    expect(r.lastName).toBeNull();
    expect(r.phone).toBe('704-555-9999');
    expect(r.email).toBeNull();
  });
  it('carries claim and estimate details', () => {
    const r = mapJobToLead(job({
      insurance_claim: { claim_number: 'CLM-1', insurance_company: { id: 1, name: 'State Farm' } },
      primary_estimate: { total: '18250.50' },
      bid_type: 'c',
    }));
    expect(r.insuranceClaim).toBe(true);
    expect(r.projectedValue).toBe('18250.50');
    expect(r.notes).toContain('claim #CLM-1 · State Farm');
    expect(mapJobToLead(job({ bid_type: 'c' })).insuranceClaim).toBe(false);
  });
});

describe('partitionJobs', () => {
  it('drops deleted jobs, skips clients the app already has, and collapses RoofLink duplicates', () => {
    const existing = new KeyIndex();
    existing.add(keysOf({ phone: '+17045551234' })); // Jane is already a JobTread lead
    const jobs = [
      job(), // Jane → matches existing by phone
      job({ id: 102, customer: { id: 8, first_name: 'Bob', cell: '980-555-0000' }, full_address: '1 Oak St, Charlotte, NC', date_last_edited: '2024-01-01T00:00:00Z' }),
      job({ id: 103, customer: { id: 9, first_name: 'Robert', cell: '(980) 555-0000' }, full_address: '1 Oak Street', date_last_edited: '2024-06-01T00:00:00Z' }), // same person as 102, newer
      job({ id: 104, customer: { id: 10, first_name: 'Gone' }, full_address: '9 Elm St', deleted_step: { date: '2024-02-02' } }),
      job({ id: 105, customer: { id: 11, first_name: 'Nora' }, full_address: '22 Pine Ct, Matthews, NC 28105' }),
    ];
    const out = partitionJobs(jobs, existing);
    expect(out.deleted).toBe(1);
    expect(out.matchedExisting).toBe(1);
    expect(out.collapsed).toBe(1);
    expect(out.rows.map((r) => r.externalId).sort()).toEqual([externalIdFor(103), externalIdFor(105)]);
    expect(out.rows.find((r) => r.externalId === 'rl-103')?.firstName).toBe('Robert'); // the newer edit wins
  });
  it('keeps jobs with nothing to match on', () => {
    const out = partitionJobs([job({ id: 1, customer: { id: 1, first_name: 'A' }, full_address: null, address: null }), job({ id: 2, customer: { id: 2, first_name: 'B' }, full_address: null, address: null })], new KeyIndex());
    expect(out.rows).toHaveLength(2);
  });
});
