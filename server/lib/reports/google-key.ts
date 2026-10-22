/**
 * Resolve the Google Maps platform key.
 *
 * The canonical name is GOOGLE_MAPS_API_KEY, but a near-miss spelling in the
 * environment fails silently: roof measurements just quietly fall back to rough
 * estimates and the report still renders, so nothing looks broken. Accept the
 * obvious variants and say out loud when a non-canonical one is used, rather
 * than letting a typo cost a day of debugging.
 */
const ALIASES = ['GOOGLE_MAPS_API_KEY', 'GOOGLEMAPS_API_KEY', 'GOOGLE_MAPS_KEY', 'MAPS_API_KEY'] as const;

let warned = false;

export function googleMapsKey(): string | undefined {
  for (const name of ALIASES) {
    const value = process.env[name];
    if (!value) continue;
    if (name !== ALIASES[0] && !warned) {
      warned = true;
      console.warn(`[google-maps] using ${name}; rename it to ${ALIASES[0]} to match the rest of the app.`);
    }
    return value;
  }
  return undefined;
}

/** Which variable supplied the key — for the integrations/status screens. */
export function googleMapsKeySource(): string | null {
  return ALIASES.find((n) => !!process.env[n]) ?? null;
}

export function googleMapsConfigured(): boolean {
  return !!googleMapsKey();
}
