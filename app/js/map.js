// =========================
// MAP MODULE – Lehrfahrer PWA
// MapLibre GL + PMTiles
// =========================

let map = null;
let stopPopups   = [];
let stopMarkers  = [];
let gpsMarker    = null;
let gpsWatchId   = null;
let pmtilesProto = null;

const DEFAULT_CENTER = [14.33, 51.76]; // Cottbus
const DEFAULT_ZOOM   = 12;

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
      },
      {
        id: 'place-label', type: 'symbol', source: 'ofm',
        'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town', 'village'],
        layout: {
          'text-field': ['coalesce', ['get', 'name:de'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13]
        },
        paint: {
          'text-color': '#b0b0d0',
          'text-halo-color': '#0f0f1a',
          'text-halo-width': 1
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
      },
      {
        id: 'place-city', type: 'symbol', source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town', 'village'],
        layout: {
          'text-field': ['get', 'name:de'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13]
        },
        paint: { 'text-color': '#b0b0d0', 'text-halo-color': '#0f0f1a', 'text-halo-width': 1 }
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
    style: 'https://tiles.openfreemap.org/styles/liberty',
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
    el.className = 'map-stop-dot';
    el.title = stop.name;

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
  });
}

function clearStops() {
  stopMarkers.forEach(m => m.remove());
  stopPopups.forEach(p => p.remove());
  stopMarkers = [];
  stopPopups  = [];
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
function navCenterOn(lon, lat, headingDeg) {
  if (!map) return;
  const opts = _buildCameraOptions(lon, lat, headingDeg);
  // 1100ms > typisches GPS-Intervall (~1s) → Animation läuft durch bis zur nächsten Position
  // ease-in-out: sanftes Beschleunigen + Abbremsen statt linearem Ruck
  map.easeTo({ ...opts, duration: 1100, easing: t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t });
}

// ── Simulation: sofortige Kartenposition (kein Animations-Stau) ──────────────
function simCenterOn(lon, lat, headingDeg) {
  if (!map) return;
  map.jumpTo(_buildCameraOptions(lon, lat, headingDeg));
}

// ── Kamera-Optionen je nach gewählter Perspektive ─────────────────────────────
function _buildCameraOptions(lon, lat, headingDeg) {
  const mode = (typeof getMapPerspective === 'function') ? getMapPerspective() : 'driver';
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
      const driverZoom = zoomEl ? parseFloat(zoomEl.value) : 21;
      return {
        center:  [lon, lat],
        zoom:    driverZoom,
        pitch:   75,
        bearing: headingDeg != null ? headingDeg : 0,
        padding: { top: 0, bottom: 80, left: 0, right: 0 }
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
