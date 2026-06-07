// =========================
// MAP MODULE – Lehrfahrer PWA
// MapLibre GL + PMTiles
// =========================

let map = null;
let stopPopups   = [];
let stopMarkers  = [];
let stopMarkerMeta = [];
let gpsMarker    = null;
let gpsWatchId   = null;
let pmtilesProto = null;
let navCameraBearing = 0;
let navBearingReady = false;
let navLastFix = null;
let navLastBearingTs = 0;
let navCameraViewState = null;
let navTurnBoostUntil = 0;

const DEFAULT_CENTER = [14.33, 51.76]; // Cottbus
const DEFAULT_ZOOM   = 12;

function normalizeDeg(deg) {
  return (deg % 360 + 360) % 360;
}

function shortestDegDelta(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const f1 = lat1 * Math.PI / 180;
  const f2 = lat2 * Math.PI / 180;
  const df = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingFromCoords(lat1, lon1, lat2, lon2) {
  const f1 = lat1 * Math.PI / 180;
  const f2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const y  = Math.sin(dl) * Math.cos(f2);
  const x  = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return normalizeDeg(Math.atan2(y, x) * 180 / Math.PI);
}

function resetNavBearingState() {
  navCameraBearing = 0;
  navBearingReady = false;
  navLastFix = null;
  navLastBearingTs = 0;
  navCameraViewState = null;
  navTurnBoostUntil = 0;
}

function resolveNavBearing(lon, lat, headingDeg, speedMps = null) {
  let candidate = null;
  const nowTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const speedKmh = (speedMps != null && Number.isFinite(speedMps) && speedMps >= 0) ? speedMps * 3.6 : null;
  const movedM = navLastFix ? haversineMeters(navLastFix.lat, navLastFix.lon, lat, lon) : 0;

  // Im Stand / Schritttempo Bearing einfrieren: verhindert Rotieren im Kreis durch Sensorrauschen.
  if (speedKmh != null && speedKmh < 3 && movedM < 1.2) {
    navLastFix = { lat, lon };
    return navBearingReady ? navCameraBearing : 0;
  }

  if (headingDeg != null && Number.isFinite(headingDeg) && (speedKmh == null || speedKmh > 6)) {
    candidate = normalizeDeg(headingDeg);
  } else if (navLastFix) {
    if (movedM >= 2.5) {
      candidate = bearingFromCoords(navLastFix.lat, navLastFix.lon, lat, lon);
    }
  }

  navLastFix = { lat, lon };

  if (candidate == null) {
    return navBearingReady ? navCameraBearing : 0;
  }

  if (!navBearingReady) {
    navCameraBearing = candidate;
    navBearingReady = true;
    navLastBearingTs = nowTs;
    return navCameraBearing;
  }

  const delta = shortestDegDelta(navCameraBearing, candidate);
  const absDelta = Math.abs(delta);
  if (absDelta > 45) {
    navTurnBoostUntil = nowTs + 1800;
  }
  let smoothing = (speedKmh != null && speedKmh < 5) ? 0.10 : ((speedKmh != null && speedKmh < 15) ? 0.18 : 0.30);
  let deadZone = (speedKmh != null && speedKmh < 5) ? 4.5 : ((speedKmh != null && speedKmh < 15) ? 2.5 : 1.2);
  let maxTurnRateDegPerSec = (speedKmh != null && speedKmh < 5) ? 12 : ((speedKmh != null && speedKmh < 15) ? 22 : 60);

  if (nowTs < navTurnBoostUntil) {
    smoothing = Math.max(smoothing, 0.52);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 120);
    deadZone = Math.min(deadZone, 1.2);
  }

  // In echten Kurven schneller auf den neuen Kurs ziehen, um seitliches Nachlaufen zu vermeiden.
  if (absDelta > 35) {
    smoothing = Math.max(smoothing, 0.42);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 95);
    deadZone = Math.min(deadZone, 1.6);
  }
  if (absDelta > 70) {
    smoothing = Math.max(smoothing, 0.62);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 150);
    deadZone = Math.min(deadZone, 1.0);
  }

  if (absDelta > 95 && movedM >= 3) {
    // Bei sehr großen Richtungswechseln zügig auf den neuen Kurs aufschließen.
    navCameraBearing = normalizeDeg(navCameraBearing + delta * 0.75);
    navLastBearingTs = nowTs;
    return navCameraBearing;
  }

  if (speedKmh != null && speedKmh < 8 && absDelta > 120 && movedM < 2.5) {
    // Grobe Ausreisser im Langsamverkehr ignorieren.
    return navCameraBearing;
  }

  if (absDelta < deadZone) {
    return navCameraBearing;
  }

  const dtSec = navLastBearingTs > 0 ? Math.min(2, Math.max(0.2, (nowTs - navLastBearingTs) / 1000)) : 1;
  const maxStep = maxTurnRateDegPerSec * dtSec;
  const wantedStep = delta * smoothing;
  const step = Math.sign(wantedStep) * Math.min(Math.abs(wantedStep), maxStep);

  navCameraBearing = normalizeDeg(navCameraBearing + step);
  navLastBearingTs = nowTs;
  return navCameraBearing;
}

function updateStopPoiVisibility() {
  if (!map || !stopMarkerMeta.length) return;
  const zoom = map.getZoom();
  const navMode = document.body.classList.contains('nav-mode');

  if (!navMode && zoom < 16.8) {
    stopMarkerMeta.forEach(meta => meta.el.classList.add('label-hidden'));
    return;
  }

  if (!navMode) {
    stopMarkerMeta.forEach(meta => meta.el.classList.remove('label-hidden'));
    return;
  }

  const center = map.getCenter();
  const ranked = stopMarkerMeta
    .map(meta => ({
      meta,
      d: haversineMeters(center.lat, center.lng, meta.lat, meta.lon)
    }))
    .sort((a, b) => a.d - b.d);

  const keep = new Set(ranked.slice(0, 1).map(x => x.meta));
  stopMarkerMeta.forEach(meta => {
    if (keep.has(meta)) meta.el.classList.remove('label-hidden');
    else meta.el.classList.add('label-hidden');
  });
}

// ── Online-Vektorkachel-Style (OpenFreeMap – kostenlos, kein API-Key) ───────
function buildRasterStyle() {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      ofm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf1f7' } },
      {
        id: 'water', type: 'fill', source: 'ofm',
        'source-layer': 'water',
        paint: { 'fill-color': '#cfe0ff' }
      },
      {
        id: 'landuse-green', type: 'fill', source: 'ofm',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'grass', 'park', 'forest'],
        paint: { 'fill-color': '#e4eddc', 'fill-opacity': 0.9 }
      },
      {
        id: 'road-minor', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track'],
        paint: {
          'line-color': '#b7becd',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 16, 2.0]
        }
      },
      {
        id: 'road-main', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'secondary', 'tertiary', 'trunk', 'residential', 'unclassified', 'living_street'],
        paint: {
          'line-color': '#8b97b0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 4.8]
        }
      },
      {
        id: 'road-motorway', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['==', 'class', 'motorway'],
        paint: {
          'line-color': '#6f7ad6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 6.4]
        }
      },
      {
        id: 'building', type: 'fill', source: 'ofm',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': '#e1e5ef', 'fill-outline-color': '#c7cfde' }
      },
      {
        id: 'road-name', type: 'symbol', source: 'ofm',
        'source-layer': 'transportation_name',
        minzoom: 12,
        maxzoom: 20,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 
            12, 8,
            14, 11,
            16, 14,
            18, 16
          ],
          'text-letter-spacing': 0.05,
          'text-max-angle': 30
        },
        paint: {
          'text-color': ['interpolate', ['linear'], ['zoom'],
            12, '#1a2847',
            14, '#1a2847',
            16, '#333333'
          ],
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': ['interpolate', ['linear'], ['zoom'],
            12, 1.4,
            18, 1.2
          ],
          'text-halo-blur': 0.4,
          'text-opacity': 1
        }
      }
    ]
  };
}

// ── PMTiles Vektorkachel-Style ───────────────────────────────
function buildPMTilesStyle(pmtilesUrl) {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf1f7' } },
      {
        id: 'water', type: 'fill', source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#cfe0ff' }
      },
      {
        id: 'landcover', type: 'fill', source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#e4eddc', 'fill-opacity': 0.9 }
      },
      {
        id: 'road-minor', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track'],
        paint: {
          'line-color': '#b7becd',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 16, 2.0]
        }
      },
      {
        id: 'road-main', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'secondary', 'tertiary', 'trunk', 'residential', 'unclassified', 'living_street'],
        paint: { 'line-color': '#8b97b0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 4.8] }
      },
      {
        id: 'road-motorway', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', 'class', 'motorway'],
        paint: { 'line-color': '#6f7ad6', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 6.4] }
      },
      {
        id: 'building', type: 'fill', source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': '#e1e5ef', 'fill-outline-color': '#c7cfde' }
      },
      {
        id: 'road-name', type: 'symbol', source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 12,
        maxzoom: 20,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 
            12, 8,
            14, 11,
            16, 14,
            18, 16
          ],
          'text-letter-spacing': 0.05,
          'text-max-angle': 30
        },
        paint: {
          'text-color': ['interpolate', ['linear'], ['zoom'],
            12, '#1a2847',
            14, '#1a2847',
            16, '#333333'
          ],
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': ['interpolate', ['linear'], ['zoom'],
            12, 1.4,
            18, 1.2
          ],
          'text-halo-blur': 0.4,
          'text-opacity': 1
        }
      }
    ]
  };
}

// ── Karte initialisieren ─────────────────────────────────────
function initMap() {
  // PMTiles-Protokoll registrieren (sobald Bibliothek geladen)
  if (window.pmtiles) {
    pmtilesProto = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', (params, callback) => {
      pmtilesProto.tile(params, callback);
      return { cancel: () => {} };
    });
  }

  map = new maplibregl.Map({
    container: 'map',
    style: buildRasterStyle(),
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    maxZoom: 22,
    maxPitch: 80,
    attributionControl: { compact: true }
  });

  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    'bottom-right'
  );

  map.on('error', e => {
    console.error('[MapLibre]', e.error?.message || e);
    showToast('Karten-Fehler: ' + (e.error?.message || 'Unbekannt'));
  });

  map.on('zoomend', updateStopPoiVisibility);
  map.on('moveend', updateStopPoiVisibility);

  return map;
}

// ── Auf PMTiles-Karte umschalten ─────────────────────────────
function switchToPMTiles(pmtilesUrl) {
  if (!map) return;
  clearRoute();
  clearStops();
  map.setStyle(buildPMTilesStyle(pmtilesUrl));
}

// ── Route anzeigen ───────────────────────────────────────────
function showRoute(routePoints) {
  if (!map || !routePoints || routePoints.length < 2) return;

  let rendered = false;

  const doRender = () => {
    if (rendered) return;
    rendered = true;
    try {
      _renderRoute(routePoints);
    } catch (err) {
      console.error('[showRoute]', err);
      showToast('Route konnte nicht gezeichnet werden: ' + err.message);
    }
  };

  // Timeout-Fallback: nach 8 s trotzdem versuchen
  const timer = setTimeout(doRender, 8000);

  const waitForStyle = () => {
    if (!map.isStyleLoaded()) {
      map.once('styledata', waitForStyle);
      return;
    }
    clearTimeout(timer);
    doRender();
  };
  waitForStyle();
}

function _renderRoute(routePoints) {
  clearRoute();

  // Flexibles Format: [{lat,lon}] ODER [[lat,lon]] (wie im gespeicherten JSON)
  const coords = routePoints.map(p => {
    if (Array.isArray(p)) return [p[1], p[0]]; // [lat, lon] → [lon, lat]
    return [p.lon, p.lat];                      // {lat, lon} → [lon, lat]
  });

  if (coords.length < 2) return;

  map.addSource('route', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
  });

  // Schatten
  map.addLayer({
    id: 'route-shadow',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#16324f', 'line-width': 8, 'line-opacity': 0.35, 'line-blur': 2 }
  });

  // Hauptlinie
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#20a4ff', 'line-width': 5, 'line-opacity': 0.98 }
  });

  // Kartenausschnitt anpassen
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: { top: 60, bottom: 80, left: 20, right: 20 }, maxZoom: 16 });
}

function clearRoute() {
  ['route-line', 'route-shadow'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('route')) map.removeSource('route');
}

// ── Navigations-Pfad zum Startpunkt ────────────────────────────
function drawNavigationPath(currentPos, routeStart) {
  if (!map) return;

  // Entferne alte nav-path falls vorhanden
  if (map.getLayer('nav-path-line')) map.removeLayer('nav-path-line');
  if (map.getSource('nav-path')) map.removeSource('nav-path');

  // Erstelle GeoJSON für die Linie
  const navPath = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [currentPos.lon, currentPos.lat],  // Aktueller Standort
          [routeStart.lon, routeStart.lat]   // Route Startpunkt
        ]
      }
    }]
  };

  // Source hinzufügen
  map.addSource('nav-path', {
    type: 'geojson',
    data: navPath
  });

  // Layer für die Linie (dashed/gestrichelt, grün)
  map.addLayer({
    id: 'nav-path-line',
    type: 'line',
    source: 'nav-path',
    paint: {
      'line-color': '#4ade80',        // Grün
      'line-width': 3,
      'line-opacity': 0.8,
      'line-dasharray': [5, 5]        // Gestrichelt
    }
  });

  // Marker für aktuellen Standort (blauer Kreis)
  if (map.getLayer('current-pos-circle')) map.removeLayer('current-pos-circle');
  if (map.getSource('current-pos')) map.removeSource('current-pos');

  map.addSource('current-pos', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [currentPos.lon, currentPos.lat] }
    }
  });

  map.addLayer({
    id: 'current-pos-circle',
    type: 'circle',
    source: 'current-pos',
    paint: {
      'circle-radius': 8,
      'circle-color': '#4a9eff',      // Blau
      'circle-opacity': 0.9,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Marker für Startpunkt (oranges Quadrat/Flag)
  if (map.getLayer('route-start-marker')) map.removeLayer('route-start-marker');
  if (map.getSource('route-start')) map.removeSource('route-start');

  map.addSource('route-start', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [routeStart.lon, routeStart.lat] }
    }
  });

  map.addLayer({
    id: 'route-start-marker',
    type: 'circle',
    source: 'route-start',
    paint: {
      'circle-radius': 10,
      'circle-color': '#ff8c42',      // Orange
      'circle-opacity': 0.9,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Karte zentrieren und beide Punkte zeigen
  const bounds = new maplibregl.LngLatBounds([currentPos.lon, currentPos.lat], [routeStart.lon, routeStart.lat]);
  map.fitBounds(bounds, { padding: { top: 100, bottom: 150, left: 20, right: 20 }, maxZoom: 15 });
}

// ── Haltestellen anzeigen ────────────────────────────────────
function showStops(stops, onStopClick) {
  clearStops();

  stops.forEach((stop, i) => {
    const el = document.createElement('div');
    el.className = 'map-stop-poi';
    el.title = stop.name;

    const dot = document.createElement('span');
    dot.className = 'map-stop-dot';

    const label = document.createElement('span');
    label.className = 'map-stop-label';
    label.textContent = stop.name || `Haltestelle ${i + 1}`;

    el.appendChild(dot);
    el.appendChild(label);

    const popup = new maplibregl.Popup({ offset: 14, closeButton: false })
      .setHTML(`<strong>${stop.name}</strong>${stop.minuteFromStart > 0 ? `<br><span style="color:#4a9eff">Min. ${stop.minuteFromStart}</span>` : ''}`);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([stop.lon, stop.lat])
      .setPopup(popup)
      .addTo(map);

    el.addEventListener('click', () => {
      if (onStopClick) onStopClick(i, stop);
    });

    stopMarkers.push(marker);
    stopPopups.push(popup);
    stopMarkerMeta.push({ el, lat: stop.lat, lon: stop.lon });
  });

  updateStopPoiVisibility();
}

function clearStops() {
  stopMarkers.forEach(m => m.remove());
  stopPopups.forEach(p => p.remove());
  stopMarkers = [];
  stopPopups  = [];
  stopMarkerMeta = [];
}

// ── Auf Haltestelle fliegen ──────────────────────────────────
function flyToStop(stop) {
  if (!map) return;
  map.flyTo({ center: [stop.lon, stop.lat], zoom: 16, duration: 600 });
}

function mapGpsErrorToMessage(err) {
  if (!err) return 'Unbekannter GPS-Fehler.';
  switch (err.code) {
    case 1:
      return 'Standortzugriff wurde blockiert. Bitte Standort in Safari/iOS erlauben.';
    case 2:
      return 'Standort momentan nicht verfuegbar. Bitte GPS/WLAN pruefen.';
    case 3:
      return 'Zeitueberschreitung beim Warten auf GPS-Fix.';
    default:
      return err.message || 'Unbekannter GPS-Fehler.';
  }
}

// ── GPS ──────────────────────────────────────────────────────
function startGPS(onPositionUpdate, onError, onFirstFix) {
  if (!navigator.geolocation) return false;

  stopGPS();
  let firstFixSeen = false;

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const lnglat = [pos.coords.longitude, pos.coords.latitude];

      if (!gpsMarker) {
        const el = document.createElement('div');
        el.className = 'gps-bus';
        gpsMarker = new maplibregl.Marker({ element: el })
          .setLngLat(lnglat)
          .addTo(map);
      } else {
        gpsMarker.setLngLat(lnglat);
      }

      // Fahrtrichtung anzeigen (wenn Heading vorhanden und Tempo > 0,5 m/s)
      const hdg = pos.coords.heading;
      if (hdg != null && !isNaN(hdg) && (pos.coords.speed || 0) > 0.5) {
        gpsMarker.setRotation(hdg);
        gpsMarker.getElement().classList.add('has-heading');
      } else {
        gpsMarker.getElement().classList.remove('has-heading');
      }

      if (!firstFixSeen) {
        firstFixSeen = true;
        if (onFirstFix) onFirstFix(pos);
      }

      if (onPositionUpdate) onPositionUpdate(pos);
    },
    err => {
      const msg = mapGpsErrorToMessage(err);
      console.warn('GPS-Fehler:', msg, err);
      if (onError) onError(err, msg);
      else if (typeof showToast === 'function') showToast(msg, 6000);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );

  return true;
}

function stopGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsMarker) {
    gpsMarker.remove();
    gpsMarker = null;
  }
  resetNavBearingState();
}

function flyToUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    map.flyTo({
      center: [pos.coords.longitude, pos.coords.latitude],
      zoom: 15,
      duration: 800
    });
  }, err => {
    const msg = mapGpsErrorToMessage(err);
    if (typeof showToast === 'function') showToast(msg, 6000);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 });
}

// ── Nav-Modus: Karte folgt mit Richtung + Neigung (Fahrerperspektive) ────────
function navCenterOn(lon, lat, headingDeg, speedMps = null) {
  if (!map) return;
  const bearing = resolveNavBearing(lon, lat, headingDeg, speedMps);
  const opts = _buildCameraOptions(lon, lat, bearing, speedMps);
  const speedKmh = (speedMps != null && Number.isFinite(speedMps) && speedMps >= 0) ? speedMps * 3.6 : null;
  const mapBearing = normalizeDeg(map.getBearing());
  const turnDelta = Math.abs(shortestDegDelta(mapBearing, bearing));

  let duration = 820;
  if (turnDelta > 70) duration = 520;
  else if (turnDelta > 35) duration = 650;
  else if (speedKmh != null && speedKmh < 8) duration = 920;

  // Laufende Animation stoppen, damit nach Kurven kein seitliches Nachziehen stehen bleibt.
  map.stop();
  map.easeTo({ ...opts, duration, easing: t => t * (2 - t) });
  updateStopPoiVisibility();
}

// ── Simulation: sofortige Kartenposition (kein Animations-Stau) ──────────────
function simCenterOn(lon, lat, headingDeg, speedMps = null) {
  if (!map) return;
  const bearing = (headingDeg != null && Number.isFinite(headingDeg))
    ? normalizeDeg(headingDeg)
    : resolveNavBearing(lon, lat, headingDeg, speedMps);
  map.jumpTo(_buildCameraOptions(lon, lat, bearing, speedMps));
  updateStopPoiVisibility();
}

// ── Kamera-Optionen je nach gewählter Perspektive ─────────────────────────────
function _buildCameraOptions(lon, lat, headingDeg, speedMps = null) {
  const perspective = (typeof getMapPerspective === 'function') ? getMapPerspective() : 'driver';
  const profile = (typeof getCameraProfile === 'function') ? getCameraProfile() : 'balanced';
  const mode = document.body.classList.contains('nav-mode') ? 'driver' : perspective;
  switch (mode) {
    case 'follow':
      return {
        center:  [lon, lat],
        zoom:    17,
        pitch:   0,
        bearing: headingDeg != null ? headingDeg : 0,
        padding: { top: 60, bottom: 60, left: 0, right: 0 }
      };
    case 'north':
      return {
        center:  [lon, lat],
        zoom:    16,
        pitch:   0,
        bearing: 0
      };
    case 'driver':
    default: {
      const zoomEl = document.getElementById('driverZoomSelect');
      const baseZoom = zoomEl ? parseFloat(zoomEl.value) : 21;
      const navMode = document.body.classList.contains('nav-mode');

      const speedKmh = (speedMps != null && Number.isFinite(speedMps) && speedMps >= 0)
        ? speedMps * 3.6
        : null;

      let driverZoom = baseZoom;
      let pitch = 60;
      let bottomFactor = 0.30;
      let topFactor = 0.08;

      if (navMode) {
        // Ultra-Cockpit: je schneller, desto weiter nach vorne sehen.
        // Für niedrige Fahrzeug-Position muss top-padding deutlich größer als bottom-padding sein.
        if (speedKmh != null && speedKmh < 8) {
          driverZoom = Math.min(22, baseZoom - 0.2);
          pitch = 52;
          topFactor = 0.54;
          bottomFactor = 0.18;
        } else if (speedKmh != null && speedKmh < 25) {
          driverZoom = Math.min(22, baseZoom + 0.2);
          pitch = 58;
          topFactor = 0.57;
          bottomFactor = 0.16;
        } else {
          driverZoom = Math.min(22, baseZoom + 0.45);
          pitch = 64;
          topFactor = 0.60;
          bottomFactor = 0.14;
        }

        if (profile === 'calm') {
          driverZoom = Math.max(16, driverZoom - 0.25);
          pitch = Math.max(48, pitch - 4);
          topFactor = Math.max(0.48, topFactor - 0.03);
          bottomFactor = Math.min(0.24, bottomFactor + 0.02);
        } else if (profile === 'dynamic') {
          driverZoom = Math.min(22, driverZoom + 0.25);
          pitch = Math.min(70, pitch + 4);
          topFactor = Math.min(0.66, topFactor + 0.03);
          bottomFactor = Math.max(0.10, bottomFactor - 0.02);
        }
      }

      const vh = Math.max(320, window.innerHeight || 0);
      const forwardTop = navMode
        ? Math.round(Math.min(520, Math.max(140, vh * topFactor)))
        : Math.round(Math.min(120, Math.max(20, vh * topFactor)));
      const forwardBottom = navMode
        ? Math.round(Math.min(220, Math.max(55, vh * bottomFactor)))
        : Math.round(Math.min(360, Math.max(100, vh * bottomFactor)));

      if (navMode) {
        const alpha = 0.26;
        if (!navCameraViewState) {
          navCameraViewState = {
            zoom: driverZoom,
            pitch,
            top: forwardTop,
            bottom: forwardBottom
          };
        } else {
          navCameraViewState.zoom += (driverZoom - navCameraViewState.zoom) * alpha;
          navCameraViewState.pitch += (pitch - navCameraViewState.pitch) * alpha;
          navCameraViewState.top += (forwardTop - navCameraViewState.top) * alpha;
          navCameraViewState.bottom += (forwardBottom - navCameraViewState.bottom) * alpha;
        }
      } else {
        navCameraViewState = null;
      }

      const finalZoom = navMode ? navCameraViewState.zoom : driverZoom;
      const finalPitch = navMode ? navCameraViewState.pitch : pitch;
      const finalTop = navMode ? Math.round(navCameraViewState.top) : forwardTop;
      const finalBottom = navMode ? Math.round(navCameraViewState.bottom) : forwardBottom;
      return {
        center:  [lon, lat],
        zoom:    finalZoom,
        pitch:   finalPitch,
        bearing: headingDeg != null ? headingDeg : 0,
        padding: { top: finalTop, bottom: finalBottom, left: 0, right: 0 }
      };
    }
  }
}

// ── Simulierten GPS-Punkt setzen (ohne echtes Geolocation) ───
function setSimulatedGPS(lon, lat, headingDeg) {
  if (!map) return;
  const lnglat = [lon, lat];
  if (!gpsMarker) {
    const el = document.createElement('div');
    el.className = 'gps-dot';
    gpsMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat(lnglat)
      .addTo(map);
  } else {
    gpsMarker.setLngLat(lnglat);
  }
  if (headingDeg != null) {
    gpsMarker.setRotation(headingDeg);
    gpsMarker.getElement().classList.add('has-heading');
  }
}
