const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
const routerSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-router.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function navGetLatLon'),
  appSource.indexOf('function buildNavStopDists')
), sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function getTurnInfo'),
  appSource.indexOf('const NAV_MANEUVER_SVG')
), sandbox);
vm.runInContext(routerSource, sandbox);

const routing = sandbox.LehrfahrerLocalBusRouting;

function pointAt(metersNorth, metersEast = 0) {
  return [51.75 + metersNorth / 111320, 14.33 + metersEast / 70000];
}

function createRoundaboutRouter(firstExit = 'blocked', reverseExit = false) {
  const routePoints = [0, 10, 20, 30, 40].map(distance => pointAt(distance));
  const graphNode = (id, point) => ({ id, lat: point[0], lon: point[1] });
  const nodes = [
    graphNode('approach', routePoints[0]),
    graphNode('entry', routePoints[1]),
    graphNode('ring-1', routePoints[2]),
    graphNode('ring-2', routePoints[3]),
    graphNode('exit', routePoints[4]),
    graphNode('side-1', pointAt(20, 40)),
    graphNode('side-reverse', pointAt(20, -40))
  ];
  const edge = (id, from, to, options = {}) => ({
    id, from, to, oneway: true, roadClass: 'residential', use: 'residential',
    access: 'yes', motorVehicle: 'yes', bus: 'yes', ...options
  });
  const edges = [
    edge('approach-edge', 'approach', 'entry'),
    edge('ring-a', 'entry', 'ring-1'),
    edge('ring-b', 'ring-1', 'ring-2'),
    edge('berliner-ausfahrt', 'ring-2', 'exit', { name: 'Berliner Straße' })
  ];
  if (firstExit === 'allowed') {
    edges.push(edge('first-ausfahrt', 'ring-1', 'side-1'));
  } else if (firstExit === 'blocked') {
    edges.push(edge('first-ausfahrt', 'ring-1', 'side-1', { bus: 'no' }));
  }
  if (reverseExit) edges.push(edge('reverse-only', 'side-reverse', 'ring-1'));
  const router = routing.createRouter({
    formatVersion: 1,
    regionId: 'test',
    graphVersion: 'test',
    boundingBox: { minLat: 51.74, minLon: 14.32, maxLat: 51.76, maxLon: 14.34 },
    nodes,
    edges,
    turnRestrictions: []
  });
  const traversals = [
    { edgeId: 'approach-edge', fromNodeId: 'approach', toNodeId: 'entry' },
    { edgeId: 'ring-a', fromNodeId: 'entry', toNodeId: 'ring-1' },
    { edgeId: 'ring-b', fromNodeId: 'ring-1', toNodeId: 'ring-2' },
    { edgeId: 'berliner-ausfahrt', fromNodeId: 'ring-2', toNodeId: 'exit', name: 'Berliner Straße' }
  ];
  return { router, routePoints, traversals };
}

function ordinaryContext(incomingName, outgoing = {}) {
  const geometry = [pointAt(0), pointAt(10), pointAt(20)];
  const nodesById = new Map([
    ['before', { id: 'before', lat: geometry[0][0], lon: geometry[0][1] }],
    ['junction', { id: 'junction', lat: geometry[1][0], lon: geometry[1][1] }],
    ['after', { id: 'after', lat: geometry[2][0], lon: geometry[2][1] }]
  ]);
  const traversals = [
    { edgeId: 'incoming', fromNodeId: 'before', toNodeId: 'junction', name: incomingName },
    { edgeId: 'outgoing', fromNodeId: 'junction', toNodeId: 'after', ...outgoing }
  ];
  return { geometry, traversals, router: { nodesById } };
}

test('Rechts- und Linksabbiegen nennen die tatsächlich folgende Straße', () => {
  const right = ordinaryContext('Hauptstraße', { name: 'Bahnhofstraße' });
  const left = ordinaryContext('Hauptstraße', { name: 'Karl-Liebknecht-Straße' });
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, right.geometry, right.traversals, right.router
  ).label, 'Rechts abbiegen in die Bahnhofstraße');
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: -90, index: 1 }, left.geometry, left.traversals, left.router
  ).label, 'Links abbiegen in die Karl-Liebknecht-Straße');
});

test('sinnvolle ref dient als Fallback; namenlose und identische Straßen bleiben neutral', () => {
  const ref = ordinaryContext('Hauptstraße', { ref: 'B 169' });
  const unnamed = ordinaryContext('Hauptstraße');
  const sameStreet = ordinaryContext('Bahnhofstraße', { name: 'Bahnhofstraße' });
  assert.match(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, ref.geometry, ref.traversals, ref.router
  ).label, /B 169/);
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, unnamed.geometry, unnamed.traversals, unnamed.router
  ).label, 'Rechts abbiegen');
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, sameStreet.geometry, sameStreet.traversals, sameStreet.router
  ), null);
});

test('Kreisverkehr zählt nur zulässige gerichtete Ausfahrten und nennt die Ausfahrtsstraße', () => {
  const first = createRoundaboutRouter('blocked', true);
  const firstTraversals = first.traversals.slice(0, 3).map(traversal =>
    traversal.edgeId === 'ring-b' ? { ...traversal, name: 'Berliner Straße' } : traversal
  );
  const firstInfo = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 2 },
    first.routePoints.slice(0, 4), firstTraversals, first.router
  );
  assert.equal(firstInfo.label, 'Im Kreisverkehr die 1. Ausfahrt Richtung Berliner Straße nehmen');

  const second = createRoundaboutRouter('allowed', true);
  const secondInfo = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 3 },
    second.routePoints, second.traversals, second.router
  );
  assert.equal(secondInfo.label, 'Im Kreisverkehr die 2. Ausfahrt Richtung Berliner Straße nehmen');
  assert.equal(second.router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'reverse-only'), false);
  assert.equal(second.router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'first-ausfahrt'), true);
});

test('gesperrte Ausfahrt wird nicht mitgezählt und unbenannte Ausfahrt bleibt neutral', () => {
  const { router, routePoints, traversals } = createRoundaboutRouter('blocked');
  const unnamedTraversals = traversals.map(traversal => ({ ...traversal, name: null, ref: null }));
  const info = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 3 },
    routePoints, unnamedTraversals, router
  );
  assert.equal(info.label, 'Im Kreisverkehr die 1. Ausfahrt nehmen');
  assert.equal(router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'first-ausfahrt'), false);
});