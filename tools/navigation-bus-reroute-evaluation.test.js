const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
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

  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.from && call.to && 'constraints' in call));
  assert.equal(preview.selectedCandidate.candidate.id, 'A');
  assert.equal(preview.alternatives.length, 2);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.offlineRoutingAvailable, true);
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

test('liefert keinen endgueltigen Kandidaten wenn alle Wege ungeeignet sind', () => {
  const uturn = candidate('uturn', 0, 500);
  const privateRoute = candidate('private', 0, 700);
  const preview = sandbox.selectBusReroutePreview([
    { ...neutralRoute(uturn, { maneuvers: [{ type: 12 }] }), candidate: uturn },
    {
      ...neutralRoute(privateRoute, { restrictions: { accessForbidden: true } }),
      candidate: privateRoute
    }
  ]);

  assert.equal(preview.status, 'no-suitable-route');
  assert.equal(preview.selectedCandidate, null);
  assert.equal(preview.alternatives.length, 0);
  assert.equal(preview.rejectedCandidates.length, 2);
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
