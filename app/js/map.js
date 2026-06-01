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
  const smoothing = (speedKmh != null && speedKmh < 5) ? 0.10 : ((speedKmh != null && speedKmh < 15) ? 0.18 : 0.30);
  const deadZone = (speedKmh != null && speedKmh < 5) ? 4.5 : ((speedKmh != null && speedKmh < 15) ? 2.5 : 1.2);
  const maxTurnRateDegPerSec = (speedKmh != null && speedKmh < 5) ? 12 : ((speedKmh != null && speedKmh < 15) ? 22 : 60);

  if (speedKmh != null && speedKmh < 8 && Math.abs(delta) > 120) {
    // Grobe Ausreisser im Langsamverkehr ignorieren.
    return navCameraBearing;
  }

  if (Math.abs(delta) < deadZone) {
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
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.openfreemap.org/sprites/liberty/sprite',
    sources: {
      ofm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1a1a2e' } },
      {
        id: 'water', type: 'fill', source: 'ofm',
        'source-layer': 'water',
        paint: { 'fill-color': '#162040' }
      },
      {
        id: 'landuse-green', type: 'fill', source: 'ofm',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'grass', 'park', 'forest'],
        paint: { 'fill-color': '#161e2a', 'fill-opacity': 0.6 }
      },
      {
        id: 'road-minor', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track'],
        paint: { 'line-color': '#2a2a4a', 'line-width': 1 }
      },
      {
        id: 'road-main', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'secondary', 'tertiary', 'trunk'],
        paint: {
          'line-color': '#32325a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4]
        }
      },
      {
        id: 'road-motorway', type: 'line', source: 'ofm',
        'source-layer': 'transportation',
        filter: ['==', 'class', 'motorway'],
        paint: {
          'line-color': '#3d3d72',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6]
        }
      },
      {
        id: 'building', type: 'fill', source: 'ofm',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': '#1e1e38', 'fill-outline-color': '#252550' }
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
      { id: 'background', type: 'background', paint: { 'background-color': '#1a1a2e' } },
      {
        id: 'water', type: 'fill', source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#162040' }
      },
      {
        id: 'landcover', type: 'fill', source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#161e2a', 'fill-opacity': 0.7 }
      },
      {
        id: 'road-minor', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track'],
        paint: { 'line-color': '#2a2a4a', 'line-width': 1 }
      },
      {
        id: 'road-main', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'secondary', 'tertiary', 'trunk'],
        paint: { 'line-color': '#32325a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4] }
      },
      {
        id: 'road-motorway', type: 'line', source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', 'class', 'motorway'],
        paint: { 'line-color': '#3d3d72', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6] }
      },
      {
        id: 'building', type: 'fill', source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': '#1e1e38', 'fill-outline-color': '#252550' }
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
    paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.25, 'line-blur': 3 }
  });

  // Hauptlinie
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#4a9eff', 'line-width': 4, 'line-opacity': 0.95 }
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
        el.className = 'gps-dot';
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
  // 1100ms > typisches GPS-Intervall (~1s) → Animation läuft durch bis zur nächsten Position
  // ease-in-out: sanftes Beschleunigen + Abbremsen statt linearem Ruck
  map.easeTo({ ...opts, duration: 1100, easing: t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t });
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
        // Bei langsamer Haltestellenanfahrt bewusst etwas entzerren (lesbarer, ruhiger).
        if (speedKmh != null && speedKmh < 8) {
          driverZoom = Math.min(22, baseZoom - 0.2);
          pitch = 52;
          bottomFactor = 0.26;
          topFactor = 0.09;
        } else if (speedKmh != null && speedKmh < 25) {
          driverZoom = Math.min(22, baseZoom + 0.2);
          pitch = 58;
          bottomFactor = 0.30;
          topFactor = 0.08;
        } else {
          driverZoom = Math.min(22, baseZoom + 0.45);
          pitch = 64;
          bottomFactor = 0.34;
          topFactor = 0.06;
        }

        if (profile === 'calm') {
          driverZoom = Math.max(16, driverZoom - 0.25);
          pitch = Math.max(48, pitch - 4);
          bottomFactor = Math.max(0.22, bottomFactor - 0.04);
          topFactor = Math.min(0.12, topFactor + 0.02);
        } else if (profile === 'dynamic') {
          driverZoom = Math.min(22, driverZoom + 0.25);
          pitch = Math.min(70, pitch + 4);
          bottomFactor = Math.min(0.42, bottomFactor + 0.03);
          topFactor = Math.max(0.04, topFactor - 0.01);
        }
      }

      const forwardBottom = Math.round(Math.min(460, Math.max(150, window.innerHeight * bottomFactor)));
      const forwardTop = Math.round(Math.min(80, Math.max(2, window.innerHeight * topFactor)));
      return {
        center:  [lon, lat],
        zoom:    driverZoom,
        pitch,
        bearing: headingDeg != null ? headingDeg : 0,
        padding: { top: forwardTop, bottom: forwardBottom, left: 0, right: 0 }
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
