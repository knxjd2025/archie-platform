import { describe, it, expect } from 'vitest';
import { mapJobToLead, parseAddress, extractContact, jobField, leadReplaceScope } from '../leads-sync';

const withJobFields = (fields: Array<[string, string | boolean]>) => ({
  id: 'j',
  customFieldValues: { nodes: fields.map(([name, value]) => ({ value, customField: { name } })) },
});

const withContact = (fields: Array<[string, string]>) => ({
  id: 'x',
  location: { account: { primaryContact: { customFieldValues: { nodes: fields.map(([name, value]) => ({ value, customField: { name } })) } } } },
});

describe('extractContact', () => {
  it('pulls Email and prefers Mobile over Phone', () => {
    expect(extractContact(withContact([['Email', 'a@b.com'], ['Mobile', '+17049759085'], ['Phone', '+17040000000'], ['Address', '1 Main St']]))).toEqual({
      email: 'a@b.com',
      phone: '+17049759085',
    });
  });
  it('falls back to Phone when there is no Mobile', () => {
    expect(extractContact(withContact([['Phone', '+19806213906'], ['Email', 'c@d.com']]))).toEqual({ email: 'c@d.com', phone: '+19806213906' });
  });
  it('ignores literal "null" values and missing contacts', () => {
    expect(extractContact(withContact([['Email', 'null'], ['Phone', '']]))).toEqual({ email: null, phone: null });
    expect(extractContact({ id: 'y', location: { account: { primaryContact: null } } })).toEqual({ email: null, phone: null });
  });
});

describe('parseAddress', () => {
  it('pulls city/state/zip from a standard US address', () => {
    expect(parseAddress('550 Manning Dr, Charlotte, NC 28209, USA')).toEqual({
      address: '550 Manning Dr, Charlotte, NC 28209, USA',
      city: 'Charlotte',
      state: 'NC',
      zip: '28209',
    });
  });
  it('degrades gracefully on a non-standard address', () => {
    const out = parseAddress('2133 Charlotte Drive, Dilworth, Charlotte, North Carolina');
    expect(out.address).toBe('2133 Charlotte Drive, Dilworth, Charlotte, North Carolina');
    expect(out.state).toBe(null);
  });
  it('handles empty input', () => {
    expect(parseAddress(undefined)).toEqual({ address: null, city: null, state: null, zip: null });
  });
});

describe('mapJobToLead', () => {
  it('maps a JobTread job to a lead with mapped status and account name', () => {
    const lead = mapJobToLead({
      id: '22PdkNvMjFRE',
      name: 'L McMillan 0520',
      status: 'created',
      createdAt: '2026-09-01T21:13:52.068Z',
      projectedPriceWithTax: 1734.95,
      location: { address: '550 Manning Dr, Charlotte, NC 28209, USA', account: { name: 'Linda McMillan' } },
    });
    expect(lead).toMatchObject({
      externalId: '22PdkNvMjFRE',
      source: 'jobtread',
      firstName: 'Linda McMillan',
      city: 'Charlotte',
      state: 'NC',
      status: 'new',
    });
    expect(lead.notes).toContain('L McMillan 0520');
    expect(lead.createdAt).toBeInstanceOf(Date);
  });
  it('maps approved/paid jobs to won and unknown status to new', () => {
    expect(mapJobToLead({ id: 'a', status: 'approved' }).status).toBe('won');
    expect(mapJobToLead({ id: 'b', status: 'paid' }).status).toBe('won');
    expect(mapJobToLead({ id: 'c', status: 'weird' }).status).toBe('new');
  });
  it('mirrors job-level custom fields (stage/sales rep/PM/insurance) + schedule', () => {
    const lead = mapJobToLead({
      id: 'j1',
      name: 'F White 0293',
      number: '0293',
      status: 'approved',
      projectedPriceWithTax: 18400,
      taskSummary: { startDate: '2026-09-11', endDate: '2026-09-12' },
      customFieldValues: { nodes: [
        { value: 'Roof Construction', customField: { name: 'Status' } },
        { value: 'Thomas Bramhill', customField: { name: 'Sales Rep' } },
        { value: 'Juan Loreto', customField: { name: 'Project Manager' } },
        { value: true, customField: { name: 'Insurance Claim' } },
      ] },
    });
    expect(lead).toMatchObject({
      jobName: 'F White 0293',
      jobNumber: '0293',
      stage: 'Roof Construction',
      jtSalesRep: 'Thomas Bramhill',
      projectManager: 'Juan Loreto',
      projectedValue: '18400',
      insuranceClaim: true,
    });
    expect(lead.scheduleStart).toBeInstanceOf(Date);
    expect(lead.scheduleEnd).toBeInstanceOf(Date);
  });
  it('leaves rep/stage null when the job has no such custom field', () => {
    const lead = mapJobToLead({ id: 'j2', name: 'New One', status: 'created' });
    expect(lead.jtSalesRep).toBeNull();
    expect(lead.stage).toBeNull();
    expect(lead.insuranceClaim).toBe(false);
  });
});

describe('jobField', () => {
  it('reads a named field case-insensitively and trims', () => {
    expect(jobField(withJobFields([['Sales Rep', '  Banning Rumsey  ']]), 'sales rep')).toBe('Banning Rumsey');
  });
  it('coerces booleans and returns null for absent/blank/"null"', () => {
    expect(jobField(withJobFields([['Insurance Claim', true]]), 'Insurance Claim')).toBe('true');
    expect(jobField(withJobFields([['Status', 'null']]), 'Status')).toBeNull();
    expect(jobField(withJobFields([['Status', '']]), 'Status')).toBeNull();
    expect(jobField(withJobFields([['Status', 'New Lead']]), 'Sales Rep')).toBeNull();
  });
});

describe('leadReplaceScope (a capped fetch must never delete the jobs it did not reach)', () => {
  it('a complete fetch replaces every JobTread lead', () => {
    expect(leadReplaceScope(['j1', 'j2'], false)).toEqual({ all: true });
  });
  it('a capped fetch replaces only the jobs it fetched', () => {
    expect(leadReplaceScope(['j1', 'j2'], true)).toEqual({ all: false, ids: ['j1', 'j2'] });
  });
});
