/**
 * Pricing rules for the standing roof add-ons a rep can sell without typing a
 * price from memory: Roof Tune-Up, Roof Cleaning, Perma-Boot retrofits and
 * water diverters.
 * Shared between the client (building the line items a rep adds to an
 * estimate) and the server, so the rates live in exactly one place.
 */

export type TuneUpTier = 'basic' | 'advanced';

export const TUNE_UP_RATES: Record<TuneUpTier, number> = {
  basic: 24.99,
  advanced: 54.99,
};

export const TUNE_UP_LABELS: Record<TuneUpTier, string> = {
  basic: 'Basic Roof Tune-Up',
  advanced: 'Advanced Roof Tune-Up',
};

/** Steep roofs take longer and are riskier to work — added to either tune-up tier's rate. */
export const TUNE_UP_STEEP_SURCHARGE_PER_SQUARE = 20;

export function tuneUpRatePerSquare(tier: TuneUpTier, steep: boolean): number {
  return Math.round((TUNE_UP_RATES[tier] + (steep ? TUNE_UP_STEEP_SURCHARGE_PER_SQUARE : 0)) * 100) / 100;
}

export interface AddonLine {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

/** A tune-up priced against the roof's size — one line item. */
export function tuneUpLineItem(tier: TuneUpTier, squares: number, steep: boolean): AddonLine {
  return {
    name: `${TUNE_UP_LABELS[tier]}${steep ? ' (steep)' : ''}`,
    quantity: squares,
    unit: 'sq',
    unitPrice: tuneUpRatePerSquare(tier, steep),
  };
}

export type CleaningTier = 'basic' | 'advanced';

export const CLEANING_RATES: Record<CleaningTier, number> = {
  basic: 24.99,
  advanced: 71.99,
};

export const CLEANING_LABELS: Record<CleaningTier, string> = {
  basic: 'Basic Roof Cleaning',
  advanced: 'Advanced Roof Cleaning',
};

/** Same steep/difficulty surcharge as the tune-up — added to either cleaning tier's rate. */
export const CLEANING_STEEP_SURCHARGE_PER_SQUARE = 20;

export function cleaningRatePerSquare(tier: CleaningTier, steep: boolean): number {
  return Math.round((CLEANING_RATES[tier] + (steep ? CLEANING_STEEP_SURCHARGE_PER_SQUARE : 0)) * 100) / 100;
}

/** A roof cleaning priced against the roof's size — one line item. */
export function cleaningLineItem(tier: CleaningTier, squares: number, steep: boolean): AddonLine {
  return {
    name: `${CLEANING_LABELS[tier]}${steep ? ' (steep)' : ''}`,
    quantity: squares,
    unit: 'sq',
    unitPrice: cleaningRatePerSquare(tier, steep),
  };
}

export const PERMA_BOOT_RATE = 200;
export const PERMA_BOOT_FIRST_RATE = 450;

/**
 * $450 for the first boot on a job and $200 for every boot after it, whatever
 * else is sold alongside: the first boot carries the setup and the work of
 * tying a retrofit into the existing roof. (Until 2026-10-06 the $450 applied
 * only when boots were the whole job; it was made every job.)
 */
export function permaBootTotal(count: number): number {
  if (count <= 0) return 0;
  return PERMA_BOOT_FIRST_RATE + (count - 1) * PERMA_BOOT_RATE;
}

/** Perma-boot count, split into the clean priced line items an itemized estimate shows. */
export function permaBootLineItems(count: number): AddonLine[] {
  if (count <= 0) return [];
  if (count === 1) return [{ name: 'Perma-Boot', quantity: 1, unit: 'ea', unitPrice: PERMA_BOOT_FIRST_RATE }];
  return [
    { name: 'Perma-Boot (first boot)', quantity: 1, unit: 'ea', unitPrice: PERMA_BOOT_FIRST_RATE },
    { name: 'Perma-Boot (additional)', quantity: count - 1, unit: 'ea', unitPrice: PERMA_BOOT_RATE },
  ];
}

/** A metal water diverter, $250 each. */
export const WATER_DIVERTER_RATE = 250;

export function waterDiverterLineItem(count: number): AddonLine | null {
  if (count <= 0) return null;
  return { name: 'Water Diverter', quantity: count, unit: 'ea', unitPrice: WATER_DIVERTER_RATE };
}

/*
 * Tune-up and cleaning as a Good/Better/Best option (not just an add-on line):
 * the rep sets the rate per square for the job, inside this band. The server
 * refuses a rate outside it, so a rep can't quote $5 or $500 a square.
 */
export type ServiceTierKey = 'tune_up' | 'cleaning';

export const SERVICE_TIER_RATE_MIN = 29;
export const SERVICE_TIER_RATE_MAX = 99;

export const SERVICE_TIER_LABELS: Record<ServiceTierKey, string> = {
  tune_up: 'Roof Tune-Up',
  cleaning: 'Roof Cleaning',
};

export function isServiceTierKey(v: unknown): v is ServiceTierKey {
  return v === 'tune_up' || v === 'cleaning';
}

/**
 * True when a rep's rate sits inside the band, in whole cents. The cents were
 * promised here and never checked: $64.555 passed, the server rounded it to
 * $64.56 on save, and the rate on the document was not the one the rep typed.
 */
export function serviceTierRateOk(rate: unknown): boolean {
  if (rate == null || (typeof rate === 'string' && !rate.trim())) return false;
  const n = Number(rate);
  if (!Number.isFinite(n) || n < SERVICE_TIER_RATE_MIN || n > SERVICE_TIER_RATE_MAX) return false;
  // Scaled to cents and compared within float noise, since 64.57 * 100 is 6456.999999999999.
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}
