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
const BUS_HEADING_OFFSET_DEG = 0;
const GPS_MARKER_PREDICT_MAX_MS = 1200;
const GPS_MARKER_PREDICT_MAX_M = 12;
const GPS_MARKER_PREDICT_FAST_MAX_M = 31;
const GPS_MARKER_TARGET_MIN_MS = 250;
const GPS_MARKER_TARGET_MAX_MS = 2500;
const GPS_MARKER_TARGET_MAX_JUMP_M = 80;
const GPS_MARKER_TARGET_MAX_SPEED_MPS = 55;
let gpsAnimFrameId = null;
let gpsAnimState = null;
let navCameraBearing = 0;
let navBearingReady = false;
let navLastFix = null;
let navLastBearingTs = 0;
let navCameraViewState = null;
let navCameraFollowOptions = null;
let navTurnBoostUntil = 0;
let navTurnRecoveryActive = false;
let navCameraSyncTs = 0;
let navCameraCenter = null;
let map2DModeEnabled = false;

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

function isLandscapeTouchDevice() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const tabletLikeViewport = (window.innerHeight || 0) <= 700 && (window.innerWidth || 0) <= 1400;
  return isLandscape && (isCoarsePointer || tabletLikeViewport);
}

function resetNavBearingState() {
  navCameraBearing = 0;
  navBearingReady = false;
  navLastFix = null;
  navLastBearingTs = 0;
  navCameraViewState = null;
  navCameraFollowOptions = null;
  navTurnBoostUntil = 0;
  navTurnRecoveryActive = false;
  navCameraSyncTs = 0;
  navCameraCenter = null;
}

function setMap2DMode(enabled) {
  map2DModeEnabled = !!enabled;
  if (!map) return;

  const navMode = document.body.classList.contains('nav-mode');
  const perspective = (typeof getMapPerspective === 'function') ? getMapPerspective() : 'driver';
  const restoredPitch = navMode && navCameraViewState && Number.isFinite(navCameraViewState.pitch)
    ? navCameraViewState.pitch
    : (perspective === 'driver' ? 60 : 0);
  const pitch = map2DModeEnabled ? 0 : restoredPitch;

  if (navCameraFollowOptions) {
    navCameraFollowOptions = { ...navCameraFollowOptions, pitch };
  }
  map.jumpTo({ pitch });
}

function ensureGpsAnimState() {
  if (!gpsAnimState) {
    gpsAnimState = {
      currentLon: null,
      currentLat: null,
      targetLon: null,
      targetLat: null,
      finalTargetLon: null,
      finalTargetLat: null,
      targetBlendFromLon: null,
      targetBlendFromLat: null,
      targetBlendStartTs: null,
      targetBlendActive: false,
      lastNormalTargetLon: null,
      lastNormalTargetLat: null,
      lastNormalTargetTs: null,
      targetReceivedTs: null,
      predictLonPerMs: 0,
      predictLatPerMs: 0,
      predictMaxMs: 0,
      currentHeading: 0,
      targetHeading: 0,
      hasHeading: false,
      targetHeadingStable: false,
      currentSpeedMps: null,
      lastTs: 0
    };
  }
  return gpsAnimState;
}

function ensureGpsMarkerExists(lnglat) {
  if (!map) return null;
  if (!gpsMarker) {
    const el = createGpsMarkerElement();
    gpsMarker = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
      .setLngLat(lnglat)
      .addTo(map);
  }
  return gpsMarker;
}

function applyGpsHeadingVisuals(state) {
  if (!gpsMarker) return;
  if (state.hasHeading) {
    gpsMarker.setRotation(normalizeDeg(state.currentHeading));
    gpsMarker.getElement().classList.add('has-heading');
  } else {
    gpsMarker.setRotation(0);
    gpsMarker.getElement().classList.remove('has-heading');
  }
}

function stopGpsMarkerAnimation() {
  if (gpsAnimFrameId != null) {
    cancelAnimationFrame(gpsAnimFrameId);
    gpsAnimFrameId = null;
  }
}

function runGpsMarkerAnimation(ts) {
  if (!gpsMarker || !gpsAnimState) {
    gpsAnimFrameId = null;
    return;
  }

  const state = gpsAnimState;
  const dt = state.lastTs > 0 ? Math.min(120, Math.max(8, ts - state.lastTs)) : 16;
  state.lastTs = ts;

  let predictedLon = state.finalTargetLon;
  let predictedLat = state.finalTargetLat;
  if (state.predictMaxMs > 0 && state.targetReceivedTs != null) {
    const predictMs = Math.min(state.predictMaxMs, Math.max(0, ts - state.targetReceivedTs));
    predictedLon += state.predictLonPerMs * predictMs;
    predictedLat += state.predictLatPerMs * predictMs;
  }

  if (state.targetBlendActive) {
    if (state.targetBlendStartTs == null) state.targetBlendStartTs = ts;
    const blendT = Math.min(1, Math.max(0, (ts - state.targetBlendStartTs) / 64));
    const blendEase = blendT * blendT * (3 - 2 * blendT);
    state.targetLon = state.targetBlendFromLon
      + (predictedLon - state.targetBlendFromLon) * blendEase;
    state.targetLat = state.targetBlendFromLat
      + (predictedLat - state.targetBlendFromLat) * blendEase;
    if (blendT >= 1) {
      state.targetBlendActive = false;
      state.targetBlendStartTs = null;
    }
  } else {
    state.targetLon = predictedLon;
    state.targetLat = predictedLat;
  }

  let motionProfile = 'balanced';
  let turnProfile = 'balanced';
  if (typeof getMarkerMotionProfile === 'function') {
    motionProfile = getMarkerMotionProfile();
  }
  if (typeof getMarkerTurnProfile === 'function') {
    turnProfile = getMarkerTurnProfile();
  }

  const basePosTau = motionProfile === 'calm' ? 247 : (motionProfile === 'direct' ? 104.5 : 180.5);
  const speedKmh = Number.isFinite(state.currentSpeedMps) && state.currentSpeedMps >= 0
    ? state.currentSpeedMps * 3.6
    : null;
  const highSpeedFactor = speedKmh != null && speedKmh > 50
    ? 1 - Math.min(1, (speedKmh - 50) / 80) * 0.48
    : 1;
  const posTau = Math.max(90, basePosTau * highSpeedFactor);
  let turnTau = turnProfile === 'calm' ? 230 : (turnProfile === 'direct' ? 90 : 100);
  let maxTurnRate = turnProfile === 'calm' ? 120 : (turnProfile === 'direct' ? 340 : 300);

  const posAlpha = 1 - Math.exp(-dt / posTau);
  state.currentLon += (state.targetLon - state.currentLon) * posAlpha;
  state.currentLat += (state.targetLat - state.currentLat) * posAlpha;

  const headingDelta = shortestDegDelta(state.currentHeading, state.targetHeading);
  const absHeadingDelta = Math.abs(headingDelta);
  if (absHeadingDelta > 80) {
    turnTau *= 0.45;
    maxTurnRate *= 1.55;
  } else if (absHeadingDelta > 45) {
    turnTau *= 0.65;
    maxTurnRate *= 1.25;
  }
  if (state.targetHeadingStable && absHeadingDelta > 1.2) {
    turnTau *= 0.42;
    maxTurnRate = Math.max(maxTurnRate, 420);
  }
  const headingAlpha = 1 - Math.exp(-dt / turnTau);
  let headingStep = headingDelta * headingAlpha;
  const maxHeadingStep = maxTurnRate * (dt / 1000);
  if (Math.abs(headingStep) > maxHeadingStep) {
    headingStep = Math.sign(headingStep) * maxHeadingStep;
  }
  state.currentHeading = normalizeDeg(state.currentHeading + headingStep);

  gpsMarker.setLngLat([state.currentLon, state.currentLat]);
  applyGpsHeadingVisuals(state);
  syncNavCameraToGpsMarkerPosition(state.currentLon, state.currentLat);

  gpsAnimFrameId = requestAnimationFrame(runGpsMarkerAnimation);
}

function setGpsMarkerTarget(lon, lat, headingDeg = null, immediate = false, speedMps = null, predictPosition = true, headingStable = false) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const marker = ensureGpsMarkerExists([lon, lat]);
  if (!marker) return;

  const state = ensureGpsAnimState();
  const first = state.currentLon == null || state.currentLat == null;
  const targetTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  if (!first && !immediate
      && Number.isFinite(speedMps) && speedMps >= 0 && speedMps <= 0.35
      && Number.isFinite(state.finalTargetLon) && Number.isFinite(state.finalTargetLat)
      && haversineMeters(state.finalTargetLat, state.finalTargetLon, lat, lon) <= 1.2) {
    state.targetLon = state.currentLon;
    state.targetLat = state.currentLat;
    state.finalTargetLon = state.currentLon;
    state.finalTargetLat = state.currentLat;
    state.targetBlendActive = false;
    state.targetBlendStartTs = null;
    state.lastNormalTargetLon = null;
    state.lastNormalTargetLat = null;
    state.lastNormalTargetTs = null;
    state.targetReceivedTs = targetTs;
    state.predictLonPerMs = 0;
    state.predictLatPerMs = 0;
    state.predictMaxMs = 0;
    return;
  }

  if (predictPosition && !first && !immediate && state.lastNormalTargetTs != null) {
    const targetDt = targetTs - state.lastNormalTargetTs;
    const targetDistanceM = haversineMeters(
      state.lastNormalTargetLat,
      state.lastNormalTargetLon,
      lat,
      lon
    );
    if (targetDt >= GPS_MARKER_TARGET_MIN_MS
        && targetDt <= GPS_MARKER_TARGET_MAX_MS
        && targetDistanceM > 0.2
        && targetDistanceM <= GPS_MARKER_TARGET_MAX_JUMP_M
        && targetDistanceM * 1000 / targetDt <= GPS_MARKER_TARGET_MAX_SPEED_MPS) {
      const previousPredictLonPerMs = state.predictLonPerMs;
      const previousPredictLatPerMs = state.predictLatPerMs;
      state.predictLonPerMs = (lon - state.lastNormalTargetLon) / targetDt;
      state.predictLatPerMs = (lat - state.lastNormalTargetLat) / targetDt;
      const previousPredictSpeed = Math.hypot(previousPredictLonPerMs, previousPredictLatPerMs);
      const predictSpeed = Math.hypot(state.predictLonPerMs, state.predictLatPerMs);
      const directionFactor = previousPredictSpeed > 0 && predictSpeed > 0
        ? Math.max(0, Math.min(1,
          (previousPredictLonPerMs * state.predictLonPerMs
            + previousPredictLatPerMs * state.predictLatPerMs)
          / (previousPredictSpeed * predictSpeed)))
        : 1;
      const speedPredictMaxM = Number.isFinite(speedMps) && speedMps >= 0
        ? Math.max(GPS_MARKER_PREDICT_MAX_M, Math.min(GPS_MARKER_PREDICT_FAST_MAX_M, speedMps * 0.85))
        : GPS_MARKER_PREDICT_MAX_M;
      state.predictMaxMs = Math.min(
        GPS_MARKER_PREDICT_MAX_MS,
        speedPredictMaxM * targetDt / targetDistanceM
      ) * directionFactor;
    } else {
      state.predictLonPerMs = 0;
      state.predictLatPerMs = 0;
      state.predictMaxMs = 0;
    }
  } else {
    state.predictLonPerMs = 0;
    state.predictLatPerMs = 0;
    state.predictMaxMs = 0;
  }

  if (first || immediate) {
    state.lastNormalTargetLon = null;
    state.lastNormalTargetLat = null;
    state.lastNormalTargetTs = null;
  } else {
    state.lastNormalTargetLon = lon;
    state.lastNormalTargetLat = lat;
    state.lastNormalTargetTs = targetTs;
  }
  state.targetReceivedTs = targetTs;
  state.finalTargetLon = lon;
  state.finalTargetLat = lat;
  if (first || immediate) {
    state.targetLon = lon;
    state.targetLat = lat;
    state.targetBlendActive = false;
    state.targetBlendStartTs = null;
  } else {
    state.targetBlendFromLon = state.targetLon;
    state.targetBlendFromLat = state.targetLat;
    state.targetBlendStartTs = null;
    state.targetBlendActive = true;
  }
  state.hasHeading = headingDeg != null && Number.isFinite(headingDeg);
  state.targetHeading = state.hasHeading ? normalizeDeg(headingDeg + BUS_HEADING_OFFSET_DEG) : 0;
  state.targetHeadingStable = headingStable === true;
  state.currentSpeedMps = Number.isFinite(speedMps) && speedMps >= 0 ? speedMps : null;

  if (first || immediate) {
    state.currentLon = lon;
    state.currentLat = lat;
    if (state.hasHeading) {
      state.currentHeading = state.targetHeading;
    } else {
      state.currentHeading = 0;
    }
    marker.setLngLat([state.currentLon, state.currentLat]);
    applyGpsHeadingVisuals(state);
  }

  if (gpsAnimFrameId == null) {
    state.lastTs = 0;
    gpsAnimFrameId = requestAnimationFrame(runGpsMarkerAnimation);
  }
}

function resolveNavBearing(lon, lat, headingDeg, speedMps = null, headingStable = false) {
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
  const dtSec = navLastBearingTs > 0
    ? Math.min(0.35, Math.max(0.016, (nowTs - navLastBearingTs) / 1000))
    : 0.1;
  navLastBearingTs = nowTs;
  if (absDelta > 30) {
    navTurnBoostUntil = nowTs + 1100;
    navTurnRecoveryActive = true;
  }
  let smoothing = (speedKmh != null && speedKmh < 5) ? 0.15 : ((speedKmh != null && speedKmh < 15) ? 0.23 : 0.34);
  let deadZone = (speedKmh != null && speedKmh < 5) ? 3.0 : ((speedKmh != null && speedKmh < 15) ? 1.6 : 0.8);
  let maxTurnRateDegPerSec = (speedKmh != null && speedKmh < 5) ? 24 : ((speedKmh != null && speedKmh < 15) ? 50 : 95);

  if (nowTs < navTurnBoostUntil) {
    smoothing = Math.max(smoothing, 0.44);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 165);
    deadZone = Math.min(deadZone, 0.95);
  }

  if (absDelta > 45) {
    smoothing = Math.max(smoothing, 0.62);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 235);
    deadZone = Math.min(deadZone, 0.65);
  }
  if (absDelta > 80) {
    smoothing = Math.max(smoothing, 0.75);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 285);
    deadZone = Math.min(deadZone, 0.35);
  }

  if (headingStable && absDelta > 0.35) {
    smoothing = Math.max(smoothing, 0.78);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 240);
    deadZone = Math.min(deadZone, 0.28);
  }

  // Nach dem Abbiegen auf die kommende Gerade zuegig, aber weich einrasten.
  if (navTurnRecoveryActive && absDelta < 16 && (speedKmh == null || speedKmh >= 8)) {
    smoothing = Math.max(smoothing, 0.72);
    maxTurnRateDegPerSec = Math.max(maxTurnRateDegPerSec, 220);
    deadZone = Math.min(deadZone, 0.32);
    if (absDelta < 1.2) navTurnRecoveryActive = false;
  }

  if (speedKmh != null && speedKmh < 8 && absDelta > 120 && movedM < 2.5) {
    // Grobe Ausreisser im Langsamverkehr ignorieren.
    return navCameraBearing;
  }

  if (absDelta < deadZone) {
    return navCameraBearing;
  }

  const maxStep = maxTurnRateDegPerSec * dtSec;
  const referenceStepSec = 0.2;
  const timeBasedSmoothing = 1 - Math.pow(1 - smoothing, dtSec / referenceStepSec);
  const wantedStep = delta * timeBasedSmoothing;
  const step = Math.sign(wantedStep) * Math.min(Math.abs(wantedStep), maxStep);

  navCameraBearing = normalizeDeg(navCameraBearing + step);
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
    paint: { 'line-color': '#7a0b12', 'line-width': 11, 'line-opacity': 0.35, 'line-blur': 2 }
  });

  // Hauptlinie
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#e30613', 'line-width': 7, 'line-opacity': 0.98 }
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

function createGpsMarkerElement() {
  const el = document.createElement('div');
  el.className = 'gps-arrow-marker';
  el.innerHTML = [
    '<div class="gps-arrow-icon" aria-hidden="true">',
    '  <svg viewBox="0 0 56 56" focusable="false">',
    '    <ellipse cx="28" cy="46" rx="11" ry="4" class="arrow-shadow"></ellipse>',
    '    <path d="M28 5 L48 29 L35.5 29 L35.5 50 L20.5 50 L20.5 29 L8 29 Z" class="arrow-body"></path>',
    '    <path d="M28 12 L40.5 27 L32 27 L32 46 L24 46 L24 27 L15.5 27 Z" class="arrow-core"></path>',
    '    <path d="M28 8 L44.8 28 L40.3 28 L28 13.2 L15.7 28 L11.2 28 Z" class="arrow-highlight"></path>',
    '  </svg>',
    '</div>'
  ].join('');
  return el;
}

// ── GPS ──────────────────────────────────────────────────────
function startGPS(onPositionUpdate, onError, onFirstFix) {
  if (!navigator.geolocation) return false;

  stopGPS();
  let firstFixSeen = false;

  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const lnglat = [pos.coords.longitude, pos.coords.latitude];
      const navMode = document.body.classList.contains('nav-mode');
      const hdg = pos.coords.heading;
      const headingForMarker = (hdg != null && !isNaN(hdg) && (pos.coords.speed || 0) > 0.5)
        ? hdg
        : null;

      // Im Nav-Modus setzt navCenterOn() den Marker ausschliesslich auf die
      // gesnappte/tracked Position, damit kein Roh-GPS-Zielflattern entsteht.
      if (!navMode) {
        setGpsMarkerTarget(lnglat[0], lnglat[1], headingForMarker, !firstFixSeen, pos.coords.speed);
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
  stopGpsMarkerAnimation();
  gpsAnimState = null;
  resetNavBearingState();
}

function refreshMapViewport() {
  if (!map) return;
  map.resize();
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

window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    refreshMapViewport();
  }, 100);
});

// ── Nav-Modus: Karte folgt mit Richtung + Neigung (Fahrerperspektive) ────────
function navCenterOn(lon, lat, headingDeg, speedMps = null, headingStable = false) {
  if (!map) return;
  const bearing = resolveNavBearing(lon, lat, headingDeg, speedMps, headingStable);
  const opts = _buildCameraOptions(lon, lat, bearing, speedMps);
  navCameraFollowOptions = opts;
  updateStopPoiVisibility();
}

function syncNavCameraToGpsMarkerPosition(lon, lat) {
  if (!map || !navCameraFollowOptions || !document.body.classList.contains('nav-mode')) return;
  const nowTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const dt = navCameraSyncTs > 0 ? Math.min(120, Math.max(8, nowTs - navCameraSyncTs)) : 16;
  navCameraSyncTs = nowTs;
  const currentBearing = normalizeDeg(map.getBearing());
  const bearingDelta = shortestDegDelta(currentBearing, navCameraFollowOptions.bearing);
  const absBearingDelta = Math.abs(bearingDelta);
  const bearingTau = absBearingDelta > 45 ? 150 : (absBearingDelta > 15 ? 190 : 270);
  const bearingAlpha = 1 - Math.exp(-dt / bearingTau);
  const maxBearingRate = absBearingDelta > 45 ? 180 : (absBearingDelta > 15 ? 130 : 80);
  const maxBearingStep = maxBearingRate * dt / 1000;
  const wantedBearingStep = bearingDelta * bearingAlpha;
  const bearingStep = Math.sign(wantedBearingStep)
    * Math.min(Math.abs(wantedBearingStep), maxBearingStep);
  if (!navCameraCenter) navCameraCenter = { lon, lat };
  const centerDistanceM = haversineMeters(navCameraCenter.lat, navCameraCenter.lon, lat, lon);
  const maxCenterStepM = 55 * dt / 1000;
  const centerFraction = centerDistanceM > maxCenterStepM
    ? maxCenterStepM / centerDistanceM
    : 1;
  navCameraCenter.lon += (lon - navCameraCenter.lon) * centerFraction;
  navCameraCenter.lat += (lat - navCameraCenter.lat) * centerFraction;
  map.jumpTo({
    ...navCameraFollowOptions,
    center: [navCameraCenter.lon, navCameraCenter.lat],
    bearing: normalizeDeg(currentBearing + bearingStep)
  });
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

        const isLandscapeMobile = isLandscapeTouchDevice();
        if (isLandscapeMobile) {
          // Landscape: Marker weiter weg/fokussiert nach vorne (hoeher im Bild).
          driverZoom = Math.max(16, driverZoom - 0.55);
          pitch = Math.max(50, pitch - 3);
          topFactor = Math.max(0.44, topFactor - 0.08);
          bottomFactor = Math.min(0.28, bottomFactor + 0.06);
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
      const calculatedPitch = navMode ? navCameraViewState.pitch : pitch;
      const finalPitch = map2DModeEnabled ? 0 : calculatedPitch;
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
function setSimulatedGPS(lon, lat, headingDeg, speedMps = null, headingStable = false) {
  if (!map) return;
  setGpsMarkerTarget(lon, lat, headingDeg, false, speedMps, true, headingStable);
}
