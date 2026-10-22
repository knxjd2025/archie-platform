/**
 * Manufacturer photos that show what a roof part looks like, for the
 * Inspection's roof drawings (roof-anatomy-shingle.ts, roof-anatomy-flat.ts).
 *
 * James asked for these on 2026-10-05. They are examples, never evidence:
 * every one prints labelled "Example" with its maker, beside — and kept
 * apart from — the job's own photos, so nobody reads a catalogue shot as a
 * picture of their roof. A part with no fitting photo on file gets none;
 * a different product is never stood in.
 *
 * The images are the same files the Proposal's system walkthrough uses
 * (client/public/roof-systems), served from the app host (assetUrl).
 */
import { assetUrl } from '../roof-systems.js';

export interface PartExample {
  /** Path under client/public/roof-systems. */
  image: string;
  /** What the photo shows, in plain words. */
  name: string;
  maker: string;
}

export interface ResolvedExample { url: string; name: string; maker: string }

/** Pitched-roof parts, by the part id in roof-anatomy-shingle.ts. */
const SHINGLE: Record<string, PartExample[]> = {
  'ice-water': [{ image: 'certainteed/winterguard.jpg', name: 'Ice & water shield going down at the eave', maker: 'CertainTeed' }],
  underlayment: [{ image: 'certainteed/diamonddeck.jpg', name: 'Synthetic underlayment over the deck', maker: 'CertainTeed' }],
  'drip-edge': [{ image: 'union/drip-edge.jpg', name: 'Metal drip edge', maker: 'Union Corrugating' }],
  starter: [{ image: 'certainteed/swiftstart.jpg', name: 'Starter shingles', maker: 'CertainTeed' }],
  covering: [{ image: 'certainteed/landmark.jpg', name: 'Architectural shingles on a finished roof', maker: 'CertainTeed' }],
  'covering-metal': [{ image: 'union/sl175.jpg', name: 'Standing seam metal panels', maker: 'Union Corrugating' }],
  'ridge-vent': [
    { image: 'certainteed/ridge-vent.jpg', name: 'A ridge vent, before the ridge cap goes over it', maker: 'CertainTeed' },
    { image: 'certainteed/shadow-ridge.jpg', name: 'Ridge cap shingles along the peak', maker: 'CertainTeed' },
  ],
};

/** Low-slope parts, by the part id in roof-anatomy-flat.ts. */
const FLAT: Record<string, PartExample[]> = {
  'layer-vapor': [{ image: 'gaf/vapor-retarder.jpg', name: 'A vapor retarder sheet', maker: 'GAF' }],
  'layer-insulation': [{ image: 'gaf/polyiso.jpg', name: 'A polyiso insulation board', maker: 'GAF' }],
  'layer-cover': [{ image: 'gaf/cover-board.jpg', name: 'A cover board', maker: 'GAF' }],
  'membrane-tpo': [{ image: 'gaf/tpo-membrane.jpg', name: 'White TPO membrane', maker: 'GAF' }],
  'membrane-pvc': [{ image: 'duro-last/membrane.jpg', name: 'PVC membrane', maker: 'Duro-Last' }],
  edge: [{ image: 'duro-last/edge-metal.jpg', name: 'Edge metal along the roof edge', maker: 'Duro-Last' }],
  'base-flashing': [{ image: 'duro-last/curb-flashing.jpg', name: 'Membrane flashed up the side of a rooftop curb', maker: 'Duro-Last' }],
  hvac: [{ image: 'duro-last/curb-flashing.jpg', name: 'Rooftop equipment on a flashed curb', maker: 'Duro-Last' }],
  penetrations: [
    { image: 'duro-last/stack-flashing.jpg', name: 'A pipe sealed with a flashing boot', maker: 'Duro-Last' },
    { image: 'gaf/pipe-boot.jpg', name: 'A pipe boot for a membrane roof', maker: 'GAF' },
  ],
  walkways: [{ image: 'duro-last/walkway-pads.jpg', name: 'Walkway pads marking a service path', maker: 'Duro-Last' }],
};

const resolve = (list: PartExample[] | undefined): ResolvedExample[] =>
  (list ?? []).map((e) => ({ url: assetUrl(e.image), name: e.name, maker: e.maker }));

export function shingleExamples(partId: string, opts: { metal?: boolean } = {}): ResolvedExample[] {
  return resolve(SHINGLE[partId === 'covering' && opts.metal ? 'covering-metal' : partId]);
}

/** `membrane` is the recorded membrane type; only TPO and PVC have a photo on file. */
export function flatExamples(partId: string, opts: { membrane?: string } = {}): ResolvedExample[] {
  if (partId === 'layer-membrane') {
    const m = String(opts.membrane ?? '');
    return resolve(/tpo/i.test(m) ? FLAT['membrane-tpo'] : /pvc/i.test(m) ? FLAT['membrane-pvc'] : undefined);
  }
  return resolve(FLAT[partId]);
}

/** Every image this file points at, for the test that keeps them on disk. */
export const EXAMPLE_IMAGES: string[] = [...new Set([...Object.values(SHINGLE), ...Object.values(FLAT)].flat().map((e) => e.image))];
