import { describe, it, expect } from 'vitest';
import {
  tuneUpRatePerSquare, tuneUpLineItem, cleaningRatePerSquare, cleaningLineItem, permaBootTotal, permaBootLineItems, waterDiverterLineItem, WATER_DIVERTER_RATE,
  TUNE_UP_RATES, TUNE_UP_STEEP_SURCHARGE_PER_SQUARE, CLEANING_RATES, CLEANING_STEEP_SURCHARGE_PER_SQUARE,
} from '../addon-pricing';

describe('tune-up rates', () => {
  it('matches the documented per-square rates', () => {
    expect(TUNE_UP_RATES).toEqual({ basic: 24.99, advanced: 54.99 });
  });

  it('adds the steep surcharge on either tier', () => {
    expect(tuneUpRatePerSquare('basic', false)).toBe(24.99);
    expect(tuneUpRatePerSquare('basic', true)).toBe(44.99);
    expect(tuneUpRatePerSquare('advanced', false)).toBe(54.99);
    expect(tuneUpRatePerSquare('advanced', true)).toBe(74.99);
    expect(TUNE_UP_STEEP_SURCHARGE_PER_SQUARE).toBe(20);
  });

  it('builds one priced line item off the roof size', () => {
    const line = tuneUpLineItem('advanced', 32, true);
    expect(line).toEqual({ name: 'Advanced Roof Tune-Up (steep)', quantity: 32, unit: 'sq', unitPrice: 74.99 });
  });
});

describe('cleaning rates', () => {
  it('matches the documented per-square rates', () => {
    expect(CLEANING_RATES).toEqual({ basic: 24.99, advanced: 71.99 });
  });

  it('adds the steep surcharge on either tier', () => {
    expect(cleaningRatePerSquare('basic', false)).toBe(24.99);
    expect(cleaningRatePerSquare('basic', true)).toBe(44.99);
    expect(cleaningRatePerSquare('advanced', false)).toBe(71.99);
    expect(cleaningRatePerSquare('advanced', true)).toBe(91.99);
    expect(CLEANING_STEEP_SURCHARGE_PER_SQUARE).toBe(20);
  });

  it('builds one priced line item off the roof size', () => {
    const line = cleaningLineItem('advanced', 32, true);
    expect(line).toEqual({ name: 'Advanced Roof Cleaning (steep)', quantity: 32, unit: 'sq', unitPrice: 91.99 });
  });
});

describe('permaBootTotal', () => {
  it('is always $450 for the first boot and $200 for each after', () => {
    expect(permaBootTotal(1)).toBe(450);
    expect(permaBootTotal(2)).toBe(650);
    expect(permaBootTotal(12)).toBe(2650);
  });
  it('is $0 for zero or negative counts', () => {
    expect(permaBootTotal(0)).toBe(0);
    expect(permaBootTotal(-1)).toBe(0);
  });
});

describe('permaBootLineItems', () => {
  it('is one $450 line for a single boot', () => {
    expect(permaBootLineItems(1)).toEqual([
      { name: 'Perma-Boot', quantity: 1, unit: 'ea', unitPrice: 450 },
    ]);
  });
  it('splits into a $450 first-boot line and a $200 additional-boots line', () => {
    expect(permaBootLineItems(12)).toEqual([
      { name: 'Perma-Boot (first boot)', quantity: 1, unit: 'ea', unitPrice: 450 },
      { name: 'Perma-Boot (additional)', quantity: 11, unit: 'ea', unitPrice: 200 },
    ]);
  });
  it('is empty for zero or negative counts', () => {
    expect(permaBootLineItems(0)).toEqual([]);
    expect(permaBootLineItems(-2)).toEqual([]);
  });
});

describe('waterDiverterLineItem', () => {
  it('is $250 each, one line', () => {
    expect(WATER_DIVERTER_RATE).toBe(250);
    expect(waterDiverterLineItem(2)).toEqual({ name: 'Water Diverter', quantity: 2, unit: 'ea', unitPrice: 250 });
  });
  it('is null for zero or negative counts', () => {
    expect(waterDiverterLineItem(0)).toBeNull();
    expect(waterDiverterLineItem(-1)).toBeNull();
  });
});
