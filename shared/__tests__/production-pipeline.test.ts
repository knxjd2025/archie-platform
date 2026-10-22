import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGE_KEYS, normalizeTrades, currentTrade, allTradesDone, completeCurrentTrade,
  entryBlocker, moveBlocker, jobtreadStatusFor, stageForJobtreadStatus, nextStage, prevStage,
  type PipelineState,
} from '../production-pipeline';

const ctx = (o: Partial<{ preconSubmitted: boolean; walkthroughSubmitted: boolean }> = {}) => ({ preconSubmitted: false, walkthroughSubmitted: false, ...o });
const state = (o: Partial<PipelineState> = {}): PipelineState => ({ stage: 'approved', trades: normalizeTrades(['roofing']), checks: {}, ...o });

describe('stages', () => {
  it('run in the order James laid out', () => {
    expect(PIPELINE_STAGE_KEYS).toEqual([
      'approved', 'waiting_dp', 'pre_production', 'schedule', 'material_check', 'install',
      'final_walkthrough', 'final_invoice', 'final_payment', 'warranty', 'closed_out',
    ]);
    expect(nextStage('approved')).toBe('waiting_dp');
    expect(prevStage('approved')).toBeNull();
    expect(nextStage('closed_out')).toBeNull();
  });
});

describe('trades', () => {
  it('keep site order, drop junk and duplicates, and default to roofing', () => {
    expect(normalizeTrades(['painting', 'roofing', 'gutters', 'gutters', 'nope']).map((t) => t.key)).toEqual(['roofing', 'gutters', 'painting']);
    expect(normalizeTrades([]).map((t) => t.key)).toEqual(['roofing']);
    expect(normalizeTrades(undefined).map((t) => t.key)).toEqual(['roofing']);
  });
  it('keep what was already done when the list changes', () => {
    const prior = [{ key: 'roofing' as const, done: true }, { key: 'siding' as const, done: false }];
    expect(normalizeTrades(['roofing', 'gutters', 'siding'], prior)).toEqual([
      { key: 'roofing', done: true }, { key: 'gutters', done: false }, { key: 'siding', done: false },
    ]);
  });
  it('advance one at a time, in order', () => {
    let t = normalizeTrades(['roofing', 'gutters']);
    expect(currentTrade(t)).toBe('roofing');
    t = completeCurrentTrade(t);
    expect(currentTrade(t)).toBe('gutters');
    expect(allTradesDone(t)).toBe(false);
    t = completeCurrentTrade(t);
    expect(allTradesDone(t)).toBe(true);
    expect(currentTrade(t)).toBeNull();
    expect(completeCurrentTrade(t)).toEqual(t);
  });
});

describe('gates', () => {
  it('scheduling needs the pre-construction checklist', () => {
    expect(entryBlocker('schedule', state({ stage: 'pre_production' }), ctx())).toMatch(/pre-construction checklist/);
    expect(entryBlocker('schedule', state({ stage: 'pre_production' }), ctx({ preconSubmitted: true }))).toBeNull();
  });
  it('the walkthrough needs every trade done, and the invoice needs the walkthrough', () => {
    const s = state({ stage: 'install', trades: normalizeTrades(['roofing', 'gutters']) });
    expect(entryBlocker('final_walkthrough', s, ctx())).toMatch(/Roofing is still open/);
    const done = { ...s, trades: completeCurrentTrade(completeCurrentTrade(s.trades)) };
    expect(entryBlocker('final_walkthrough', done, ctx())).toBeNull();
    expect(entryBlocker('final_invoice', done, ctx())).toMatch(/final walkthrough/);
    expect(entryBlocker('final_invoice', done, ctx({ walkthroughSubmitted: true }))).toBeNull();
  });
  it('payment, warranty and close-out need their boxes ticked', () => {
    const s = state({ stage: 'final_invoice' });
    expect(entryBlocker('final_payment', s, ctx())).toMatch(/Final invoice sent.*Review requested/);
    expect(entryBlocker('final_payment', { ...s, checks: { invoice_sent_with_photos: true, review_requested: true } }, ctx())).toBeNull();
    expect(entryBlocker('warranty', state({ stage: 'final_payment' }), ctx())).toMatch(/Final payment received/);
    expect(entryBlocker('closed_out', state({ stage: 'warranty' }), ctx())).toMatch(/Warranty registered/);
  });
  it('moving back is always allowed; moving forward checks every gate crossed', () => {
    expect(moveBlocker('approved', state({ stage: 'warranty' }), ctx())).toBeNull();
    // approved → material_check skips schedule, whose gate still applies
    expect(moveBlocker('material_check', state({ stage: 'approved' }), ctx())).toMatch(/pre-construction/);
    expect(moveBlocker('material_check', state({ stage: 'approved' }), ctx({ preconSubmitted: true }))).toBeNull();
    expect(moveBlocker('waiting_dp', state({ stage: 'approved' }), ctx())).toBeNull();
  });
});

describe('JobTread bridge', () => {
  it('writes the nearest JobTread status for each stage', () => {
    const roofOnly = normalizeTrades(['roofing']);
    expect(jobtreadStatusFor('approved', roofOnly)).toBe('Buyer Approved');
    expect(jobtreadStatusFor('waiting_dp', roofOnly)).toBe('Buyer Approved');
    expect(jobtreadStatusFor('pre_production', roofOnly)).toBe('Pre-Construction');
    expect(jobtreadStatusFor('schedule', roofOnly)).toBe('Schedule');
    expect(jobtreadStatusFor('material_check', roofOnly)).toBe('Schedule');
    expect(jobtreadStatusFor('install', roofOnly)).toBe('Roof Construction');
    expect(jobtreadStatusFor('install', completeCurrentTrade(normalizeTrades(['roofing', 'gutters'])))).toBe('Other Construction Work');
    expect(jobtreadStatusFor('install', normalizeTrades(['siding']))).toBe('Other Construction Work');
    expect(jobtreadStatusFor('final_walkthrough', roofOnly)).toBe('Complete');
    expect(jobtreadStatusFor('final_invoice', roofOnly)).toBe('Complete');
    expect(jobtreadStatusFor('final_payment', roofOnly)).toBe('Complete');
    expect(jobtreadStatusFor('warranty', roofOnly)).toBe('PIF File Warranties');
    expect(jobtreadStatusFor('closed_out', roofOnly)).toBe('Closed');
  });
  it('places a job with no pipeline row from its JobTread status', () => {
    expect(stageForJobtreadStatus('Buyer Approved')).toBe('approved');
    expect(stageForJobtreadStatus('Insurance Approved')).toBe('approved');
    expect(stageForJobtreadStatus('Permitting')).toBe('pre_production');
    expect(stageForJobtreadStatus('Roof Construction')).toBe('install');
    expect(stageForJobtreadStatus('Complete')).toBe('final_walkthrough');
    expect(stageForJobtreadStatus('Closed')).toBe('closed_out');
    expect(stageForJobtreadStatus('Estimating')).toBeNull();
    expect(stageForJobtreadStatus(null)).toBeNull();
  });
});
