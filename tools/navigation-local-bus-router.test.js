const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const routerSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-router.js'), 'utf8');
const graph = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'tools/fixtures/local-bus-routing-graph.json'),
  'utf8'
));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(routerSource, sandbox);
const routing = sandbox.LehrfahrerLocalBusRouting;

function createRouter(options = {}) {
  return routing.createRouter(structuredClone(graph), { snapRadiusM: 25, ...options });
}

const points = Object.fromEntries(graph.nodes.map(node => [node.id, { lat: node.lat, lon: node.lon }]));

test('A: etwas laengere Hauptstrasse wird vor kuerzerer Wohnstrasse bevorzugt', async () => {
  const result = await createRouter().routeBusPath({ from: points.a, to: points.d, constraints: {} });
  const edgeIds = result.roadEdges.map(edge => edge.id);

  assert.equal(result.ok, true);
  assert.ok(edgeIds.includes('main-1'));
  assert.equal(edgeIds.some(id => id.startsWith('res-')), false);
  assert.ok(result.distanceM > 207);
});

test('B: Service-Abkuerzung verliert gegen vernuenftige Hauptstrassenroute', async () => {
  const result = await createRouter().routeBusPath({ from: points.a, to: points.d, constraints: {} });
  assert.equal(result.ok, true);
  assert.equal(result.roadEdges.some(edge => edge.id === 'service-shortcut'), false);
});

test('C: Einbahnstrasse ist nur in erlaubter Richtung nutzbar', async () => {
  const router = createRouter();
  const forward = await router.routeBusPath({ from: points.ow1, to: points.ow2, constraints: {} });
  const reverse = await router.routeBusPath({ from: points.ow2, to: points.ow1, constraints: {} });

  assert.equal(forward.ok, true);
  assert.deepEqual(Array.from(forward.localPath.edgeIds), ['oneway']);
  assert.equal(reverse.ok, false);
  assert.equal(reverse.error.code, 'NO_ROUTE');
});

test('D: access- und busgesperrte Kante wird ausgeschlossen', async () => {
  const result = await createRouter().routeBusPath({ from: points.x, to: points.y, constraints: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'START_NOT_SNAPPABLE');
  assert.equal(result.geometry.length, 0);
});

test('Start und Ziel außerhalb der Routing-BBox werden sauber abgelehnt', async () => {
  const router = createRouter();
  const startOutside = await router.routeBusPath({
    from: { lat: 52, lon: 14.33 }, to: points.a, constraints: {}
  });
  const targetOutside = await router.routeBusPath({
    from: points.a, to: { lat: 52, lon: 14.33 }, constraints: {}
  });

  assert.equal(startOutside.ok, false);
  assert.equal(startOutside.error.code, 'OUTSIDE_ROUTING_REGION');
  assert.equal(targetOutside.ok, false);
  assert.equal(targetOutside.error.code, 'OUTSIDE_ROUTING_REGION');
});

test('Bus-Ausnahme ueberstimmt allgemeine Sperren; maxlength wird beachtet', async () => {
  const exceptionGraph = {
    ...structuredClone(graph),
    boundingBox: { minLat: 51.751, minLon: 14.329, maxLat: 51.753, maxLon: 14.332 },
    nodes: [
      { id: 'from', lat: 51.752, lon: 14.330 },
      { id: 'to', lat: 51.752, lon: 14.331 }
    ],
    edges: [{
      id: 'bus-exception', from: 'from', to: 'to', oneway: true,
      roadClass: 'residential', access: 'no', motorVehicle: 'no', bus: 'yes',
      lengthMeters: 70, maxlength: 10, maxheight: 4.2, maxweight: 18,
      maxwidth: 2.5, tracktype: 'grade1', lanes: 2, speedKph: 30
    }],
    turnRestrictions: []
  };
  const router = routing.createRouter(exceptionGraph, { snapRadiusM: 25 });
  const from = { lat: 51.752, lon: 14.330 };
  const to = { lat: 51.752, lon: 14.331 };
  const tooLong = await router.routeBusPath({
    from, to, constraints: { vehicleLengthM: 12 }
  });

  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error.code, 'START_NOT_SNAPPABLE');
  const allowed = await router.routeBusPath({
    from, to, constraints: { vehicleLengthM: 9, vehicleHeightM: 4 }
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.roadEdges[0].maxLengthM, 10);
  assert.equal(allowed.roadEdges[0].maxHeightM, 4.2);
  assert.equal(allowed.roadEdges[0].maxWeightT, 18);
  assert.equal(allowed.roadEdges[0].maxWidthM, 2.5);
});

test('E: Sackgasse wird verlassen ohne dieselbe Kante sofort zurueckzufahren', async () => {
  const result = await createRouter().routeBusPath({ from: points.dead, to: points.d, constraints: {} });
  const edgeIds = result.roadEdges.map(edge => edge.id);

  assert.equal(result.ok, true);
  assert.equal(edgeIds.filter(id => id === 'dead-end').length, 1);
  assert.equal(edgeIds.some((id, index) => index > 0 && id === edgeIds[index - 1]), false);
});

test('F: ohne zulaessigen Weg entsteht ein strukturierter Fehler statt Fake-Route', async () => {
  const result = await createRouter().routeBusPath({ from: points.ow2, to: points.ow1, constraints: {} });
  assert.equal(result.ok, false);
  assert.equal(result.distanceM, null);
  assert.equal(result.geometry.length, 0);
  assert.ok(result.error.code);
});

test('G: Start und Ziel nahe einer Kante werden innerhalb des Radius angebunden', async () => {
  const from = { lat: 51.75009, lon: 14.33045 };
  const to = { lat: 51.75009, lon: 14.33255 };
  const result = await createRouter({ snapRadiusM: 40 }).routeBusPath({ from, to, constraints: {} });

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.geometry[0]), [from.lat, from.lon]);
  assert.deepEqual(Array.from(result.geometry[result.geometry.length - 1]), [to.lat, to.lon]);
  assert.ok(result.localPath.startSnapDistanceM <= 40);
  assert.ok(result.localPath.targetSnapDistanceM <= 40);
});

test('H: neutrales Providerformat ist direkt mit bestehendem Evaluator kompatibel', async () => {
  const result = await createRouter().routeBusPath({ from: points.a, to: points.d, constraints: {} });
  const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
  const evaluator = {};
  vm.createContext(evaluator);
  vm.runInContext(appSource.slice(
    appSource.indexOf('function buildBusRoadClassProfile'),
    appSource.indexOf('function requestBusReroute')
  ), evaluator);
  const preview = evaluator.selectBusReroutePreview([{
    ...result,
    candidate: {
      coordinate: points.d,
      routeProgressM: 500,
      skippedStopCount: 0,
      directDistanceM: 250
    }
  }]);

  assert.equal(preview.status, 'ready');
  assert.equal(preview.selectedCandidate.source.type, 'offline-local');
  assert.equal(preview.selectedCandidate.routeGeometry.length, result.geometry.length);
});

test('echter Testgraph arbeitet hinter registriertem LocalBusRouter und routeBusPath', async () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
  const integration = { LehrfahrerLocalBusRouting: routing };
  vm.createContext(integration);
  vm.runInContext(appSource.slice(
    appSource.indexOf('function decodeBusReroutePolyline6'),
    appSource.indexOf('function requestBusReroute')
  ), integration);

  const installation = await integration.installLocalBusRoutingGraph(structuredClone(graph), { snapRadiusM: 25 });
  const result = await integration.routeBusPath({
    from: points.a,
    to: points.d,
    heading: 90,
    constraints: { vehicleHeightM: 4 }
  }, integration.resolveBusRoutingProvider());

  assert.equal(installation.ok, true);
  assert.equal(result.ok, true);
  assert.equal(result.source.id, 'local-bus-router');
  assert.ok(result.roadClassProfile.totalClassifiedM > 0);
  integration.uninstallLocalBusRoutingGraph();
});

test('LocalBusRouter enthaelt keinerlei Netzaufruf', () => {
  assert.equal(/\bfetch\s*\(/.test(routerSource), false);
  assert.equal(/XMLHttpRequest|WebSocket|https?:\/\//.test(routerSource), false);
});
