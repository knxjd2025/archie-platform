/**
 * The interactive "Our Work" map, embedded directly in every report type
 * (Presentation, Proposal, Estimate, Inspection) rather than linked out to.
 *
 * Runs on the Google Maps JavaScript API with the public browser key the
 * Canvass page already ships (VITE_GOOGLE_MAPS_API_KEY — referrer-restricted,
 * so embedding it in a public report page exposes nothing new). Not
 * OpenStreetMap tiles: OSM's tile servers are donated capacity whose usage
 * policy blocks commercial sites without warning.
 *
 * Marker data comes from this app's own GET /api/projects-map
 * (project-map-proxy.ts). Each marker may carry a `url` to that project's own
 * page; a pin links out only when it has one. The map centers on the middle
 * of the company's own pins, so it opens on its service area, wherever that is.
 *
 * A search box filters pins by city/product/color client-side (no re-fetch —
 * the full marker set is already in the browser).
 */

/**
 * Archie has no per-company project feed yet, so every report leaves the map
 * out until one is built (it will come from each company's own finished jobs).
 */
export function projectMapFeedUrl(): string | null {
  return null;
}

/** True when the current company has a project feed for the map. */
export function ourWorkMapAvailable(): boolean {
  return !!projectMapFeedUrl();
}

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
.work-map-wrap { position: relative; border-radius: var(--sc-r-lg, 12px); overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.work-map { width: 100%; height: min(60vh, 480px); background: #e5e3dd; }
.work-map-stats { position: absolute; top: 12px; left: 12px; z-index: 500; background: rgba(255,255,255,0.92); backdrop-filter: blur(4px); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 8px 14px; font-size: 13px; font-family: system-ui, sans-serif; color: #111; display: flex; gap: 14px; white-space: nowrap; }
.work-map-search-wrap { position: absolute; top: 12px; right: 12px; z-index: 500; }
.work-map-search { width: 200px; max-width: 40vw; background: rgba(255,255,255,0.95); backdrop-filter: blur(4px); border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 8px 12px; font-size: 13px; font-family: system-ui, sans-serif; color: #111; }
.work-map-search:focus { outline: 2px solid var(--brand, #1F3A5F); outline-offset: 1px; }
.work-map-search::placeholder { color: #888; }
@media (max-width: 480px) { .work-map-stats { top: auto; bottom: 12px; left: 12px; } .work-map-search { width: 140px; } }
.work-map-status { display: flex; align-items: center; justify-content: center; height: min(60vh, 480px); background: #e5e3dd; color: #555; font-family: system-ui, sans-serif; font-size: 14px; }
.work-map-popup { max-width: 260px; font-family: system-ui, sans-serif; }
.work-map-popup img { width: 100%; height: 110px; object-fit: cover; border-radius: 6px; margin-bottom: 8px; }
.work-map-popup b { display: block; font-size: 14px; color: #111; margin-bottom: 2px; }
.work-map-popup span.meta { display: block; font-size: 12px; color: #666; margin-bottom: 6px; }
.work-map-popup a.work-map-link { display: inline-block; margin-top: 4px; padding: 10px 14px; background: var(--brand, #1F3A5F); color: #fff; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px; } /* padding (not just font-size) sized for a real thumb tap, not just a mouse click */
`;

/** The container markup — each renderer wraps this in its own chapter/section styling. */
export function projectMapContainerHtml(idSuffix = ''): string {
  const id = `work-map${idSuffix ? `-${idSuffix}` : ''}`;
  const key = projectMapBrowserKey().replace(/[^A-Za-z0-9_-]/g, '');
  return `<div class="work-map-wrap" data-work-map-container data-maps-key="${key}" id="${id}">
    <div class="work-map-status">Loading project map&hellip;</div>
  </div>`;
}

/**
 * Mounts every [data-work-map-container] on the page as a Google map.
 */
export const PROJECT_MAP_JS = `
(function () {
  var containers = document.querySelectorAll('[data-work-map-container]');
  if (!containers.length) return;
  var mapsKey = containers[0].getAttribute('data-maps-key') || '';

  // Loads the Maps JavaScript API once, even if a page somehow has more than
  // one map container (it doesn't, currently). Google's loader calls back by
  // global name, so the promise resolves through window.__workMapGmapsReady.
  function loadGoogleMaps() {
    if (window.__workMapGmapsLoading) return window.__workMapGmapsLoading;
    window.__workMapGmapsLoading = new Promise(function (resolve, reject) {
      if (window.google && window.google.maps && window.google.maps.Map) return resolve(window.google.maps);
      if (!mapsKey) return reject(new Error('no maps key'));
      window.__workMapGmapsReady = function () { resolve(window.google.maps); };
      var script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(mapsKey) + '&loading=async&callback=__workMapGmapsReady';
      script.async = true;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.__workMapGmapsLoading;
  }

  function mountMap(container, markers) {
    var gm = window.google.maps;
    // The median pin, never a bounding-box midpoint: a project set can have a
    // few bad-geocode outliers hundreds of miles away (see the fitBounds note
    // below), and a midpoint would pull the view toward them.
    function median(list) { var a = list.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; }
    var center = markers.length
      ? { lat: median(markers.map(function (m) { return m.lat; })), lng: median(markers.map(function (m) { return m.lng; })) }
      : { lat: 39.8283, lng: -98.5795 };
    container.innerHTML = '';
    var mapEl = document.createElement('div');
    mapEl.className = 'work-map';
    container.appendChild(mapEl);

    var statsEl = document.createElement('div');
    statsEl.className = 'work-map-stats';
    container.appendChild(statsEl);

    var searchWrap = document.createElement('div');
    searchWrap.className = 'work-map-search-wrap';
    var searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'work-map-search';
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
      zoom: markers.length ? 11 : 4,
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

    // The company's color (brandStyleTag sets --brand on the page).
    var brandColor = (getComputedStyle(document.documentElement).getPropertyValue('--brand') || '').trim() || '#1F3A5F';
    var pinIcon = {
      path: gm.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: brandColor,
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
        var link = /^https:\/\//.test(m.url || '') ? '<a class="work-map-link" href="' + encodeURI(m.url) + '" target="_blank" rel="noopener">See Photos &rarr;</a>' : '';
        var popup = '<div class="work-map-popup">' + thumb + '<b>' + m.city + ', ' + m.state + '</b>' + product + '<span class="meta">' + (m.hasPhotos ? m.photoCount + ' photos' : 'No photos') + (dateStr ? ' &middot; ' + dateStr : '') + '</span>' + link + '</div>';
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

    // Deliberately NOT fitBounds() over every marker: real project data has
    // a handful of far outliers (bad geocodes hundreds of miles away), and
    // fitBounds zoomed out to fit them, showing a multi-state view instead of
    // the service area. The median center + fixed zoom above is the default;
    // every pin is still reachable by panning and zooming out.
  }

  Promise.all([
    loadGoogleMaps(),
    fetch('/api/projects-map').then(function (r) { if (!r.ok) throw new Error('map fetch failed'); return r.json(); }).catch(function () { return { markers: [] }; }),
  ]).then(function (results) {
    var data = results[1];
    containers.forEach(function (c) { mountMap(c, data.markers || []); });
  }).catch(function () {
    containers.forEach(function (c) { c.innerHTML = '<div class="work-map-status">Map unavailable right now &mdash; call us and we\\'ll walk you through recent projects.</div>'; });
  });
})();
`;
