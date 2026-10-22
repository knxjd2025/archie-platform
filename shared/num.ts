/**
 * Coerce to a finite number, defaulting to 0 for anything that isn't one.
 *
 * Strings are read the way a person types money: "$12,500" and "12 500" are
 * 12500. Number() alone made both 0, so a revenue pasted from a contract was
 * stored as $0 and the commission on it came to nothing. Commas are only
 * dropped when they sit where thousands separators go, so "1,5" stays
 * unreadable (0) rather than quietly becoming 15.
 */
const THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d*)?$/;

export const num = (v: unknown): number => {
  let x = v;
  if (typeof x === 'string') {
    const s = x.replace(/[\s$]/g, '');
    x = THOUSANDS.test(s) ? s.replace(/,/g, '') : s;
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Round to whole cents, half away from zero.
 *
 * Math.round(n * 100) / 100 is the obvious version and it is wrong for money:
 * 1.005 * 100 is 100.49999999999999 in floating point, so $1.005 rounded to
 * $1.00, and toFixed(2) has the same flaw. Normalising the scaled value to 15
 * significant digits first removes the representation error before rounding.
 */
export function roundCents(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
  const out = (Math.sign(n) * cents) / 100;
  return out === 0 ? 0 : out; // never -0, which prints as "-0.00"
}
