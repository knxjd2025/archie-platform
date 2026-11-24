import { describe, expect, it } from 'vitest';
import { emptyDraft } from '../draft';
import { draftForJob, startFromJob, type JobLead } from '../job-prefill';

const lead = (over: Partial<JobLead> = {}): JobLead => ({
  externalId: 'job-77', customer: 'Dana Whitfield', email: 'dana@example.com', phone: '319-555-0100',
  address: '12 Elm Street, Cedar Falls, IA', addressLine: '12 Elm Street', ...over,
});

describe('a job as the start of a report', () => {
  it('links the job and takes the street, city and state from its address and the customer from the job', () => {
    expect(startFromJob(lead())).toEqual({
      job: { externalId: 'job-77', label: 'Dana Whitfield, 12 Elm Street' },
      where: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '' },
      customer: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '319-555-0100' },
    });
  });

  it('turns a state written out into its two letters, and takes a ZIP written after it', () => {
    expect(startFromJob(lead({ address: '12 Elm Street, Cedar Falls, Iowa' }))!.where.state).toBe('IA');
    const z = startFromJob(lead({ address: '12 Elm Street, Cedar Falls, IA 50613' }))!.where;
    expect(z).toMatchObject({ state: 'IA', zip: '50613' });
  });

  it('fills only what it knows, and leaves the rest for the person to type', () => {
    expect(startFromJob(lead({ address: '12 Elm Street', addressLine: '12 Elm Street' }))!.where).toEqual({ address: '12 Elm Street', city: '', state: '', zip: '' });
    expect(startFromJob(lead({ address: null, addressLine: null }))!.where).toEqual({ address: '', city: '', state: '', zip: '' });
    expect(startFromJob(lead({ address: 'Somewhere odd, ??, ZZ', addressLine: '12 Elm Street' }))!.where.state).toBe('');
  });

  it('takes the street from the stored line when the display address is longer, and from the display address when there is no stored line', () => {
    expect(startFromJob(lead({ addressLine: null }))!.where.address).toBe('12 Elm Street');
  });

  it('has no start for a job without a key', () => {
    expect(startFromJob(lead({ externalId: null }))).toBeNull();
    expect(startFromJob(lead({ externalId: '' }))).toBeNull();
  });

  it('labels a job with no customer by its address, and a job with no address by its customer', () => {
    expect(startFromJob(lead({ customer: null }))!.job.label).toBe('12 Elm Street');
    expect(startFromJob(lead({ address: null, addressLine: null }))!.job.label).toBe('Dana Whitfield');
  });
});

describe('what happens to a draft that is already open', () => {
  const start = startFromJob(lead())!;

  it('starts a fresh draft with the job, the address and the customer filled in, on the first step', () => {
    const { draft, replaced } = draftForJob(null, start);
    expect(replaced).toBe(false);
    expect(draft).toMatchObject({ step: 1, where: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', job: { externalId: 'job-77' } }, review: { customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '319-555-0100' } });
  });

  it('takes an empty draft without a word', () => {
    expect(draftForJob(emptyDraft(), start).replaced).toBe(false);
  });

  it('keeps a draft that is already for this job', () => {
    const open = { ...emptyDraft(), step: 3, where: { ...emptyDraft().where, address: '12 Elm Street', job: { externalId: 'job-77', label: 'x' } } };
    const r = draftForJob(open, start);
    expect(r.draft).toBe(open);
    expect(r.replaced).toBe(false);
  });

  it('replaces a draft for anything else, and says so', () => {
    const other = { ...emptyDraft(), where: { ...emptyDraft().where, address: '9 Oak Road', job: { externalId: 'job-9', label: 'Pat' } } };
    const r = draftForJob(other, start);
    expect(r.replaced).toBe(true);
    expect(r.draft.where.address).toBe('12 Elm Street');
    const addressOnly = { ...emptyDraft(), where: { ...emptyDraft().where, address: '9 Oak Road' } };
    expect(draftForJob(addressOnly, start).replaced).toBe(true);
  });

  it('never carries a report try over to another report', () => {
    const other = { ...emptyDraft(), step: 6, attempt: { key: 'rr-key-12345', fingerprint: 'abc' }, where: { ...emptyDraft().where, address: '9 Oak Road' } };
    expect(draftForJob(other, start).draft.attempt).toBeNull();
  });
});
