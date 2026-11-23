/**
 * Brand font lookups for the report pages. Copied from the old program's
 * shared PDF helpers; only these two functions, nothing else from that file.
 */

const GOOGLE_FONT_URLS: Record<string, string> = {
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  merriweather: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
  playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap',
  roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  lato: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
};
const CSS_FONT_FAMILIES: Record<string, string> = {
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  merriweather: "'Merriweather', Georgia, 'Times New Roman', serif",
  playfair: "'Playfair Display', Georgia, 'Times New Roman', serif",
  roboto: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  lato: "'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};
const DEFAULT_FONT_KEY = 'inter';

/** Returns the Google Fonts CSS import URL for HTML reports */
export function getGoogleFontUrl(brandFontFamily?: string): string | null {
  const key = brandFontFamily || DEFAULT_FONT_KEY;
  return GOOGLE_FONT_URLS[key] || GOOGLE_FONT_URLS[DEFAULT_FONT_KEY];
}

/** Returns CSS font-family value for HTML reports */
export function getCssFontFamily(brandFontFamily?: string): string {
  const key = brandFontFamily || DEFAULT_FONT_KEY;
  return CSS_FONT_FAMILIES[key] || CSS_FONT_FAMILIES[DEFAULT_FONT_KEY];
}
