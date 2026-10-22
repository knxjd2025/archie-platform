/**
 * What warranty a customer document may claim for the product actually
 * being quoted.
 *
 * The seal used to print "50-Yr Manufacturer / 15-Yr Workmanship" for every
 * product — including standing seam metal, stone-coated steel and the
 * synthetic shakes, none of which carry CertainTeed's 50-year figure. The
 * 50-year claim is kept for CertainTeed shingles (it is the SureStart PLUS
 * coverage BRN can register as a ShingleMaster); every other product gets an
 * honest line with no invented number, confirmed in writing at signing.
 * BRN's own 15-year workmanship warranty applies to all of them.
 */
import type { RoofingProduct } from './roofing-products.js';
import { WARRANTY } from './certainteed-data.js';

export interface ProductWarranty {
  manufacturer: string;
  /** Customer-facing line for the manufacturer side. */
  manufacturerLine: string;
  /** A year figure the seal may animate to, or null when there is none we can stand behind. */
  manufacturerYears: number | null;
  workmanshipYears: number;
  /** Whether the CertainTeed certification copy (SureStart PLUS, Integrity Roof System) applies. */
  certainteed: boolean;
  /** A tune-up or cleaning: no new roof, so no warranty chapter and no workmanship figure. */
  service?: boolean;
}

const CONFIRMED = 'confirmed in writing at signing';

export function warrantyFor(product: Pick<RoofingProduct, 'key' | 'manufacturer' | 'name'> & { category?: RoofingProduct['category'] }): ProductWarranty {
  const workmanshipYears = WARRANTY.workmanshipYears;
  // A tune-up or cleaning installs nothing: no manufacturer warranty, and the
  // workmanship warranty on a new roof does not apply. Say so; claim nothing.
  if (product.category === 'service' || product.key === 'tune_up' || product.key === 'cleaning') {
    return { manufacturer: 'Best Roofing Now', manufacturerLine: 'Maintenance on your existing roof &mdash; it carries no manufacturer warranty and does not reset your roof&rsquo;s age', manufacturerYears: null, workmanshipYears, certainteed: false, service: true };
  }
  if (product.manufacturer === 'CertainTeed') {
    return {
      manufacturer: 'CertainTeed',
      manufacturerLine: `${WARRANTY.manufacturerYears}-year manufacturer warranty — CertainTeed SureStart&trade; PLUS extended coverage, registered by Best Roofing Now as a CertainTeed ShingleMaster&trade;`,
      manufacturerYears: WARRANTY.manufacturerYears,
      workmanshipYears,
      certainteed: true,
    };
  }
  if (product.manufacturer === 'Tamko') {
    return { manufacturer: 'Tamko', manufacturerLine: `Tamko limited lifetime manufacturer warranty — terms ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
  }
  if (product.key === 'standing_seam_metal' || product.key === 'stone_coated_steel') {
    return { manufacturer: 'Metal system manufacturer', manufacturerLine: `Manufacturer panel and finish warranty for the specific metal system quoted — ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
  }
  if (product.manufacturer === 'CeDur' || product.manufacturer === 'DaVinci') {
    return { manufacturer: product.manufacturer, manufacturerLine: `${product.manufacturer} limited manufacturer warranty — terms ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
  }
  // Commercial low-slope: both makers issue a system warranty whose term
  // depends on membrane thickness and contractor tier — named, never numbered.
  if (product.manufacturer === 'Duro-Last') {
    return { manufacturer: 'Duro-Last', manufacturerLine: `Duro-Last&reg; no-dollar-limit system warranty, term set by the membrane and warranty tier quoted — ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
  }
  if (product.manufacturer === 'GAF') {
    return { manufacturer: 'GAF', manufacturerLine: `GAF EverGuard&reg; system guarantee (Integrated System, System Pledge&trade; or Diamond Pledge&trade; NDL, by certification level) — ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
  }
  return { manufacturer: product.manufacturer || 'Manufacturer', manufacturerLine: `Manufacturer warranty for the product quoted — ${CONFIRMED}`, manufacturerYears: null, workmanshipYears, certainteed: false };
}
