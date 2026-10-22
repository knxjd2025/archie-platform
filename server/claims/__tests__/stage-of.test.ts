import { describe, it, expect } from 'vitest';
import { claimStageOf, type ClaimRow } from '../store';

const row = (stage: string) => ({ stage } as unknown as ClaimRow);

describe('claimStageOf', () => {
  it('maps legacy keys and passes current ones through', () => {
    expect(claimStageOf(row('intake'))).toBe('file_claim');
    expect(claimStageOf(row('denied_dispute'))).toBe('disputing');
    expect(claimStageOf(row('supplement'))).toBe('supplement');
  });

  it('never hands back a prototype member as a stage', () => {
    // LEGACY_CLAIM_STAGE['constructor'] is Object's constructor function.
    for (const k of ['constructor', '__proto__', 'toString']) expect(claimStageOf(row(k))).toBe('file_claim');
  });
});
