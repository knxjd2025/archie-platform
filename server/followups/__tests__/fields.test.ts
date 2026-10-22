import { describe, it, expect, vi } from 'vitest';
vi.mock('../../db', () => ({ db: {} }));
import { checkFollowUpFields } from '../routes';

describe('follow-up due date and assignee', () => {
  it('accepts a real date and a team member id, or neither', () => {
    expect(checkFollowUpFields({ dueDate: '2026-10-20', assignedTo: 4 })).toEqual({ ok: true, dueDate: '2026-10-20', assignedTo: 4 });
    expect(checkFollowUpFields({ dueDate: '2026-10-20', assignedTo: '4' })).toEqual({ ok: true, dueDate: '2026-10-20', assignedTo: 4 });
    expect(checkFollowUpFields({})).toEqual({ ok: true, dueDate: null, assignedTo: null });
    expect(checkFollowUpFields({ dueDate: '', assignedTo: '' })).toEqual({ ok: true, dueDate: null, assignedTo: null });
  });

  it('refuses a due date that is not a real YYYY-MM-DD', () => {
    // A typed "next week" used to be stored, and the scorecard's ::date cast
    // on it threw for everyone.
    for (const dueDate of ['next week', '2026-02-30', '10/20/2026', '2026-10-20T09:00', 20261020]) {
      expect(checkFollowUpFields({ dueDate }).ok, String(dueDate)).toBe(false);
    }
  });

  it('refuses an assignee that is not a whole positive id', () => {
    for (const assignedTo of ['abc', 1.5, -3, 0, true, '4x', [4]]) {
      expect(checkFollowUpFields({ assignedTo }).ok, String(assignedTo)).toBe(false);
    }
  });
});
