import { describe, it, expect, afterEach } from 'vitest';
import { PROJECT_MAP_CSS, PROJECT_MAP_HEAD, PROJECT_MAP_JS, ourWorkMapAvailable, projectMapContainerHtml, projectMapBrowserKey } from '../project-map-widget';

const saved = process.env.VITE_GOOGLE_MAPS_API_KEY;
afterEach(() => { if (saved === undefined) delete process.env.VITE_GOOGLE_MAPS_API_KEY; else process.env.VITE_GOOGLE_MAPS_API_KEY = saved; });

describe('project map widget', () => {
  it('runs on Google Maps, never OpenStreetMap tiles', () => {
    const all = PROJECT_MAP_HEAD + PROJECT_MAP_JS;
    expect(all).not.toMatch(/openstreetmap|leaflet|unpkg/i);
    expect(PROJECT_MAP_JS).toContain('https://maps.googleapis.com/maps/api/js?key=');
    expect(PROJECT_MAP_JS).toContain("fetch('/api/projects-map')");
  });
  it('embeds only the public browser key, sanitised, on the container', () => {
    process.env.VITE_GOOGLE_MAPS_API_KEY = 'AIzaPublic-key_1"><script>';
    expect(projectMapBrowserKey()).toBe('AIzaPublic-key_1"><script>');
    expect(projectMapContainerHtml()).toContain('data-maps-key="AIzaPublic-key_1script"');
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    expect(projectMapContainerHtml('x')).toContain('data-maps-key="" id="work-map-x"');
  });
  it('belongs to no one company: no fixed city, no fixed site, the company color', () => {
    // Centered on the company's own pins, linking only to a page each marker names.
    expect(PROJECT_MAP_JS).not.toMatch(/35\.2271|-80\.8431|https:\/\/www\./);
    expect(PROJECT_MAP_JS).toContain("getPropertyValue('--brand')");
    expect(PROJECT_MAP_CSS).not.toMatch(/#[0-9a-f]{6}; color: #fff; font-size: 12px/i);
    expect(PROJECT_MAP_CSS).toContain('var(--brand');
  });
  it('is left out of every report until the company has a project feed', () => {
    expect(ourWorkMapAvailable()).toBe(false);
  });
});
