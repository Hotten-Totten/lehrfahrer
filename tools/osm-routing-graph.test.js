const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures/osm-routing-cases.osm');
const buildToolPath = path.join(__dirname, 'build_osm_routing_graph.py');
const routerSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-router.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(routerSource, sandbox);
const localRouting = sandbox.LehrfahrerLocalBusRouting;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-osm-graph-'));
const graphPath = path.join(temporaryDirectory, 'region-routing-graph.json');
const python = process.env.PYTHON || 'python';
const buildResult = spawnSync(python, [
  buildToolPath,
  '--input', fixturePath,
  '--output', graphPath,
  '--region-id', 'cottbus-routing-test',
  '--graph-version', 'fixture-1',
  '--bbox', '14.29,51.69,14.40,51.80'
], { encoding: 'utf8' });

assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.error?.message);
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
test.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const nodesById = new Map(graph.nodes.map(node => [String(node.id), node]));
const edgesNamed = name => graph.edges.filter(edge => edge.name === name || edge.ref === name);
const pointAt = nodeId => {
  const node = nodesById.get(String(nodeId));
  return { lat: node.lat, lon: node.lon };
};
const createRouter = () => localRouting.createRouter(structuredClone(graph), { snapRadiusM: 5 });

async function routeEdges(fromName, toName, constraints = {}) {
  const start = edgesNamed(fromName)[0];
  const target = edgesNamed(toName)[0];
  return createRouter().routeBusPath({
    from: pointAt(start.from),
    to: pointAt(target.to),
    constraints
  });
}

test('Generator erzeugt validiertes, kompaktes LocalBusRouter-v1-OSM-Graphformat', () => {
  assert.match(buildResult.stdout, /cottbus-routing-test: \d+ Nodes, \d+ gerichtete Edges/);
  assert.equal(graph.formatVersion, 1);
  assert.equal(graph.regionId, 'cottbus-routing-test');
  assert.equal(graph.graphVersion, 'fixture-1');
  assert.equal(graph.source, 'OSM');
  assert.equal(graph.sourceFormat, 'OSM XML');
  assert.equal(graph.nodeCount, graph.nodes.length);
  assert.equal(graph.edgeCount, graph.edges.length);
  assert.equal(graph.restrictionCount, graph.turnRestrictions.length);
  assert.ok(fs.statSync(graphPath).size < 30000);
  assert.ok(graph.nodes.every(node => Number.isFinite(node.lat) && Number.isFinite(node.lon)));
  assert.ok(graph.edges.every(edge =>
    nodesById.has(String(edge.from)) && nodesById.has(String(edge.to)) &&
    Number.isFinite(edge.lengthMeters) && edge.lengthMeters > 0 && edge.oneway === true
  ));
  assert.ok(graph.turnRestrictions.every(restriction =>
    graph.edges.some(edge => edge.id === restriction.fromEdgeId && edge.to === restriction.viaNodeId) &&
    graph.edges.some(edge => edge.id === restriction.toEdgeId && edge.from === restriction.viaNodeId)
  ));
  assert.equal(createRouter().isAvailable(), true);
});

test('Zweirichtungsstraße wird als zwei gerichtete Kanten ausgegeben', () => {
  const edges = edgesNamed('two-way');
  assert.equal(edges.length, 2);
  assert.equal(edges[0].from, edges[1].to);
  assert.equal(edges[0].to, edges[1].from);
});

test('oneway=yes, oneway=-1 und impliziter Roundabout sind richtig gerichtet', async () => {
  const forward = edgesNamed('oneway-yes');
  const reverse = edgesNamed('oneway-reverse');
  const roundabout = edgesNamed('roundabout');
  const oneByOne = edgesNamed('oneway-one');
  const oneByTrue = edgesNamed('oneway-true');
  const twoWay = edgesNamed('oneway-no');
  const motorway = edgesNamed('motorway-implicit');
  const explicitRoundaboutTwoWay = edgesNamed('roundabout-two-way');
  const unknownAndConditional = [
    'oneway-conditional', 'oneway-unknown', 'access-conditional'
  ];
  assert.equal(forward.length, 1);
  assert.equal(reverse.length, 1);
  assert.equal(roundabout.length, 3);
  assert.equal(oneByOne.length, 1);
  assert.equal(oneByTrue.length, 1);
  assert.equal(twoWay.length, 2);
  assert.equal(motorway.length, 1);
  assert.equal(explicitRoundaboutTwoWay.length, 6);
  assert.ok(unknownAndConditional.every(name => edgesNamed(name).length === 0));
  assert.match(buildResult.stdout, /3 Wege nicht/);
  assert.ok(roundabout.every(edge => edge.oneway === true));

  const yesRoute = await createRouter().routeBusPath({
    from: pointAt(forward[0].from), to: pointAt(forward[0].to), constraints: {}
  });
  const yesReverse = await createRouter().routeBusPath({
    from: pointAt(forward[0].to), to: pointAt(forward[0].from), constraints: {}
  });
  const reverseOsmOrder = await createRouter().routeBusPath({
    from: pointAt(reverse[0].from), to: pointAt(reverse[0].to), constraints: {}
  });
  const reverseAgainstOsmOrder = await createRouter().routeBusPath({
    from: pointAt(reverse[0].to), to: pointAt(reverse[0].from), constraints: {}
  });
  assert.equal(yesRoute.ok, true);
  assert.equal(yesReverse.ok, false);
  assert.equal(reverseOsmOrder.ok, true);
  assert.equal(reverseAgainstOsmOrder.ok, false);
});

test('harte Zugangssperren bleiben unroutebar; motor_vehicle=no mit bus=yes ist erlaubt', async () => {
  const accessNo = edgesNamed('access-no')[0];
  const busNo = edgesNamed('bus-no')[0];
  const privateRoad = edgesNamed('private')[0];
  const busException = edgesNamed('bus-exception')[0];
  const psvException = edgesNamed('psv-exception')[0];
  const vehicleException = edgesNamed('vehicle-exception')[0];
  const delivery = edgesNamed('delivery-access')[0];
  const customers = edgesNamed('customers-access')[0];
  const destination = edgesNamed('destination-access')[0];
  assert.equal(accessNo.access, 'no');
  assert.equal(busNo.bus, 'no');
  assert.equal(privateRoad.access, 'private');
  assert.equal(busException.motorVehicle, 'no');
  assert.equal(busException.bus, 'yes');
  assert.equal(psvException.bus, 'yes');
  assert.equal(delivery.access, 'delivery');
  assert.equal(customers.access, 'customers');
  assert.equal(destination.access, 'destination');
  assert.equal(vehicleException.motorVehicle, 'yes');

  for (const edge of [accessNo, busNo, privateRoad]) {
    const result = await createRouter().routeBusPath({
      from: pointAt(edge.from), to: pointAt(edge.to), constraints: {}
    });
    assert.equal(result.ok, false, edge.name);
  }
  for (const edge of [delivery, customers, destination]) {
    const limitedRoute = await createRouter().routeBusPath({
      from: pointAt(edge.from), to: pointAt(edge.to), constraints: {}
    });
    assert.equal(limitedRoute.ok, false, edge.name);
  }
  const vehicleAllowed = await createRouter().routeBusPath({
    from: pointAt(vehicleException.from), to: pointAt(vehicleException.to), constraints: {}
  });
  assert.equal(vehicleAllowed.ok, true);
  const allowedException = await createRouter().routeBusPath({
    from: pointAt(busException.from), to: pointAt(busException.to), constraints: {}
  });
  assert.equal(allowedException.ok, true);
  const allowedPsv = await createRouter().routeBusPath({
    from: pointAt(psvException.from), to: pointAt(psvException.to), constraints: {}
  });
  assert.equal(allowedPsv.ok, true);
});

test('Straßenklasse, surface, tracktype, lanes, ref, speed und Maße werden normalisiert', async () => {
  const edge = edgesNamed('R10')[0];
  assert.equal(edge.roadClass, 'secondary');
  assert.equal(edge.surface, 'asphalt');
  assert.equal(edge.tracktype, 'grade1');
  assert.equal(edge.lanes, 2);
  assert.equal(edge.ref, 'R10');
  assert.ok(Math.abs(edge.speedKph - 80.4672) < 0.001);
  assert.equal(edge.maxheight, 4.2);
  assert.equal(edge.maxweight, 18);
  assert.equal(edge.maxwidth, 2.5);
  assert.equal(edge.maxlength, 12);

  const tooLong = await routeEdges('R10', 'R10', { vehicleLengthM: 13 });
  assert.equal(tooLong.ok, false);
  const unknownHeight = edgesNamed('unknown-height')[0];
  assert.equal(unknownHeight.maxheight, null);
  const unknownAllowed = await createRouter().routeBusPath({
    from: pointAt(unknownHeight.from), to: pointAt(unknownHeight.to),
    constraints: { vehicleHeightM: 8 }
  });
  assert.equal(unknownAllowed.ok, true);
});

test('Residential und Primary bleiben unterscheidbar und der Router bevorzugt die Primary-Route', async () => {
  const residential = edgesNamed('class-residential');
  const primary = edgesNamed('class-primary');
  assert.equal(residential.length, 2);
  assert.equal(primary.length, 4);
  const result = await createRouter().routeBusPath({
    from: pointAt(residential[0].from),
    to: pointAt(residential[0].to),
    constraints: {}
  });
  assert.equal(result.ok, true);
  assert.ok(result.roadEdges.some(edge => edge.name === 'class-primary'));
  assert.equal(result.roadEdges.some(edge => edge.name === 'class-residential'), false);
});

test('Busfreigegebener Fußweg wird aufgenommen, Fußweg ohne Ausnahme ausgelassen', async () => {
  const allowed = edgesNamed('footway-bus');
  assert.equal(allowed.length, 2);
  assert.equal(edgesNamed('footway-excluded').length, 0);
  const result = await createRouter().routeBusPath({
    from: pointAt(allowed[0].from), to: pointAt(allowed[0].to), constraints: {}
  });
  assert.equal(result.ok, true);
});

test('via-node no_left_turn und only_right_turn werden vom LocalBusRouter angewendet', async () => {
  assert.equal(graph.turnRestrictions.length, 2);
  assert.ok(graph.turnRestrictions.some(item => item.type === 'no_turn' && item.restriction === 'no_left_turn'));
  assert.ok(graph.turnRestrictions.some(item => item.type === 'only_turn' && item.restriction === 'only_right_turn'));

  const forbiddenLeft = await routeEdges('from-no-left', 'left-target');
  const allowedStraight = await routeEdges('from-no-left', 'straight-no-left');
  const allowedRight = await routeEdges('from-only-right', 'right-target');
  const forbiddenStraight = await routeEdges('from-only-right', 'straight-only-right');
  assert.equal(forbiddenLeft.ok, false);
  assert.equal(allowedStraight.ok, true);
  assert.equal(allowedRight.ok, true);
  assert.equal(forbiddenStraight.ok, false);
});
