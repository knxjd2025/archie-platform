import { describe, it, expect } from 'vitest';
import { findMutation } from '../archie-agent';

// The raw JobTread tool lets an admin read anything, but must never write:
// this system holds customer contracts, pricing and vendor orders.
describe('jobtread_query write guard', () => {
  it('allows ordinary read queries', () => {
    expect(findMutation({ job: { $: { id: '22Pd' }, name: {}, documents: { nodes: { id: {} } } } })).toBeNull();
    expect(findMutation({ organization: { $: { id: 'org_test_1' }, jobs: { nodes: { name: {} } } } })).toBeNull();
    expect(findMutation({ schema: { $: { path: 'root' } } })).toBeNull();
  });

  it('catches writes at the top level', () => {
    expect(findMutation({ createDocument: { $: { jobId: 'x' } } })).toBe('createDocument');
    expect(findMutation({ deleteDailyLog: { $: { id: 'x' } } })).toBe('deleteDailyLog');
    expect(findMutation({ sendDocument: { $: { documentRecipientId: 'x' } } })).toBe('sendDocument');
    expect(findMutation({ updateJob: { $: { id: 'x' } } })).toBe('updateJob');
  });

  it('catches writes buried deep in a read query', () => {
    expect(findMutation({ job: { $: { id: 'x' }, nested: { deeper: { createComment: { $: { message: 'hi' } } } } } })).toBe('createComment');
    expect(findMutation({ a: [{ b: { updateDocument: {} } }] })).toBe('updateDocument');
  });

  it('does not mistake read fields that merely contain a verb', () => {
    // `createdAt` / `createdByUser` are read fields — the guard keys on
    // camelCase verb prefixes like createX, not any word containing "create".
    expect(findMutation({ job: { createdAt: {}, createdByUser: { name: {} } } })).toBeNull();
    expect(findMutation({ document: { updatedAt: {}, sentAt: {} } })).toBeNull();
  });

  it('handles junk input without throwing', () => {
    expect(findMutation(null)).toBeNull();
    expect(findMutation('string')).toBeNull();
    expect(findMutation(42)).toBeNull();
  });
});
