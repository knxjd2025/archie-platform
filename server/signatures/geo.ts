/**
 * Where the signer was.
 *
 * Two independent answers, and the audit page never confuses them:
 *
 *  - GPS, if the signer let the browser share it. A doorstep, with the
 *    browser's own accuracy radius attached.
 *  - Network, from the IP. A city. Always available, never asked for, and the
 *    fallback when someone taps "Don't allow" — which is the whole reason the
 *    prompt never blocks signing.
 *
 * Coordinates are reverse-geocoded to a street address, and measured against
 * the property the document is about, because "signed at the property" is the
 * claim these records usually have to answer.
 */
import type { Request } from 'express';
import { googleMapsKey } from '../lib/reports/google-key';
import { haversineMeters, type GeoSource, type SignerGeo } from '../../shared/signatures';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

const clean = (v: unknown, max = 200): string | null => {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  return s || null;
};

/** The signer's IP: the left-most hop in x-forwarded-for, which is the client. */
export function clientIp(req: Request): string | null {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return clean(fwd || req.ip || '', 60);
}

/**
 * The location Vercel's edge attaches to every request from the IP. Free,
 * instant, and city-level at best — which is why it is labelled 'network'
 * rather than dressed up as a position.
 */
export function networkGeo(req: Request): SignerGeo {
  const h = req.headers;
  const dec = (v: unknown): string | null => {
    const s = clean(v);
    if (!s) return null;
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const lat = num(h['x-vercel-ip-latitude']);
  const lng = num(h['x-vercel-ip-longitude']);
  const city = dec(h['x-vercel-ip-city']);
  const region = dec(h['x-vercel-ip-country-region']);
  const country = dec(h['x-vercel-ip-country']);

  return {
    source: city || lat != null ? 'network' : 'none',
    lat, lng, accuracyM: null,
    address: null, city, region, country,
    distanceFromPropertyM: null,
    capturedAt: new Date().toISOString(),
  };
}

/** A street address for coordinates. Google first, OpenStreetMap when there's no key. */
export async function reverseGeocode(lat: number, lng: number): Promise<{ address: string | null; city: string | null; region: string | null; country: string | null }> {
  const empty = { address: null, city: null, region: null, country: null };
  const key = googleMapsKey();

  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`);
      if (r.ok) {
        const data: any = await r.json();
        const hit = data?.results?.[0];
        if (hit) {
          const part = (type: string) => hit.address_components?.find((c: any) => c.types?.includes(type))?.long_name || null;
          return {
            address: clean(hit.formatted_address),
            city: clean(part('locality') || part('sublocality')),
            region: clean(part('administrative_area_level_1')),
            country: clean(part('country')),
          };
        }
      }
    } catch (e: any) {
      console.warn('[signatures/geo] Google reverse geocode failed:', e?.message || e);
    }
  }

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': 'BestRoofingNow-TeamApp/1.0 (app.bestroofingnow.com)' } },
    );
    if (r.ok) {
      const data: any = await r.json();
      const a = data?.address || {};
      return {
        address: clean(data?.display_name, 300),
        city: clean(a.city || a.town || a.village || a.hamlet),
        region: clean(a.state),
        country: clean(a.country),
      };
    }
  } catch (e: any) {
    console.warn('[signatures/geo] Nominatim reverse geocode failed:', e?.message || e);
  }

  return empty;
}

/** Coordinates for the property, so a signature can be measured against it. */
export async function geocodeProperty(address: string): Promise<{ lat: number; lng: number } | null> {
  const q = address.trim();
  if (!q) return null;
  const key = googleMapsKey();

  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`);
      if (r.ok) {
        const data: any = await r.json();
        const loc = data?.results?.[0]?.geometry?.location;
        if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return { lat: loc.lat, lng: loc.lng };
      }
    } catch (e: any) {
      console.warn('[signatures/geo] Google geocode failed:', e?.message || e);
    }
  }

  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'User-Agent': 'BestRoofingNow-TeamApp/1.0 (app.bestroofingnow.com)' } },
    );
    if (r.ok) {
      const data: any = await r.json();
      const lat = num(data?.[0]?.lat), lng = num(data?.[0]?.lon);
      if (lat != null && lng != null) return { lat, lng };
    }
  } catch (e: any) {
    console.warn('[signatures/geo] Nominatim geocode failed:', e?.message || e);
  }

  return null;
}

export interface CapturedPosition {
  lat: unknown;
  lng: unknown;
  accuracy?: unknown;
}

/**
 * Turn whatever the signing page sent — possibly nothing — into the location
 * record that goes on the signature.
 *
 * The browser's coordinates are not trusted to be sane: they arrive from a
 * public form, so anything outside the real range of a latitude or longitude
 * is dropped back to the network answer rather than stored as a position.
 */
export async function resolveSignerGeo(
  req: Request,
  position: CapturedPosition | null,
  property: { lat: number | null; lng: number | null } | null,
): Promise<SignerGeo> {
  const lat = num(position?.lat);
  const lng = num(position?.lng);
  const usable = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

  if (!usable) {
    const net = networkGeo(req);
    return { ...net, distanceFromPropertyM: distanceTo(net.lat, net.lng, property) };
  }

  const accuracy = num(position?.accuracy);
  const place = await reverseGeocode(lat!, lng!);
  return {
    source: 'gps' as GeoSource,
    lat: lat!, lng: lng!,
    accuracyM: accuracy != null && accuracy >= 0 && accuracy < 100000 ? Math.round(accuracy) : null,
    ...place,
    distanceFromPropertyM: distanceTo(lat, lng, property),
    capturedAt: new Date().toISOString(),
  };
}

function distanceTo(lat: number | null, lng: number | null, property: { lat: number | null; lng: number | null } | null): number | null {
  if (lat == null || lng == null || !property || property.lat == null || property.lng == null) return null;
  return haversineMeters({ lat, lng }, { lat: property.lat, lng: property.lng });
}
