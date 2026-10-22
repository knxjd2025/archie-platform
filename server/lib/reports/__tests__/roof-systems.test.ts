import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { roofSystemFor, commercialRoofSystemFor, allRoofSystems, assetUrl } from '../roof-systems';
import { roofSystemWalkthrough } from '../sections/roof-system-walkthrough';
import { SCROLL_STYLE, DOCUMENT_STYLE } from '../sections/style';
import { ROOFING_PRODUCTS } from '../roofing-products';
import { COMMERCIAL_PRODUCTS } from '../commercial-products';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import { renderInspectionHtml } from '../render-inspection-html';
import { applyReplacementPricing } from '../estimate-replacement';
import { withCustomLines } from '../estimate-editing';
import type { TierSelection } from '../roofing-products';

const PUBLIC = resolve(__dirname, '../../../../client/public/roof-systems');

const report = (): any => ({
  id: 'r-sys', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '9 System Ct', city: 'Charlotte', state: 'NC', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

const tiers = (better: string) => ({ good: 'landmark', better, best: 'landmark_presidential' }) as TierSelection;
const priced = (better: string, selected: 'good' | 'better' | 'best' = 'better') =>
  applyReplacementPricing(report(), { tierSelection: tiers(better), squares: 30, selectedTier: selected });

describe('every package has a layer-by-layer system', () => {
  it('resolves for every catalog product and for no custom product', () => {
    for (const p of ROOFING_PRODUCTS) {
      const s = roofSystemFor(p);
      expect(s, p.key).not.toBeNull();
      expect(s!.components.length, p.key).toBeGreaterThanOrEqual(7);
      expect(s!.components.some((c) => c.role === 'field'), p.key).toBe(true);
    }
    expect(roofSystemFor('custom')).toBeNull();
    expect(roofSystemFor({ key: 'custom' })).toBeNull();
  });

  it('every image a step names is actually shipped in client/public', () => {
    let shipped = 0;
    for (const { key, system } of allRoofSystems()) {
      const paths = [system.cutaway, ...system.components.map((c) => c.image)].filter((p): p is string => !!p);
      for (const p of paths) {
        expect(existsSync(resolve(PUBLIC, p)), `${key}: ${p}`).toBe(true);
        shipped++;
      }
    }
    expect(shipped).toBeGreaterThan(40);
    expect(assetUrl('certainteed/landmark.jpg')).toBe('https://app.bestroofingnow.com/roof-systems/certainteed/landmark.jpg');
  });

  it('keeps one manufacturer per package, and says so where none makes the part', () => {
    const ct = roofSystemFor('landmark_pro')!;
    expect(ct.components.every((c) => c.maker === 'CertainTeed' || c.maker === 'Best Roofing Now')).toBe(true);
    expect(ct.components.find((c) => c.role === 'drip-edge')!.maker).toBe('Best Roofing Now');
    expect(ct.components.find((c) => c.role === 'drip-edge')!.image).toBeNull();

    // CertainTeed's own pairing table, not one cap for everything.
    expect(roofSystemFor('landmark')!.components.find((c) => c.role === 'hip-ridge')!.name).toContain('Shadow Ridge');
    expect(roofSystemFor('landmark_presidential')!.components.find((c) => c.role === 'hip-ridge')!.name).toContain('Cedar Crest');
    const gm = roofSystemFor('landmark_grand_manor')!.components.find((c) => c.role === 'hip-ridge')!;
    expect(gm.name).toContain('Shangle Ridge');
    expect(gm.image).toBeNull(); // no manufacturer photo found — no stand-in

    // The makers that sell only the top layer sit on CertainTeed underlayment (James, 2026-09-14).
    for (const key of ['standing_seam_metal', 'stone_coated_steel', 'cedur_shake', 'davinci_shake'] as const) {
      const s = roofSystemFor(key)!;
      expect(s.components.find((c) => c.role === 'underlayment')!.maker, key).toBe('CertainTeed');
      expect(s.components.find((c) => c.role === 'ice-water')!.maker, key).toBe('CertainTeed');
    }
    // and the metal ones get the high-temperature membrane, not the shingle one.
    expect(roofSystemFor('standing_seam_metal')!.components.find((c) => c.role === 'ice-water')!.name).toContain('HT X');
    expect(roofSystemFor('stone_coated_steel')!.components.find((c) => c.role === 'ice-water')!.name).toContain('HT X');
    expect(roofSystemFor('standing_seam_metal')!.maker).toBe('Union Corrugating');
    expect(roofSystemFor('stone_coated_steel')!.maker).toBe('DECRA');
  });

  it('never borrows CertainTeed warranty language into a non-CertainTeed package', () => {
    for (const key of ['tamko_titan_basic', 'standing_seam_metal', 'stone_coated_steel'] as const) {
      const text = JSON.stringify(roofSystemFor(key));
      expect(text, key).not.toMatch(/SureStart|Integrity Roof System/);
    }
    // TAMKO sells no ridge vent and no intake — the step says so instead of inventing one.
    const tamko = roofSystemFor('tamko_titan_basic')!;
    expect(tamko.components.find((c) => c.role === 'exhaust')!.maker).toBe('Best Roofing Now');
    expect(tamko.components.find((c) => c.role === 'intake')).toBeUndefined();
  });

  it('commercial systems exist, spelled the way the manufacturer spells itself', () => {
    expect(commercialRoofSystemFor('gaf_commercial_tpo')!.components.length).toBeGreaterThanOrEqual(7);
    expect(commercialRoofSystemFor('dura_last_tpo')!.maker).toBe('Duro-Last');
    expect(commercialRoofSystemFor('dura_last_layover')!.components[0].role).toBe('prep');
    expect(commercialRoofSystemFor('dura_last_tpo')!.components[0].role).toBe('vapor');
    expect(commercialRoofSystemFor('restoration_coating')).toBeNull();
    expect(JSON.stringify(allRoofSystems())).not.toContain('Dura-Last');
    expect(JSON.stringify(COMMERCIAL_PRODUCTS)).not.toContain('Dura-Last');
    expect(COMMERCIAL_PRODUCTS.find((p) => p.key === 'dura_last_tpo')!.name).toContain('PVC');
    // Every GAF step has its product-page photo (captured from the rendered page).
    expect(commercialRoofSystemFor('gaf_commercial_tpo')!.components.every((c) => c.image?.startsWith('gaf/'))).toBe(true);
    expect(roofSystemFor('davinci_shake')!.cutaway).toBe('davinci/roof-aerial.jpg');
    expect(roofSystemFor('standing_seam_metal')!.components.find((c) => c.role === 'drip-edge')!.image).toBe('union/drip-edge.jpg');
  });
});

describe('the walkthrough section', () => {
  it('numbers every step, hosts every photo on the app, and labels a photo-less step instead of faking one', () => {
    const html = roofSystemWalkthrough(roofSystemFor('landmark')!, SCROLL_STYLE);
    expect(html).toContain('Step 1');
    expect(html).toContain('Step 9'); // drip edge … intake vent
    expect(html).toContain('src="https://app.bestroofingnow.com/roof-systems/certainteed/winterguard.jpg"');
    expect(html).toContain('src="https://app.bestroofingnow.com/roof-systems/certainteed/integrity-cutaway.jpg"');
    expect(html).toContain('rsw-media--none'); // drip edge, step flashing
    expect(html).toContain('<span>Supplied by</span><b>Best Roofing Now</b>'); // the labelled card
    expect(html).toContain('Made by CertainTeed'); // the byline under a photographed step
    expect(html).not.toContain('Supplied by Best Roofing Now'); // no byline repeating the card
    expect(html).not.toMatch(/alt="[^"]*&(reg|trade|amp);/); // entities stripped from alt text
    expect(html).toContain('Product photography courtesy of CertainTeed');
    const doc = roofSystemWalkthrough(roofSystemFor('landmark')!, DOCUMENT_STYLE, { cutaway: false });
    expect(doc).not.toContain('integrity-cutaway');
    expect(doc).toContain('class="muted tiny"');
  });
});

describe('where the walkthrough appears', () => {
  it('Proposal: a shingle roof walks the Integrity System; a metal roof walks Union Corrugating', () => {
    const shingle = renderProposalScrollcraftHtml(priced('standing_seam_metal', 'good'), { customer: 'T' });
    expect(shingle).toContain('id="ch-system"');
    expect(shingle).toContain('The Integrity Roof System');
    expect(shingle).toContain('SwiftStart');
    expect(shingle).toContain('href="#ch-system"');
    expect(shingle).toContain('.rsw-step {'); // css shipped

    const metal = renderProposalScrollcraftHtml(priced('standing_seam_metal'), { customer: 'T' });
    expect(metal).toContain('How Your Roof Goes Together');
    expect(metal).toContain('SL175');
    expect(metal).toContain('WinterGuard&reg; HT X');
    expect(metal).not.toContain('Integrity Roof System');
    expect(metal).not.toContain('SureStart');
  });

  it('Presentation: the system chapter is the walkthrough plus the warranty seal', () => {
    const html = renderPresentationScrollcraftHtml(priced('cedur_shake'), { customer: 'T' });
    expect(html).toContain('id="ch-system"');
    expect(html).toContain('CEDUR Shakes');
    expect(html).toContain('CEDUR Starter Material');
    expect(html).toContain('rsw-steps');
    expect(html).toContain('Yr Workmanship');
    expect(html).toContain('.rsw-step {');
  });

  it('Estimate: a replacement lists every layer; a repair does not', () => {
    const replacement = renderEstimateHtml(priced('stone_coated_steel'), { customer: 'T' });
    expect(replacement).toContain('What goes on, layer by layer');
    expect(replacement).toContain('DECRA Shingle XD');
    expect(replacement).toContain('DECRA Ridge Vent');
    expect(replacement).toContain('.rsw-step {');
    expect(replacement).not.toContain('integrity-cutaway');

    const repair = renderEstimateHtml(withCustomLines(report(), [{ name: 'Tune-up', quantity: 1, unit: 'ea', unitPrice: 200 }]), { customer: 'T' });
    expect(repair).not.toContain('layer by layer');
    expect(repair).not.toContain('<ol class="rsw-steps"'); // the CSS ships with the shell; the markup must not
  });

  it('Inspection: sells no product — no walkthrough, and manufacturer photos only as labelled examples', () => {
    const html = renderInspectionHtml(report(), { jobType: 'retail' });
    expect(html).not.toContain('rsw-');
    // Any manufacturer image is an "Example: …" inside the roof drawing's example box (anatomy-examples.ts).
    for (const m of html.matchAll(/<img[^>]*roof-systems\/[^>]*>/g)) expect(m[0]).toContain('alt="Example: ');
  });
});
