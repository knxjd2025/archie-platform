/**
 * The priced scope catalog: the specialty work a rep can add to a
 * replacement quote — skylights, chimney flashing and crickets, decking,
 * ventilation, gutters, low-slope membrane sections — so a Proposal or
 * Presentation is no longer limited to "tier × squares".
 *
 * Shared between the client (the picker) and the server (the price that is
 * actually charged), so a rate lives in exactly one place. The server never
 * trusts a price from the client: a rep gets the catalog price, and only a
 * manager may override it or add an item that is not in the catalog
 * (server/lib/reports/scope-items.ts).
 *
 * Prices: where an item already exists in server/lib/reports/roof-repair-
 * pricing.ts, its retail rate here is that base cost × the standard 1.65
 * multiplier, rounded to the cent — the same number an itemised repair
 * estimate would print. Perma-Boot and Water Diverter take their rates from
 * addon-pricing.ts, the same as the Estimate's quick-adds. Items marked
 * `unitPrice: null` had no rate anywhere in the system; rather than invent
 * one, they can only be added by a manager, who sets the price.
 */
import { PERMA_BOOT_FIRST_RATE, PERMA_BOOT_RATE, WATER_DIVERTER_RATE } from './addon-pricing';

export type ScopeUnit = 'ea' | 'lf' | 'sq' | 'sheet';

export type ScopeCategory =
  | 'penetrations' | 'flashing' | 'ventilation' | 'decking' | 'edges' | 'gutters' | 'low-slope' | 'upgrades' | 'maintenance';

export interface ScopeCatalogItem {
  id: string;
  name: string;
  /** Customer-facing: what the work is and why it is on the quote. */
  description: string;
  unit: ScopeUnit;
  /** Retail price per unit. null = not yet priced; a manager must set one. */
  unitPrice: number | null;
  /** When the first unit costs more than the rest (a Perma-Boot): the first at this, every one after at unitPrice. */
  firstUnitPrice?: number;
  category: ScopeCategory;
  /** Printed as a badge on the customer document. */
  requirement?: 'code' | 'manufacturer' | 'recommended';
}

export const SCOPE_CATEGORY_LABELS: Record<ScopeCategory, string> = {
  penetrations: 'Skylights, pipes & penetrations',
  flashing: 'Chimneys & flashing',
  ventilation: 'Ventilation',
  decking: 'Decking & structure',
  edges: 'Edges, fascia & soffit',
  gutters: 'Gutters',
  'low-slope': 'Flat / low-slope sections',
  upgrades: 'System upgrades',
  maintenance: 'Maintenance',
};

export const SCOPE_CATALOG: ScopeCatalogItem[] = [
  // Penetrations
  { id: 'skylight_replacement', name: 'Skylight replacement', description: 'Remove the existing skylight and install a new curb-mounted unit, flashed into the new roof system.', unit: 'ea', unitPrice: 1980, category: 'penetrations' },
  { id: 'skylight_reflash', name: 'Skylight re-flash & reseal', description: 'Keep the existing skylight; replace its flashing kit and seals as part of the new roof.', unit: 'ea', unitPrice: 660, category: 'penetrations' },
  { id: 'perma_boot', name: 'Perma-Boot pipe flashing', description: 'A lifetime retrofit pipe boot in place of the standard rubber collar, which is the most common source of a slow leak.', unit: 'ea', unitPrice: PERMA_BOOT_RATE, firstUnitPrice: PERMA_BOOT_FIRST_RATE, category: 'penetrations', requirement: 'recommended' },
  { id: 'satellite_removal', name: 'Satellite dish removal', description: 'Remove an abandoned dish and its mount, and seal the fastener holes it leaves in the deck.', unit: 'ea', unitPrice: 660, category: 'penetrations' },

  // Chimneys & flashing
  { id: 'chimney_reflash', name: 'Chimney flashing — new base, step & counter-flashing', description: 'All new metal on all four sides of the chimney, cut into the masonry, rather than reusing the old flashing.', unit: 'ea', unitPrice: 660, category: 'flashing', requirement: 'code' },
  { id: 'chimney_cricket', name: 'Chimney cricket (saddle)', description: 'A small peaked structure behind the chimney that splits water around it instead of letting it pool against the back.', unit: 'ea', unitPrice: null, category: 'flashing', requirement: 'code' },
  { id: 'water_diverter', name: 'Water diverter', description: 'A metal diverter flashed into the roof that steers runoff away from a doorway, wall or walkway, so the water goes where it is meant to instead of pouring over one spot.', unit: 'ea', unitPrice: WATER_DIVERTER_RATE, category: 'flashing' },

  // Ventilation
  { id: 'ridge_vent', name: 'Ridge vent', description: 'A continuous exhaust vent along the ridge, cut into the deck, that lets hot attic air out along the whole length of the roof.', unit: 'lf', unitPrice: 41.25, category: 'ventilation', requirement: 'recommended' },
  { id: 'intake_vents', name: 'Intake (soffit / edge) ventilation', description: 'Intake vents at the eaves so the ridge vent has air to pull — exhaust without intake does not ventilate.', unit: 'ea', unitPrice: null, category: 'ventilation', requirement: 'code' },
  { id: 'box_vent', name: 'Static (box) roof vent', description: 'A low-profile exhaust vent, flashed into the new roof.', unit: 'ea', unitPrice: 660, category: 'ventilation' },
  { id: 'turbine_vent', name: 'Turbine vent', description: 'A wind-driven exhaust vent, flashed into the new roof.', unit: 'ea', unitPrice: 288.75, category: 'ventilation' },

  // Decking & structure
  { id: 'decking_replacement', name: 'Decking replacement', description: 'Replace soft or rotted roof sheathing with new panels before the new roof goes on. Priced per 4×8 sheet; the exact count is confirmed once the old roof is off.', unit: 'sheet', unitPrice: 123.75, category: 'decking', requirement: 'code' },
  { id: 'rafter_repair', name: 'Rafter sister / repair', description: 'Reinforce a damaged rafter with a new member alongside it.', unit: 'ea', unitPrice: 412.5, category: 'decking' },

  // Edges
  { id: 'drip_edge', name: 'Drip edge (where none exists)', description: 'Metal edging at the eaves and rakes that carries water off the deck and into the gutter instead of behind the fascia.', unit: 'lf', unitPrice: 16.5, category: 'edges', requirement: 'code' },
  { id: 'fascia_repair', name: 'Fascia board replacement', description: 'Replace rotted fascia so the gutters have something sound to hang from.', unit: 'lf', unitPrice: 29.7, category: 'edges' },
  { id: 'soffit_repair', name: 'Soffit repair', description: 'Repair or replace damaged soffit panels along the underside of the eaves.', unit: 'lf', unitPrice: 24.75, category: 'edges' },

  // Gutters
  { id: 'gutter_replacement', name: 'Gutter replacement', description: 'New seamless gutters, hung to drain correctly.', unit: 'lf', unitPrice: 36.3, category: 'gutters' },
  { id: 'gutter_repair', name: 'Gutter repair / re-hang', description: 'Re-secure and re-pitch sagging or separated gutters.', unit: 'lf', unitPrice: 24.75, category: 'gutters' },
  { id: 'downspout_replacement', name: 'Downspout replacement', description: 'New downspout, tied into the existing drainage.', unit: 'ea', unitPrice: 140.25, category: 'gutters' },
  { id: 'gutter_guards', name: 'Gutter guards', description: 'Guards over the gutters so leaves and granules do not clog them.', unit: 'lf', unitPrice: 19.8, category: 'gutters' },

  // Low-slope
  { id: 'low_slope_membrane', name: 'Low-slope membrane section (TPO / modified bitumen)', description: 'Flat or low-pitch sections get a proper membrane roof — shingles are not permitted on slopes under 2:12 and are not warranted there.', unit: 'sq', unitPrice: null, category: 'low-slope', requirement: 'code' },

  // Upgrades
  { id: 'ice_water_full', name: 'Ice & water shield — full deck coverage', description: 'Self-adhering waterproofing over the entire deck rather than only the valleys and penetrations.', unit: 'sq', unitPrice: null, category: 'upgrades', requirement: 'recommended' },
  { id: 'synthetic_underlayment_upgrade', name: 'Premium synthetic underlayment upgrade', description: 'Upgrade to a heavier synthetic underlayment across the whole deck.', unit: 'sq', unitPrice: null, category: 'upgrades' },

  // Maintenance
  { id: 'maintenance_plan', name: 'Annual roof maintenance plan', description: 'A yearly inspection, debris clearing, sealant check and photo report, so small problems stay small.', unit: 'ea', unitPrice: null, category: 'maintenance' },
];

export function scopeCatalogItem(id: string): ScopeCatalogItem | undefined {
  return SCOPE_CATALOG.find((i) => i.id === id);
}

/** What the client sends per chosen item. `unitPrice`/`name` are honoured only for a manager (server-enforced). */
export interface ScopeItemInput {
  /** A SCOPE_CATALOG id, or absent for a manager-typed custom item. */
  catalogId?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  unitCost?: number;
  note?: string;
}

export const MAX_SCOPE_ITEMS = 40;
