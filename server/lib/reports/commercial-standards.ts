/**
 * The code sections and industry standards a commercial (low-slope) roof
 * report stands on — the same gate as damage-standards.ts: a citation prints
 * on a customer document ONLY once a person has verified it against the
 * source and set `verifiedOn`. Until then the report makes the argument in
 * plain English and the citation stays off the page.
 *
 * Section numbers below are DRAFTS for the company to check against the 2018 NC
 * Building Code (IBC 2015 base) and the 2018 NC Energy Conservation Code —
 * see COMMERCIAL_STANDARDS_REVIEW.md. Do not set verifiedOn from memory.
 */
import type { StandardRef } from './damage-standards.js';

export const COMMERCIAL_CODE_EDITION = '2018 NC Building Code';

export type CommercialStandardKey =
  | 'recover-limits' | 'reroof-flashing' | 'reinstall-materials' | 'min-slope' | 'secondary-drainage' | 'edge-metal'
  | 'fire-class' | 'wind-uplift' | 'equipment-guards'
  | 'energy-r-value' | 'energy-reroof' | 'energy-cool-roof' | 'energy-exempt-fsu'
  | 'ponding-definition' | 'moisture-survey' | 'coating-candidacy' | 'fall-protection' | 'service-life' | 'maintenance-required';

/**
 * Drafted from the 2026-09-14 research pass (scratchpad commercial-roof-
 * research.md): section numbers were read from the 2018 NC Building Code
 * (2015 IBC base) and 2018 NC Energy Conservation Code as rendered on
 * UpCodes / OSFM material. The 2024 NC codes (2021 IBC base) are adopted
 * but were not confirmed effective; when they are, §1511 becomes §1512.
 * Every entry stays unverified until someone checks it against the printed code.
 */
export const COMMERCIAL_STANDARDS: Record<CommercialStandardKey, StandardRef> = {
  'recover-limits': { cite: 'Section 1511.3.1.1', title: 'A roof recover is not permitted where the existing roof is water-soaked or deteriorated, or has two or more applications of any roof covering', verifiedOn: null },
  'reroof-flashing': { cite: 'Section 1511.6', title: 'Flashings reconstructed in accordance with the manufacturer\'s approved installation instructions', verifiedOn: null },
  'reinstall-materials': { cite: 'Section 1511.5', title: 'Existing metal edgings, drain outlets, collars and counterflashings may not be reinstalled where rusted, damaged or deteriorated; aggregate surfacing may not be reinstalled', verifiedOn: null },
  'min-slope': { cite: 'Sections 1507.10.1–1507.15.1', title: 'Built-up, modified bitumen, single-ply, SPF and liquid-applied roofs: design slope not less than 1/4 in 12 (coal-tar BUR 1/8 in 12); §1511.1 Exc. 1 relieves a reroof that already drains positively', verifiedOn: null },
  'secondary-drainage': { cite: 'Sections 1503.4.1–1503.4.2', title: 'Secondary (emergency overflow) drains or scuppers where the perimeter would trap water if the primary drains block; scupper opening not less than 4 in', verifiedOn: null },
  'edge-metal': { cite: 'Section 1504.5 — ANSI/SPRI ES-1', title: 'Metal edge securement on low-slope BUR, modified bitumen and single-ply roofs designed and tested to ANSI/SPRI ES-1 (RE-1, RE-2, RE-3)', verifiedOn: null },
  'fire-class': { cite: 'Section 1505.1 — ASTM E108 / UL 790', title: 'Roof assemblies classified A, B or C by ASTM E108 or UL 790; minimum class by construction type per Table 1505.1', verifiedOn: null },
  'wind-uplift': { cite: 'Section 1504.1 / Chapter 16 — FM 4474, UL 580, UL 1897', title: 'Roof decks and coverings designed for the Chapter 16 (ASCE 7) wind loads; uplift resistance by an approved test method', verifiedOn: null },
  'equipment-guards': { cite: 'Section 1015.6', title: 'Guards where serviceable rooftop equipment sits within 10 ft of an edge more than 30 in above the surface below (or ANSI/ASSE Z359.1 anchorage in lieu)', verifiedOn: null },
  'energy-r-value': { cite: '2018 NC Energy Conservation Code Table C402.1.3 / C402.1.4', title: 'Climate Zone 3: insulation entirely above deck R-25ci, or U-0.039', verifiedOn: null },
  'energy-reroof': { cite: '2018 NC Energy Conservation Code C503.1, Exception e', title: 'Roof recover and roof replacement that leave the building no less conforming are exempt from the alteration provisions — an insulation upgrade is a recommendation, not a mandate (NC amendment; the model IECC C503.3.1 trigger is not adopted)', verifiedOn: null },
  'energy-cool-roof': { cite: '2018 NC Energy Conservation Code C402.3 / Table C402.3', title: 'Low-slope roofs over cooled space in Climate Zones 1–3: 3-year aged solar reflectance 0.55 and emittance 0.75, or aged SRI 64 (exceptions for ballast, PV, shaded areas, metal building roofs)', verifiedOn: null },
  'energy-exempt-fsu': { cite: '2018 NC Energy Conservation Code C101.2, Exception 2 (G.S. 143-138(b18))', title: 'No energy-code provisions apply to a building whose primary occupancy is Group F, S or U — most warehouses and factories', verifiedOn: null },
  'ponding-definition': { cite: 'NRCA / ARMA definition; GAF Liquid-Applied Roofing Manual', title: 'Ponding: water that remains on a roof 48 hours after precipitation ends; positive drainage means the roof drains within 48 hours', verifiedOn: null },
  'moisture-survey': { cite: 'ASTM C1153 (infrared); ANSI/SPRI/IIBEC NT-1 (nuclear); ASTM D7954 (impedance); ASTM D2829 (core sampling)', title: 'Non-destructive moisture surveys locate wet insulation and are verified by core cuts with gravimetric analysis', verifiedOn: null },
  'coating-candidacy': { cite: 'GAF Liquid-Applied Roofing Manual v2.1 (COMCO180)', title: 'A coating is warrantable only over a dry, adhered substrate: moisture survey required, 25% or more wet area means a complete tear-off, all wet insulation replaced, adhesion above 2 PLI, no ponding beyond 48 hours', verifiedOn: null },
  'fall-protection': { cite: 'OSHA 29 CFR 1926.501(b)(10); 1910.29(b)(1)', title: 'Fall protection on low-slope roofs with unprotected edges 6 ft or more above a lower level; a guardrail top rail is 42 in ± 3 in', verifiedOn: null },
  'service-life': { cite: 'EPDM Roofing Association; IIBEC field-aged TPO study; SPRI PVC white paper; RICOWI (SPF); MCA (metal)', title: 'Published service-life evidence by membrane type; modified bitumen and BUR figures are industry estimates only', verifiedOn: null },
  'maintenance-required': { cite: 'GAF Diamond Pledge NDL specimen (exclusion 1) and WellRoof addendum; Duro-Last "Protect Your Roof Warranty"', title: 'Manufacturer system warranties exclude inadequate maintenance and require inspection records; GAF extends a Diamond Pledge up to 25% for documented annual inspections', verifiedOn: null },
};

export function commercialRef(key: CommercialStandardKey): StandardRef {
  return COMMERCIAL_STANDARDS[key];
}

/** Verified refs only — what may print. */
export function printableCommercialRefs(keys: CommercialStandardKey[]): StandardRef[] {
  return keys.map((k) => COMMERCIAL_STANDARDS[k]).filter((r) => !!r.verifiedOn);
}

/** The review worksheet rows. */
export function commercialStandardsReviewSheet(): Array<{ key: string; cite: string; title: string; verifiedOn: string | null }> {
  return (Object.keys(COMMERCIAL_STANDARDS) as CommercialStandardKey[]).map((key) => ({ key, ...COMMERCIAL_STANDARDS[key] }));
}
