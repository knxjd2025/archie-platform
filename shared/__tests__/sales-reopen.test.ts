import { describe, it, expect } from 'vitest';
import { salesMoveBlocker, type SalesGateContext } from '../sales-pipeline';

const noReport: SalesGateContext = { reportGenerated: false, productionStage: null };
const lostAt = (stage: string) => ({ stage: 'lost', checks: {}, history: [{ stage: 'inspection' }, { stage }, { stage: 'lost' }] });

describe('reopening a lost deal', () => {
  it('goes back to the step it died on without a gate', () => {
    expect(salesMoveBlocker('follow_up', lostAt('follow_up'), noReport)).toBeNull();
  });

  it('walks every gate from the start to reach anywhere else', () => {
    // Lost at Inspection with no report: Sit Down Close needs one.
    expect(salesMoveBlocker('sit_down_close', lostAt('inspection'), noReport)).toMatch(/Generate the report/);
    // Reviews & Referrals needs production through Final Invoice as well.
    expect(salesMoveBlocker('reviews_referrals', lostAt('inspection'), { reportGenerated: true, productionStage: 'install' })).toMatch(/Final Invoice/);
    expect(salesMoveBlocker('reviews_referrals', lostAt('inspection'), { reportGenerated: true, productionStage: 'final_invoice' })).toBeNull();
  });

  it('a step with no gate is still reachable from Lost', () => {
    expect(salesMoveBlocker('report', lostAt('inspection'), noReport)).toBeNull();
  });

  it('with no history the reopen step is Follow Up, as the board shows', () => {
    expect(salesMoveBlocker('follow_up', { stage: 'lost', checks: {} }, noReport)).toBeNull();
  });

  it('marking a deal lost is still allowed from anywhere', () => {
    expect(salesMoveBlocker('lost', { stage: 'report', checks: {} }, noReport)).toBeNull();
  });
});
