import { describe, it, expect, afterEach } from 'vitest';
import { PROJECT_MAP_HEAD, PROJECT_MAP_JS, projectMapContainerHtml, projectMapBrowserKey, upgradeLegacyProjectMap } from '../project-map-widget';

const saved = process.env.VITE_GOOGLE_MAPS_API_KEY;
afterEach(() => { if (saved === undefined) delete process.env.VITE_GOOGLE_MAPS_API_KEY; else process.env.VITE_GOOGLE_MAPS_API_KEY = saved; });

describe('project map widget', () => {
  it('runs on Google Maps, never OpenStreetMap tiles (their policy blocked us once)', () => {
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
    expect(projectMapContainerHtml('x')).toContain('data-maps-key="" id="brn-map-x"');
  });
});

describe('upgradeLegacyProjectMap', () => {
  const legacy = `<head><link rel="preconnect" href="https://unpkg.com"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>.x{}</style></head>
<body><div class="brn-map-wrap" data-brn-map-container id="brn-map"><div class="brn-map-status">Loading</div></div>
<script>
(function () {
  function loadLeaflet() { return 1; }
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {});
  fetch('/api/projects-map');
})();
</script><script>window.other = 1;</script></body>`;

  it('swaps a stored Leaflet/OSM report onto the Google Maps widget', () => {
    process.env.VITE_GOOGLE_MAPS_API_KEY = 'AIzaKey';
    const out = upgradeLegacyProjectMap(legacy);
    expect(out).not.toMatch(/openstreetmap|leaflet|unpkg/i);
    expect(out).toContain(PROJECT_MAP_HEAD);
    expect(out).toContain('maps.googleapis.com/maps/api/js');
    expect(out).toContain('data-brn-map-container data-maps-key="AIzaKey" id="brn-map"');
    expect(out).toContain('<style>.x{}</style>'); // everything else untouched
    expect(out).toContain('<script>window.other = 1;</script>');
    expect(upgradeLegacyProjectMap(out)).toBe(out); // idempotent
  });
  it('leaves a report with no map alone', () => {
    expect(upgradeLegacyProjectMap('<p>hi</p>')).toBe('<p>hi</p>');
  });
});
