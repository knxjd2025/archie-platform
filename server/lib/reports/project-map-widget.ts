/**
 * The interactive project map, embedded directly in every report type
 * (Presentation, Proposal, Estimate, Inspection) rather than linked out to.
 *
 * Runs on the Google Maps JavaScript API with the same browser key the
 * Canvass page already ships (VITE_GOOGLE_MAPS_API_KEY — a public, referrer-
 * restricted key, so embedding it in a public report page exposes nothing
 * new). It used to be Leaflet + OpenStreetMap tiles; OSM's tile servers are
 * donated volunteer capacity with a usage policy that blocks commercial
 * sites without warning, and in Sept 2026 they blocked ours — every report
 * map turned into "you have violated the tile usage policy" squares. Google
 * is the provider we pay for, so this can't happen again.
 *
 * Marker data comes from this app's own GET /api/projects-map, which proxies
 * bestroofingnow.com's real, live project data server-to-server
 * (project-map-proxy.ts) — so this map always reflects whatever James's team
 * has published through that site's own admin backend, never a second copy
 * that can go stale.
 *
 * Clicking a pin opens the real project page on bestroofingnow.com in a new
 * tab — that site's own project pages aren't reachable via API (the map
 * endpoint returns only a thumbnail + photo count, not a full gallery), so
 * linking out is how a homeowner sees the rest of that job's photos.
 *
 * A search box filters pins by city/product/color client-side (no re-fetch —
 * the full marker set is already in the browser). Color search is real (the
 * upstream API added productColor for this), but sparse: most existing
 * projects don't have a color on file yet, so it'll surface fewer results
 * than city or product until that gets backfilled on their side.
 */

export const PROJECT_MAP_HEAD = `<link rel="preconnect" href="https://maps.googleapis.com"><link rel="preconnect" href="https://maps.gstatic.com" crossorigin>`;

/**
 * The browser key for the Maps JavaScript API. Deliberately NOT the server
 * key (GOOGLE_MAPS_API_KEY, which also unlocks Solar and Geocoding and is not
 * referrer-locked): a report page is public HTML, so only the key that is
 * already public may go into it.
 */
export function projectMapBrowserKey(): string {
  return process.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

export const PROJECT_MAP_CSS = `
.brn-map-wrap { position: relative; border-radius: var(--sc-r-lg, 12px); overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.brn-map { width: 100%; height: min(60vh, 480px); background: #e5e3dd; }
.brn-map-stats { position: absolute; top: 12px; left: 12px; z-index: 500; background: rgba(255,255,255,0.92); backdrop-filter: blur(4px); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 8px 14px; font-size: 13px; font-family: system-ui, sans-serif; color: #111; display: flex; gap: 14px; white-space: nowrap; }
.brn-map-search-wrap { position: absolute; top: 12px; right: 12px; z-index: 500; }
.brn-map-search { width: 200px; max-width: 40vw; background: rgba(255,255,255,0.95); backdrop-filter: blur(4px); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 8px 12px; font-size: 13px; font-family: system-ui, sans-serif; color: #111; }
.brn-map-search:focus { outline: 2px solid #C8102E; outline-offset: 1px; }
.brn-map-search::placeholder { color: #888; }
@media (max-width: 480px) { .brn-map-stats { top: auto; bottom: 12px; left: 12px; } .brn-map-search { width: 140px; } }
.brn-map-status { display: flex; align-items: center; justify-content: center; height: min(60vh, 480px); background: #e5e3dd; color: #555; font-family: system-ui, sans-serif; font-size: 14px; }
.brn-map-popup { max-width: 260px; font-family: system-ui, sans-serif; }
.brn-map-popup img { width: 100%; height: 110px; object-fit: cover; border-radius: 6px; margin-bottom: 8px; }
.brn-map-popup b { display: block; font-size: 14px; color: #111; margin-bottom: 2px; }
.brn-map-popup span.meta { display: block; font-size: 12px; color: #666; margin-bottom: 6px; }
.brn-map-popup a.brn-map-link { display: inline-block; margin-top: 4px; padding: 10px 14px; background: #C8102E; color: #fff; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px; } /* padding (not just font-size) sized for a real thumb tap, not just a mouse click */
`;

/** The container markup — each renderer wraps this in its own chapter/section styling. */
export function projectMapContainerHtml(idSuffix = ''): string {
  const id = `brn-map${idSuffix ? `-${idSuffix}` : ''}`;
  const key = projectMapBrowserKey().replace(/[^A-Za-z0-9_-]/g, '');
  return `<div class="brn-map-wrap" data-brn-map-container data-maps-key="${key}" id="${id}">
    <div class="brn-map-status">Loading project map&hellip;</div>
  </div>`;
}

/**
 * Mounts every [data-brn-map-container] on the page as a real Leaflet map.
 * Loads Leaflet from the same CDN the live site uses, once, even if a page
 * somehow has more than one map container (it doesn't, currently).
 */
export const PROJECT_MAP_JS = `
(function () {
  var containers = document.querySelectorAll('[data-brn-map-container]');
  if (!containers.length) return;
  var mapsKey = containers[0].getAttribute('data-maps-key') || '';

  // Loads the Maps JavaScript API once, even if a page somehow has more than
  // one map container (it doesn't, currently). Google's loader calls back by
  // global name, so the promise resolves through window.__brnGmapsReady.
  function loadGoogleMaps() {
    if (window.__brnGmapsLoading) return window.__brnGmapsLoading;
    window.__brnGmapsLoading = new Promise(function (resolve, reject) {
      if (window.google && window.google.maps && window.google.maps.Map) return resolve(window.google.maps);
      if (!mapsKey) return reject(new Error('no maps key'));
      window.__brnGmapsReady = function () { resolve(window.google.maps); };
      var script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(mapsKey) + '&loading=async&callback=__brnGmapsReady';
      script.async = true;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.__brnGmapsLoading;
  }

  function mountMap(container, markers) {
    var gm = window.google.maps;
    // Always Charlotte, never a bounding-box midpoint of every pin: the real
    // project set has a few bad-geocode outliers hundreds of miles away (see
    // the fitBounds note below), and centering on their bounding-box
    // midpoint pulled the initial view off Charlotte and toward them.
    var center = { lat: 35.2271, lng: -80.8431 };
    container.innerHTML = '';
    var mapEl = document.createElement('div');
    mapEl.className = 'brn-map';
    container.appendChild(mapEl);

    var statsEl = document.createElement('div');
    statsEl.className = 'brn-map-stats';
    container.appendChild(statsEl);

    var searchWrap = document.createElement('div');
    searchWrap.className = 'brn-map-search-wrap';
    var searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'brn-map-search';
    searchInput.placeholder = 'Search city, shingle, or color';
    searchInput.setAttribute('aria-label', 'Search projects by city, shingle, or color');
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    function updateStats(shown, total) {
      // The proxy already filters to hasPhotos-only, so every pin has photos
      // — no separate "N with photos" count needed, just shown-vs-total once
      // a search is narrowing the set.
      statsEl.innerHTML = shown === total
        ? '<span>' + total + ' projects with photos</span>'
        : '<span>' + shown + ' of ' + total + ' projects</span>';
    }
    updateStats(markers.length, markers.length);

    var map = new gm.Map(mapEl, {
      center: center,
      zoom: 11,
      minZoom: 6,
      maxZoom: 18,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      // One finger pans, pinch zooms, wheel zooms — no "use two fingers"
      // overlay in a report a rep is scrolling on a phone.
      gestureHandling: 'greedy',
    });

    var pinIcon = {
      path: gm.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: '#C8102E',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    };
    var info = new gm.InfoWindow({ maxWidth: 280 });
    var live = [];

    function renderMarkers(list) {
      live.forEach(function (mk) { mk.setMap(null); });
      live = [];
      info.close();
      list.forEach(function (m) {
        var marker = new gm.Marker({ position: { lat: m.lat, lng: m.lng }, map: map, icon: pinIcon, title: m.city + ', ' + m.state });
        var dateStr = m.completedDate ? new Date(m.completedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
        var thumb = m.thumbnail ? '<img src="' + m.thumbnail + '" alt="' + m.city + ' roofing project">' : '';
        var productLine = [m.product, m.productColor].filter(Boolean).join(' — ');
        var product = productLine ? '<span class="meta">' + productLine + '</span>' : '';
        var link = m.slug ? '<a class="brn-map-link" href="https://www.bestroofingnow.com/projects/' + m.slug + '" target="_blank" rel="noopener">See Photos &rarr;</a>' : '';
        var popup = '<div class="brn-map-popup">' + thumb + '<b>' + m.city + ', ' + m.state + '</b>' + product + '<span class="meta">' + (m.hasPhotos ? m.photoCount + ' photos' : 'No photos') + (dateStr ? ' &middot; ' + dateStr : '') + '</span>' + link + '</div>';
        marker.addListener('click', function () {
          info.setContent(popup);
          info.open({ map: map, anchor: marker });
        });
        live.push(marker);
      });
    }
    renderMarkers(markers);

    // Filters client-side against the same fields shown in each popup, so
    // "what you can search" always matches "what you can see" — no hidden
    // fields a rep could search by that a customer can't verify by reading
    // the pin they landed on. productColor is real but currently sparse
    // (most projects don't have one on file yet), so this also matches
    // product and city — a search still does something useful today even
    // though color coverage is thin.
    var searchDebounce = null;
    searchInput.addEventListener('input', function () {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        var q = searchInput.value.trim().toLowerCase();
        var filtered = !q ? markers : markers.filter(function (m) {
          return [m.city, m.state, m.product, m.productColor].some(function (f) {
            return f && String(f).toLowerCase().indexOf(q) !== -1;
          });
        });
        renderMarkers(filtered);
        updateStats(filtered.length, markers.length);
      }, 150);
    });

    // Deliberately NOT fitBounds() over every marker: the real project
    // data has a handful of far outliers (confirmed live: one 400 miles away
    // in Louisville KY, several 240+ miles away in Jacksonville NC — bad
    // geocoding on bestroofingnow.com's own project data, not something this
    // widget can or should try to clean up), and fitBounds zoomed out to fit
    // them, showing a multi-state view instead of Charlotte. The fixed
    // center+zoom above is the real default; every pin is still reachable by
    // panning and zooming out (minZoom 6 goes wide enough to find them).
  }

  Promise.all([
    loadGoogleMaps(),
    fetch('/api/projects-map').then(function (r) { if (!r.ok) throw new Error('map fetch failed'); return r.json(); }).catch(function () { return { markers: [] }; }),
  ]).then(function (results) {
    var data = results[1];
    containers.forEach(function (c) { mountMap(c, data.markers || []); });
  }).catch(function () {
    containers.forEach(function (c) { c.innerHTML = '<div class="brn-map-status">Map unavailable right now &mdash; call us and we\\'ll walk you through recent projects.</div>'; });
  });
})();
`;

/**
 * Reports are rendered once and the HTML is stored (client_reports.html), so
 * every report shared before the Google Maps switch still carries the Leaflet
 * + OpenStreetMap widget that OSM now blocks. Rewrite it on the way out:
 * swap the stylesheet link, the script, and stamp the browser key on the
 * container. Idempotent — a report that already runs on Google is untouched.
 */
const LEGACY_HEAD = /<link rel="preconnect" href="https:\/\/unpkg\.com"><link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@[\d.]+\/dist\/leaflet\.css">/g;
const LEGACY_SCRIPT = /<script>\s*\(function \(\) \{\s*function loadLeaflet\(\)[\s\S]*?\}\)\(\);\s*<\/script>/g;

export function upgradeLegacyProjectMap(html: string): string {
  if (!html.includes('tile.openstreetmap.org')) return html;
  const key = projectMapBrowserKey().replace(/[^A-Za-z0-9_-]/g, '');
  return html
    .replace(LEGACY_HEAD, PROJECT_MAP_HEAD)
    .replace(LEGACY_SCRIPT, `<script>${PROJECT_MAP_JS}</script>`)
    .replace(/data-brn-map-container(?![^>]*data-maps-key) /g, `data-brn-map-container data-maps-key="${key}" `);
}
