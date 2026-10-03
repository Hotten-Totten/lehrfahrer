const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
const mapSource = fs.readFileSync(path.resolve(__dirname, '../app/js/map.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  const BUS_REROUTE_VALHALLA_URL = 'https://valhalla.test';
  ${appSource.slice(
    appSource.indexOf('function decodeBusReroutePolyline6'),
    appSource.indexOf('function requestBusReroute')
  )}
`, sandbox);

function candidate(id, skippedStopCount, routeProgressM) {
  return {
    id,
    coordinate: { lat: 51.76 + routeProgressM / 1000000, lon: 14.33 },
    routeProgressM,
    skippedStopCount,
    nextStopId: `stop-${id}`,
    directDistanceM: 500
  };
}

function neutralRoute(candidateValue, overrides = {}) {
  return {
    ok: true,
    distanceM: 1800,
    durationSec: 300,
    geometry: [[51.76, 14.33], [candidateValue.coordinate.lat, candidateValue.coordinate.lon]],
    geometryFormat: 'lat-lon',
    roadClasses: ['primary'],
    maneuvers: [],
    roadEdges: [{ lengthM: 1800, roadClass: 'primary', use: 'road', traversability: 'both' }],
    roadMetadataStatus: 'available',
    restrictions: {},
    warnings: [],
    source: { id: 'test-provider', type: 'test', onlineRequired: false },
    ...overrides
  };
}

function provider(handler) {
  return {
    id: 'test-provider',
    type: 'test',
    onlineRequired: false,
    routeBusPath: handler
  };
}

function mapFunctionSource(name, nextName) {
  return mapSource.slice(
    mapSource.indexOf(`function ${name}`),
    mapSource.indexOf(`function ${nextName}`)
  );
}

test('Evaluator und Kandidatenrouting funktionieren providerunabhaengig', async () => {
  const returnCandidates = [candidate('A', 0, 500), candidate('B', 0, 700), candidate('C', 1, 900)];
  const calls = [];
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates
  }, provider(async request => {
    calls.push(request);
    const value = returnCandidates.find(item => item.coordinate.lat === request.to.lat);
    return neutralRoute(value);
  }));

  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.from && call.to && 'constraints' in call));
  assert.equal(preview.selectedCandidate.candidate.id, 'A');
  assert.equal(preview.alternatives.length, 1);
  assert.deepEqual(Array.from(preview.evaluatedSkippedStopGroups), [0]);
  assert.equal(preview.deferredCandidateCount, 1);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.offlineRoutingAvailable, true);
});

test('A: erreichbare H1 gewinnt auch ueber laengere Hauptstrasse gegen nahe H2', async () => {
  const h1 = candidate('H1', 0, 800);
  const h2 = candidate('H2', 1, 1000);
  const called = [];
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1, h2]
  }, provider(async request => {
    const value = request.to.lat === h1.coordinate.lat ? h1 : h2;
    called.push(value.id);
    return neutralRoute(value, {
      distanceM: value === h1 ? 3200 : 400,
      roadEdges: [{ lengthM: value === h1 ? 3200 : 400, roadClass: 'primary', use: 'road' }]
    });
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H1');
  assert.deepEqual(called, ['H1']);
});

test('B: zulaessige Residential-Route zu H1 bleibt vor Primary-Route zu H2', async () => {
  const h1 = candidate('H1', 0, 800);
  const h2 = candidate('H2', 1, 900);
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1, h2]
  }, provider(async request => {
    const value = request.to.lat === h1.coordinate.lat ? h1 : h2;
    return neutralRoute(value, {
      roadEdges: [{ lengthM: 1000, roadClass: value === h1 ? 'residential' : 'primary', use: 'road' }]
    });
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H1');
  assert.equal(preview.deferredCandidateCount, 1);
});

test('C: echtes bus=no bei H1 gibt erst dann H2 frei', async () => {
  const h1 = candidate('H1', 0, 800);
  const h2 = candidate('H2', 1, 900);
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1, h2]
  }, provider(async request => {
    const value = request.to.lat === h1.coordinate.lat ? h1 : h2;
    return neutralRoute(value, value === h1 ? { restrictions: { bus: 'no' } } : {});
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H2');
  assert.deepEqual(Array.from(preview.evaluatedSkippedStopGroups), [0, 1]);
  assert.equal(preview.rejectedCandidates[0].candidate.id, 'H1');
});

test('D: nicht routbare H1 gibt H2 frei', async () => {
  const h1 = candidate('H1', 0, 800);
  const h2 = candidate('H2', 1, 900);
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1, h2]
  }, provider(async request => {
    const value = request.to.lat === h1.coordinate.lat ? h1 : h2;
    return value === h1
      ? sandbox.createBusRoutingFailure('NO_ROUTE', 'Kein Weg', { id: 'test-provider' })
      : neutralRoute(value);
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H2');
  assert.deepEqual(Array.from(preview.evaluatedSkippedStopGroups), [0, 1]);
});

test('E: unbekannte maxheight verwirft H1 nicht', async () => {
  const h1 = candidate('H1', 0, 800);
  const h2 = candidate('H2', 1, 900);
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1, h2]
  }, provider(async request => {
    const value = request.to.lat === h1.coordinate.lat ? h1 : h2;
    return neutralRoute(value, value === h1 ? { restrictions: { maxHeightM: null } } : {});
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H1');
  assert.equal(preview.deferredCandidateCount, 1);
});

test('F: innerhalb H1 gewinnt der busgeeignetere Hauptstrassenweg', async () => {
  const h1Residential = candidate('H1-residential', 0, 800);
  const h1Primary = candidate('H1-primary', 0, 810);
  const h2 = candidate('H2', 1, 900);
  const preview = await sandbox.routeBusRerouteCandidates({
    currentPosition: { lat: 51.75, lon: 14.32 },
    returnCandidates: [h1Residential, h1Primary, h2]
  }, provider(async request => {
    const value = [h1Residential, h1Primary, h2].find(item => item.coordinate.lat === request.to.lat);
    const primary = value === h1Primary || value === h2;
    return neutralRoute(value, {
      distanceM: primary ? 1800 : 700,
      roadEdges: [{ lengthM: primary ? 1800 : 700, roadClass: primary ? 'primary' : 'residential', use: 'road' }]
    });
  }));

  assert.equal(preview.selectedCandidate.candidate.id, 'H1-primary');
  assert.equal(preview.selectedCandidate.candidate.skippedStopCount, 0);
  assert.equal(preview.deferredCandidateCount, 1);
});

test('Valhalla-Antwort wird in das neutrale Routingformat uebersetzt', () => {
  const translated = sandbox.translateValhallaBusRouteResponse({
    trip: {
      summary: { length: 1.2, time: 180, has_time_restrictions: false },
      legs: [{
        shape: '??AA',
        maneuvers: [{ type: 10, length: 0.2, time: 20, travel_type: 'bus' }]
      }]
    }
  }, {
    edges: [{
      length: 1.2,
      road_class: 'primary',
      use: 'road',
      surface: 'paved',
      traversability: 'both',
      truck_route: true
    }]
  });

  assert.equal(translated.ok, true);
  assert.equal(translated.distanceM, 1200);
  assert.equal(translated.durationSec, 180);
  assert.equal(translated.geometry.length, 2);
  assert.deepEqual(Array.from(translated.roadClasses), ['primary']);
  assert.equal(translated.roadEdges[0].lengthM, 1200);
  assert.equal(translated.source.type, 'online-development');
});

test('Provider nicht verfuegbar liefert strukturierten Fehler ohne Fake-Route', async () => {
  const result = await sandbox.routeBusPath({
    from: { lat: 51.75, lon: 14.32 },
    to: { lat: 51.76, lon: 14.33 },
    heading: null,
    constraints: {}
  }, null);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.geometry.length, 0);
  assert.equal(result.distanceM, null);
});

test('lokaler Offline-Provider nutzt spaeter dieselbe routeBusPath-Schnittstelle', async () => {
  const installed = {
    isAvailable: () => true,
    routeBusPath: async request => ({
      ...neutralRoute(candidate('local', 0, 500)),
      geometry: [[request.from.lat, request.from.lon], [request.to.lat, request.to.lon]],
      source: { id: 'local-test', type: 'offline-local', onlineRequired: false }
    })
  };
  assert.equal(sandbox.registerLocalBusRouter(installed), true);
  const selectedProvider = sandbox.resolveBusRoutingProvider();
  const result = await sandbox.routeBusPath({
    from: { lat: 51.75, lon: 14.32 },
    to: { lat: 51.76, lon: 14.33 },
    heading: 90,
    constraints: { bus: true }
  }, selectedProvider);
  const graphSpec = vm.runInContext('LOCAL_BUS_ROUTING_GRAPH_SPEC', sandbox);
  const packageSpec = vm.runInContext('BUS_OFFLINE_REGION_PACKAGE_SPEC', sandbox);

  assert.equal(result.ok, true);
  assert.equal(result.source.type, 'offline-local');
  assert.ok(Array.from(graphSpec.edges.accessData).includes('bus'));
  assert.ok(Array.from(graphSpec.edges.dimensions).includes('maxHeightM'));
  assert.ok(Array.from(packageSpec.required).includes('mapPmtiles'));
  assert.equal(sandbox.registerLocalBusRouter(null), false);
});

test('Hauptstrassenroute schlaegt kuerzere ungeeignete Nebenstrassenroute', () => {
  const main = candidate('main', 0, 600);
  const minor = candidate('minor', 0, 600);
  const preview = sandbox.selectBusReroutePreview([
    { ...neutralRoute(minor, {
      distanceM: 1200,
      durationSec: 180,
      roadEdges: [{ lengthM: 1200, roadClass: 'service_other', use: 'driveway' }]
    }), candidate: minor },
    { ...neutralRoute(main, {
      distanceM: 2000,
      durationSec: 300,
      roadEdges: [{ lengthM: 2000, roadClass: 'primary', use: 'road' }]
    }), candidate: main }
  ]);

  assert.equal(preview.selectedCandidate.candidate.id, 'main');
  assert.ok(preview.selectedCandidate.scoreBreakdown.roadSuitabilityScore >
    preview.alternatives[0].scoreBreakdown.roadSuitabilityScore);
});

test('weniger ausgelassene Haltestellen bleiben hoechste betriebliche Prioritaet', () => {
  const noSkip = candidate('no-skip', 0, 800);
  const twoSkipped = candidate('two-skipped', 2, 600);
  const preview = sandbox.selectBusReroutePreview([
    { ...neutralRoute(noSkip, {
      distanceM: 2400,
      roadEdges: [{ lengthM: 2400, roadClass: 'residential', use: 'road' }]
    }), candidate: noSkip },
    { ...neutralRoute(twoSkipped, {
      distanceM: 900,
      roadEdges: [{ lengthM: 900, roadClass: 'primary', use: 'road' }]
    }), candidate: twoSkipped }
  ]);

  assert.equal(preview.selectedCandidate.candidate.id, 'no-skip');
});

test('klar unzulaessige Route wird hart verworfen', () => {
  const forbidden = candidate('forbidden', 0, 400);
  const allowed = candidate('allowed', 1, 700);
  const preview = sandbox.selectBusReroutePreview([
    { ...neutralRoute(forbidden, {
      roadEdges: [{ lengthM: 500, roadClass: 'service_other', use: 'footway' }]
    }), candidate: forbidden },
    { ...neutralRoute(allowed), candidate: allowed }
  ]);

  assert.equal(preview.selectedCandidate.candidate.id, 'allowed');
  assert.equal(preview.rejectedCandidates.length, 1);
  assert.equal(preview.rejectedCandidates[0].candidate.id, 'forbidden');
});

test('U-Turn bleibt Penalty, ausdrueckliches Busverbot bleibt HARD reject', () => {
  const uturn = candidate('uturn', 0, 500);
  const privateRoute = candidate('private', 0, 700);
  const preview = sandbox.selectBusReroutePreview([
    { ...neutralRoute(uturn, { maneuvers: [{ type: 12 }] }), candidate: uturn },
    {
      ...neutralRoute(privateRoute, { restrictions: { accessForbidden: true } }),
      candidate: privateRoute
    }
  ]);

  assert.equal(preview.status, 'ready');
  assert.equal(preview.selectedCandidate.candidate.id, 'uturn');
  assert.equal(preview.selectedCandidate.hardViolations.length, 0);
  assert.ok(preview.selectedCandidate.scoreBreakdown.penalties.uTurns > 0);
  assert.equal(preview.rejectedCandidates.length, 1);
  assert.equal(preview.rejectedCandidates[0].candidate.id, 'private');
});

test('unbekannte Busrestriktionen sind kein hartes Verbot', () => {
  const unknown = candidate('unknown', 0, 500);
  const preview = sandbox.selectBusReroutePreview([{
    ...neutralRoute(unknown, {
      roadEdges: [{ lengthM: 800, roadClass: null, use: null }],
      restrictions: { access: 'unknown', motorVehicle: 'unknown', bus: 'unknown' }
    }),
    candidate: unknown
  }]);

  assert.equal(preview.status, 'ready');
  assert.equal(preview.selectedCandidate.candidate.id, 'unknown');
  assert.equal(preview.selectedCandidate.hardViolations.length, 0);
});

test('Routingzustaende und Meldungen bleiben unterscheidbar', () => {
  const value = candidate('state', 0, 500);
  const unavailable = sandbox.selectBusReroutePreview([{
    ...sandbox.createBusRoutingFailure('PROVIDER_UNAVAILABLE', 'offline', null),
    candidate: value
  }]);
  const providerError = sandbox.selectBusReroutePreview([{
    ...sandbox.createBusRoutingFailure('PROVIDER_ERROR', 'kaputt', { id: 'test' }),
    candidate: value
  }]);
  const noRoute = sandbox.selectBusReroutePreview([{
    ...sandbox.createBusRoutingFailure('NO_ROUTE', 'kein Weg', { id: 'test' }),
    candidate: value
  }]);

  assert.equal(unavailable.status, 'provider-unavailable');
  assert.equal(sandbox.getBusRerouteStatusMessage(unavailable), 'Für diese Region ist noch kein Offline-Routing installiert.');
  assert.equal(providerError.status, 'provider-error');
  assert.equal(sandbox.getBusRerouteStatusMessage(providerError), 'Bus-Routingprovider ist momentan nicht erreichbar.');
  assert.equal(noRoute.status, 'no-suitable-route');
  assert.equal(sandbox.getBusRerouteStatusMessage(noRoute), 'Kein geeigneter Weg für Busse gefunden.');
});

test('Diagnose enthaelt Rueckkehrpunkt, Provider, Rejects, Penalties und Gesamtwert', () => {
  const value = candidate('diag', 1, 750);
  const preview = sandbox.selectBusReroutePreview([{ ...neutralRoute(value), candidate: value }]);
  const diagnostic = preview.diagnostics[0];

  assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.returnPoint)), value.coordinate);
  assert.equal(diagnostic.provider.id, 'test-provider');
  assert.equal(diagnostic.distanceM, 1800);
  assert.deepEqual(Array.from(diagnostic.roadClasses), ['primary']);
  assert.equal(diagnostic.skippedStopCount, 1);
  assert.deepEqual(Array.from(diagnostic.hardRejectReasons), []);
  assert.equal(typeof diagnostic.penalties, 'object');
  assert.equal(typeof diagnostic.totalScore, 'number');
});

test('Routing-Preview veraendert die Originalroute nicht', async () => {
  const value = candidate('A', 0, 500);
  const preparation = {
    currentPosition: { lat: 51.75, lon: 14.32 },
    originalRoute: {
      routePoints: [[51.75, 14.32], [51.76, 14.33]],
      progressIndex: 0
    },
    returnCandidates: [value]
  };
  const before = JSON.stringify(preparation.originalRoute);
  const preview = await sandbox.routeBusRerouteCandidates(
    preparation,
    provider(async () => neutralRoute(value))
  );

  assert.equal(JSON.stringify(preparation.originalRoute), before);
  assert.equal(preview.originalRoutePreserved, true);
  assert.notStrictEqual(preview.selectedCandidate.routeGeometry, preparation.originalRoute.routePoints);
});

test('Previewzustand wird zur temporaeren Rueckwegnavigation ohne Originalrouten-Mutation', () => {
  sandbox.buildNavCumDists = points => points.map((_, index) => index * 100);
  sandbox.detectNavTurns = () => [];
  const originalRoute = {
    routePoints: [[51.75, 14.32], [51.76, 14.33]],
    progressIndex: 4,
    progressM: 400
  };
  const before = JSON.stringify(originalRoute);
  const selected = {
    ...neutralRoute(candidate('active', 2, 900)),
    candidate: { ...candidate('active', 2, 900), routeIndex: 9, nextStopName: 'Halt C' },
    routeGeometry: [[51.75, 14.32], [51.755, 14.325], [51.76, 14.33]]
  };
  const state = sandbox.buildBusRerouteNavigationState({
    originalRoute,
    preview: { selectedCandidate: selected }
  });

  assert.equal(state.geometry.length, 3);
  assert.equal(state.selectedCandidate.candidate.skippedStopCount, 2);
  assert.strictEqual(state.originalRoute, originalRoute);
  assert.equal(JSON.stringify(originalRoute), before);
});

test('Abbrechen entfernt nur die Preview, Start aktiviert den temporaeren Rueckweg', () => {
  sandbox.buildNavCumDists = points => points.map((_, index) => index * 100);
  sandbox.detectNavTurns = () => [];
  sandbox.renderUpcomingStops = () => {};
  sandbox.clearBusReroute = () => { sandbox.previewCleared = true; };
  sandbox.showBusReroute = () => { sandbox.rerouteShown = true; };
  sandbox.showToast = () => {};
  sandbox.navCumDists = [0, 1000];
  sandbox.navProgressIdx = 0;
  sandbox.navActiveBusReroute = null;
  sandbox.navPendingBusRerouteRequest = { preview: null };

  assert.equal(sandbox.cancelBusReroutePreview(), true);
  assert.equal(sandbox.previewCleared, true);
  assert.equal(sandbox.navPendingBusRerouteRequest, null);

  const selected = {
    ...neutralRoute(candidate('start', 0, 500)),
    candidate: { ...candidate('start', 0, 500), routeIndex: 5 },
    routeGeometry: [[51.75, 14.32], [51.76, 14.33]]
  };
  sandbox.navPendingBusRerouteRequest = {
    routingStatus: 'ready',
    originalRoute: { routePoints: [[1, 1], [2, 2]], progressIndex: 0, progressM: 0 },
    preview: { selectedCandidate: selected }
  };
  sandbox.navLastRawGpsPos = { lat: 51.75, lon: 14.32 };
  assert.equal(sandbox.startPreparedBusReroute(), true);
  assert.ok(sandbox.navActiveBusReroute);
  assert.equal(sandbox.navPendingBusRerouteRequest.routingStatus, 'active');
  assert.equal(sandbox.rerouteShown, true);
});

test('Wiedereinstieg braucht stabile Fixes und setzt den Originalfortschritt hinter ausgelassene Halte', () => {
  sandbox.findNearestNavIdx = (_lat, _lon, points) => points.length - 1;
  sandbox.haversineM = (lat1, lon1, lat2, lon2) => (lat1 === lat2 && lon1 === lon2 ? 0 : 100);
  let state = {
    geometry: [[51.75, 14.32], [51.76, 14.33]],
    nearestIdx: 0,
    reentryHitCount: 0
  };
  let result;
  for (let index = 0; index < 3; index++) {
    result = sandbox.advanceBusRerouteNavigationState(state, 51.76, 14.33);
    state = result.state;
  }
  assert.equal(result.reached, true);

  sandbox.clearBusReroute = () => {};
  sandbox.setConfirmedNavOffRoute = active => { sandbox.confirmedOffRoute = active; };
  sandbox.updateNavHud = (_lat, _lon, idx) => { sandbox.resumedAt = idx; };
  sandbox.showToast = () => {};
  sandbox.navProgressIdx = 4;
  sandbox.navNearestIdx = 4;
  sandbox.navLastRawGpsPos = { lat: 51.76, lon: 14.33 };
  sandbox.navPendingBusRerouteRequest = { preview: {} };
  sandbox.navActiveBusReroute = {
    selectedCandidate: { candidate: { routeIndex: 9, skippedStopCount: 2 } }
  };
  assert.equal(sandbox.finishActiveBusReroute(), true);
  assert.equal(sandbox.navProgressIdx, 9);
  assert.equal(sandbox.navNearestIdx, 9);
  assert.equal(sandbox.resumedAt, 9);
  assert.equal(sandbox.confirmedOffRoute, false);
  assert.equal(sandbox.navPendingBusRerouteRequest, null);
});

test('Kartenpreview nutzt separaten Layer und laesst die Originalroute stehen', () => {
  const showRerouteSource = mapSource.slice(
    mapSource.indexOf('function showBusReroute'),
    mapSource.indexOf('function clearBusReroute')
  );
  assert.match(showRerouteSource, /addSource\('bus-reroute'/);
  assert.doesNotMatch(showRerouteSource, /clearRoute\(\)/);
  assert.match(showRerouteSource, /fitBounds/);
  assert.match(showRerouteSource, /navBusRerouteManualCameraUntil/);
});

test('Preview und aktiver Rueckweg respektieren Pan und Pinch-Zoom mit Ruhephase', () => {
  const camera = {
    clock: 1000,
    zoom: 16,
    center: { lng: 14.33, lat: 51.76 },
    jumps: [],
    performance: { now: () => camera.clock },
    map: {
      getZoom: () => camera.zoom,
      getCenter: () => camera.center,
      getBearing: () => 0,
      jumpTo: options => camera.jumps.push(options)
    },
    document: { body: { classList: { contains: value => value === 'nav-mode' || value === 'nav-off-route' } } },
    normalizeDeg: value => (value % 360 + 360) % 360,
    shortestDegDelta: (from, to) => ((to - from + 540) % 360) - 180,
    haversineMeters: () => 0,
    updateStopPoiVisibility() {}
  };
  vm.createContext(camera);
  vm.runInContext(`
    const BUS_REROUTE_MANUAL_CAMERA_HOLD_MS = 4500;
    let navOffRouteManualCamera = false;
    let navBusRerouteCameraMode = 'preview';
    let navBusRerouteManualCameraUntil = 0;
    let navBusRerouteManualZoom = null;
    const navBusRerouteActiveGestures = new Set();
    let navCameraModeTransition = null;
    let navCameraCenter = null;
    let navCameraFollowOptions = { zoom: 16.2, bearing: 90, padding: {} };
    let navCameraSyncTs = 0;
    ${mapFunctionSource('mapCameraNow', 'beginBusRerouteMapGesture')}
    ${mapFunctionSource('beginBusRerouteMapGesture', 'endBusRerouteMapGesture')}
    ${mapFunctionSource('endBusRerouteMapGesture', 'resetBusRerouteCameraState')}
    ${mapFunctionSource('resetBusRerouteCameraState', 'setMap2DMode')}
    ${mapFunctionSource('syncNavCameraToGpsMarkerPosition', '_buildCameraOptions')}
  `, camera);

  assert.equal(camera.beginBusRerouteMapGesture('drag', { originalEvent: {} }), true);
  assert.equal(camera.beginBusRerouteMapGesture('zoom', { originalEvent: {} }), true);
  camera.syncNavCameraToGpsMarkerPosition(14.34, 51.77);
  assert.equal(camera.jumps.length, 0);

  camera.zoom = 17.4;
  camera.endBusRerouteMapGesture('drag');
  camera.endBusRerouteMapGesture('zoom');
  camera.clock = 4000;
  camera.syncNavCameraToGpsMarkerPosition(14.34, 51.77);
  assert.equal(camera.jumps.length, 0);

  camera.clock = 6000;
  camera.syncNavCameraToGpsMarkerPosition(14.34, 51.77);
  assert.equal(camera.jumps.length, 1);
  assert.equal(camera.jumps[0].zoom, 17.4);
  assert.ok(camera.jumps[0].bearing > 0);

  vm.runInContext("navBusRerouteCameraMode = 'active'", camera);
  assert.equal(camera.beginBusRerouteMapGesture('zoom', { originalEvent: {} }), true);
});

test('Rueckweg-Bearing friert bei Stillstand und Positionsjitter ein', () => {
  const bearing = {
    clock: 1000,
    performance: { now: () => bearing.clock },
    normalizeDeg: value => (value % 360 + 360) % 360,
    shortestDegDelta: (from, to) => ((to - from + 540) % 360) - 180,
    haversineMeters: () => 0,
    bearingFromCoords: () => 200
  };
  vm.createContext(bearing);
  vm.runInContext(`
    let navCameraBearing = 0;
    let navBearingReady = false;
    let navLastFix = null;
    let navLastBearingTs = 0;
    let navTurnBoostUntil = 0;
    let navTurnRecoveryActive = false;
    ${mapFunctionSource('resolveNavBearing', 'updateStopPoiVisibility')}
  `, bearing);

  assert.equal(bearing.resolveNavBearing(14.33, 51.76, 45, 10, false), 45);
  bearing.clock = 1500;
  assert.equal(bearing.resolveNavBearing(14.330001, 51.760001, 210, 0, false), 45);
});

test('Wiedereinstieg setzt ausschließlich die normale Kamera wieder frei', () => {
  const clearSource = mapFunctionSource('clearBusReroute', 'drawNavigationPath');
  assert.match(clearSource, /resetBusRerouteCameraState\(\)/);
  assert.match(appSource, /navCenterOn\(lon, lat, sensorHeading, smoothed\.speed, false\)/);
  assert.doesNotMatch(clearSource, /resetNavBearingState\(\)/);
});
