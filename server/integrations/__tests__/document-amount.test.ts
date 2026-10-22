import { describe, it, expect } from 'vitest';
import { documentAmount } from '../jobtread';

/**
 * Found on a real job: every work order and purchase order came back as $0.00
 * because the money was read off `price`. JobTread puts a vendor document's
 * value in `cost` and leaves `price` at zero — so a commission built from
 * those documents had no costs at all, and paid the rep roughly double.
 */
describe('documentAmount', () => {
  it('reads a vendor document from cost, where its money actually is', () => {
    expect(documentAmount('vendorOrder', 0, 3755.97)).toBe(3755.97);
    expect(documentAmount('vendorBill', 0, 334.26)).toBe(334.26);
  });

  it('reads a customer document from price', () => {
    expect(documentAmount('customerOrder', 11204.41, 0)).toBe(11204.41);
    expect(documentAmount('customerInvoice', 11204.41, 0)).toBe(11204.41);
  });

  it('never returns the wrong side of a document', () => {
    // A vendor order that somehow carries a price must still report its cost.
    expect(documentAmount('vendorOrder', 9999, 625)).toBe(625);
    expect(documentAmount('customerOrder', 11204.41, 9999)).toBe(11204.41);
  });

  it('falls back to whichever side has a figure on an unfamiliar type', () => {
    expect(documentAmount('somethingNew', 0, 500)).toBe(500);
    expect(documentAmount('somethingNew', 700, 0)).toBe(700);
    expect(documentAmount('', 0, 0)).toBe(0);
  });
});
