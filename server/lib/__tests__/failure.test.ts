import { describe, it, expect } from 'vitest';
import { isInfrastructureError, safeMessage } from '../failure';

describe('safeMessage', () => {
  it('keeps copy someone deliberately wrote for a user', () => {
    for (const m of [
      'Pick your Good, Better and Best products and confirm the scope first.',
      'Unable to geocode address',
      'That host is not allowed.',
      'Lead has no phone number',
      'This Combined report was made before editing was supported — generate it again to edit it.',
    ]) {
      expect(safeMessage(new Error(m)), m).toBe(m);
    }
  });

  it('hides what a database driver produced', () => {
    // The shape node-postgres actually throws.
    const pgErr = Object.assign(new Error('relation "leads" does not exist'), {
      severity: 'ERROR', code: '42P01', routine: 'parserOpenTable',
    });
    expect(isInfrastructureError(pgErr)).toBe(true);
    expect(safeMessage(pgErr)).toBeNull();
  });

  it('hides what the operating system produced', () => {
    const sysErr = Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:5432'), {
      syscall: 'connect', errno: -61, code: 'ECONNREFUSED',
    });
    expect(safeMessage(sysErr)).toBeNull();
  });

  it('hides a message that says too much even when the shape looks ordinary', () => {
    expect(safeMessage(new Error('select * from leads where email = $1 failed'))).toBeNull();
    expect(safeMessage(new Error('could not connect to postgres://user:pw@db.internal:5432/app'))).toBeNull();
    expect(safeMessage(new Error('ENOENT: /Users/jamesturner/secrets/key.pem'))).toBeNull();
    expect(safeMessage(new Error('x'.repeat(400)))).toBeNull();
  });

  it('treats an empty or missing message as nothing to show', () => {
    expect(safeMessage(new Error(''))).toBeNull();
    expect(safeMessage(undefined)).toBeNull();
    expect(safeMessage(null)).toBeNull();
  });
});
