const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const graphPath = path.resolve(__dirname, 'output/cottbus-routing-graph.json');
const regionalGraphPath = path.resolve(__dirname, 'output/cottbus-kolkwitz-routing-graph.json');
const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
const routerSource = fs.readFileSync(path.resolve(__dirname, '../app/js/local-bus-router.js'), 'utf8');
const appSandbox = {};
vm.createContext(appSandbox);
vm.runInContext(`
  const BUS_REROUTE_VALHALLA_URL = 'https://valhalla.test';
  ${appSource.slice(
    appSource.indexOf('function decodeBusReroutePolyline6'),
    appSource.indexOf('function requestBusReroute')
  )}
`, appSandbox);

function haversineM(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeDistanceAtNearestPoint(routePoints, stop) {
  let distanceM = 0;
  let best = { directDistanceM: Infinity, routeDistanceM: 0 };
  routePoints.forEach((point, index) => {
    if (index > 0) {
      distanceM += haversineM(
        { lat: routePoints[index - 1][0], lon: routePoints[index - 1][1] },
        { lat: point[0], lon: point[1] }
      );
    }
    const directDistanceM = haversineM(
      { lat: point[0], lon: point[1] },
      { lat: stop.lat, lon: stop.lon }
    );
    if (directDistanceM < best.directDistanceM) best = { directDistanceM, routeDistanceM: distanceM };
  });
  return Math.round(best.routeDistanceM);
}

function findStop(route, name) {
  const stop = route.stops.find(item => item.name === name);
  assert.ok(stop, `Haltestelle ${name} fehlt in ${route.routeName}`);
  return stop;
}

class DistanceHeap {
  constructor() { this.items = []; }
  push(item) {
    let index = this.items.push(item) - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].distanceM <= item.distanceM) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.items.length) break;
      const child = left + 1 < this.items.length &&
        this.items[left + 1].distanceM < this.items[left].distanceM ? left + 1 : left;
      if (this.items[child].distanceM >= last.distanceM) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return first;
  }
  get length() { return this.items.length; }
}

function shortestLegalBusPath(router, from, to) {
  const starts = router._snapCandidates(from, 'start', {});
  const targets = router._snapCandidates(to, 'target', {});
  const targetsByNode = new Map();
  targets.forEach(target => {
    if (!targetsByNode.has(target.nodeId)) targetsByNode.set(target.nodeId, []);
    targetsByNode.get(target.nodeId).push(target);
  });
  const heap = new DistanceHeap();
  const best = new Map();
  const stateByKey = new Map();
  const previous = new Map();
  starts.forEach((start, index) => {
    const arc = start.connectorArc || null;
    const key = `${start.nodeId}|${arc ? `${arc.edge.id}:${arc.reverse}` : `start:${index}`}`;
    best.set(key, start.connectorDistanceM);
    stateByKey.set(key, { nodeId: start.nodeId, previousArc: arc, startIndex: index });
    heap.push({ key, distanceM: start.connectorDistanceM });
  });

  let winner = null;
  while (heap.length) {
    const current = heap.pop();
    if (current.distanceM !== best.get(current.key)) continue;
    const state = stateByKey.get(current.key);
    for (const target of targetsByNode.get(state.nodeId) || []) {
      if (!router._turnAllowed(state.previousArc, target.connectorArc || null, state.nodeId)) continue;
      const distanceM = current.distanceM + target.connectorDistanceM;
      if (!winner || distanceM < winner.distanceM) {
        winner = { key: current.key, distanceM, target, startIndex: state.startIndex };
      }
    }
    if (winner && current.distanceM >= winner.distanceM) break;
    for (const arc of router._eligibleArcs(router.adjacency.get(state.nodeId), {})) {
      if (!router._turnAllowed(state.previousArc, arc, state.nodeId)) continue;
      const distanceM = current.distanceM + arc.edge.lengthM;
      const key = `${arc.to}|${arc.edge.id}:${arc.reverse}`;
      if (distanceM >= (best.get(key) ?? Infinity)) continue;
      best.set(key, distanceM);
      stateByKey.set(key, { nodeId: arc.to, previousArc: arc, startIndex: state.startIndex });
      previous.set(key, { key: current.key, arc });
      heap.push({ key, distanceM });
    }
  }

  assert.ok(winner, 'Kein legaler Busweg im Graph gefunden');
  const arcs = [];
  for (let key = winner.key; previous.has(key);) {
    const step = previous.get(key);
    arcs.push(step.arc);
    key = step.key;
  }
  arcs.reverse();
  const fallbackSpeedKph = {
    motorway: 80, trunk: 70, primary: 60, secondary: 50, tertiary: 45,
    unclassified: 35, residential: 28, living_street: 12, service: 15,
    service_other: 15, track: 10, path: 8, pedestrian: 8, cycleway: 8,
    footway: 6, steps: 4, unknown: 20
  };
  const durationSec = starts[winner.startIndex].connectorDurationSec +
    arcs.reduce((sum, arc) => sum + arc.edge.lengthM /
      ((arc.edge.speedKph || fallbackSpeedKph[arc.edge.roadClass] || 20) / 3.6), 0) +
    winner.target.connectorDurationSec;
  return {
    distanceM: Math.round(winner.distanceM),
    durationSec: Math.round(durationSec),
    edgeIds: arcs.map(arc => arc.edge.id),
    startSnapDistanceM: Math.round(starts[winner.startIndex].snapDistanceM),
    targetSnapDistanceM: Math.round(winner.target.snapDistanceM)
  };
}

test('reale Cottbus-Faelle liefern vollstaendige 0-/1-Skip-Vergleichsdaten', {
  skip: !fs.existsSync(graphPath) && 'Lokaler Cottbus-Routinggraph fehlt.'
}, async () => {
  const routerSandbox = {};
  vm.createContext(routerSandbox);
  vm.runInContext(routerSource, routerSandbox);
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const router = routerSandbox.LehrfahrerLocalBusRouting.createRouter(graph, { snapRadiusM: 220 });
  const cases = [
    {
      name: 'Linie 10 Innenstadt',
      routeFile: 'backup_liniendaten/linien/cottbus/Linie_10/Linie_10_Route_01_Hauptbahnhof_____Schloss_Branitz.json',
      currentPosition: { lat: 51.7576, lon: 14.3371 },
      zeroStopName: 'Stadtmuseum',
      oneStopName: 'Stadtpromenade',
      expected: {
        zeroDistanceM: 852, oneDistanceM: 387, zeroDurationSec: 76, oneDurationSec: 35,
        distanceRule: 'A'
      }
    },
    {
      name: 'Linie 16 Bahnhofsumfeld',
      routeFile: 'backup_liniendaten/linien/cottbus/Linie_16/Linie_16_Route_01_Wochenende_Stadthalle_Puschkinpromenade_____Gallinchen_Center.json',
      currentPosition: { lat: 51.7515, lon: 14.33 },
      zeroStopName: 'Ausbesserungswerk',
      oneStopName: 'Spreewaldbahnhof',
      expected: {
        zeroDistanceM: 1379, oneDistanceM: 898, zeroDurationSec: 130, oneDurationSec: 95,
        distanceRule: 'B'
      }
    },
    {
      name: 'Linie 16 BTU',
      routeFile: 'backup_liniendaten/linien/cottbus/Linie_16/Linie_16_Route_01_Wochenende_Stadthalle_Puschkinpromenade_____Gallinchen_Center.json',
      currentPosition: { lat: 51.766, lon: 14.321 },
      zeroStopName: 'Stadtverwaltung',
      oneStopName: 'BTU/Mensa',
      expected: {
        zeroDistanceM: 951, oneDistanceM: 373, zeroDurationSec: 72, oneDurationSec: 28,
        distanceRule: 'A'
      }
    }
  ];
  const diagnostics = [];

  for (const scenario of cases) {
    const route = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../${scenario.routeFile}`), 'utf8'));
    const zeroStop = findStop(route, scenario.zeroStopName);
    const oneStop = findStop(route, scenario.oneStopName);
    const zeroRouteDistanceM = routeDistanceAtNearestPoint(route.routePoints, zeroStop);
    const oneRouteDistanceM = routeDistanceAtNearestPoint(route.routePoints, oneStop);
    const zeroCandidate = {
      id: `${scenario.name}-0`,
      coordinate: { lat: zeroStop.lat, lon: zeroStop.lon },
      routeProgressM: zeroRouteDistanceM,
      skippedStopCount: 0,
      skippedStops: [],
      nextStopName: zeroStop.name,
      directDistanceM: Math.round(haversineM(scenario.currentPosition, zeroStop))
    };
    const oneCandidate = {
      id: `${scenario.name}-1`,
      coordinate: { lat: oneStop.lat, lon: oneStop.lon },
      routeProgressM: oneRouteDistanceM,
      skippedStopCount: 1,
      skippedStops: [{ id: zeroStop.id, name: zeroStop.name, routeDistanceM: zeroRouteDistanceM }],
      nextStopName: oneStop.name,
      directDistanceM: Math.round(haversineM(scenario.currentPosition, oneStop))
    };
    const [zeroRoute, oneRoute] = await Promise.all([
      router.routeBusPath({ from: scenario.currentPosition, to: zeroCandidate.coordinate, constraints: {} }),
      router.routeBusPath({ from: scenario.currentPosition, to: oneCandidate.coordinate, constraints: {} })
    ]);
    assert.equal(zeroRoute.ok, true, `${scenario.name}: 0-Skip nicht routbar`);
    assert.equal(oneRoute.ok, true, `${scenario.name}: 1-Skip nicht routbar`);

    const preview = appSandbox.selectBusReroutePreview([
      { ...zeroRoute, candidate: zeroCandidate },
      { ...oneRoute, candidate: oneCandidate }
    ]);
    const comparison = preview.comparisonDiagnostic;
    assert.equal(preview.selectedCandidate.candidate.skippedStopCount, 1);
    assert.equal(preview.selectedCandidate.candidate.skippedStops.length, 1);
    assert.equal(preview.selectedCandidate.candidate.skippedStops[0].name, scenario.zeroStopName);
    assert.equal(preview.decisionReason, 'SKIP_CLEARLY_BETTER');
    assert.equal(preview.decisionDiagnostics.distanceRule, scenario.expected.distanceRule);
    assert.equal(preview.decisionDiagnostics.warningComparison.additionalSevereWarning, false);
    assert.equal(preview.decisionDiagnostics.legalComparison.worseBusAccess, false);
    assert.equal(preview.decisionDiagnostics.legalComparison.additionalServiceRoad, false);
    assert.equal(comparison.zeroSkip.distanceM, scenario.expected.zeroDistanceM);
    assert.equal(comparison.oneSkip.distanceM, scenario.expected.oneDistanceM);
    assert.equal(comparison.zeroSkip.durationSec, scenario.expected.zeroDurationSec);
    assert.equal(comparison.oneSkip.durationSec, scenario.expected.oneDurationSec);
    assert.deepEqual(
      comparison.oneSkip.skippedStops.map(stop => stop.name),
      [scenario.zeroStopName]
    );
    assert.ok(comparison.difference.distanceSavingM > 0);
    assert.ok(comparison.difference.durationSavingSec > 0);
    assert.equal(typeof comparison.zeroSkip.roadQuality.mainRoadRatio, 'number');
    assert.equal(typeof comparison.oneSkip.roadQuality.mainRoadRatio, 'number');
    assert.equal(typeof comparison.zeroSkip.maneuvers.sharpTurnCount, 'number');
    assert.equal(typeof comparison.oneSkip.totalScore, 'number');
    diagnostics.push({
      name: scenario.name,
      decisionReason: preview.decisionReason,
      decision: preview.decisionDiagnostics,
      ...comparison
    });
  }

  if (process.env.LEHRFAHRER_REROUTE_DIAGNOSTICS === '1') {
    console.log(JSON.stringify(diagnostics, null, 2));
  }
});

test('Linie 15 Bahnhofsumfeld dokumentiert legalen Weg und Restriction-Umweg', {
  skip: !fs.existsSync(regionalGraphPath) && 'Lokaler Cottbus-Kolkwitz-Routinggraph fehlt.'
}, async () => {
  const routerSandbox = {};
  vm.createContext(routerSandbox);
  vm.runInContext(routerSource, routerSandbox);
  const graph = JSON.parse(fs.readFileSync(regionalGraphPath, 'utf8'));
  const from = { lat: 51.747, lon: 14.318 };
  const hauptbahnhof = { lat: 51.750201, lon: 14.326483 };
  const router = routerSandbox.LehrfahrerLocalBusRouting.createRouter(graph, { snapRadiusM: 220 });
  const selected = await router.routeBusPath({ from, to: hauptbahnhof, constraints: {} });
  const shortestLegal = shortestLegalBusPath(router, from, hauptbahnhof);
  const culprit = graph.turnRestrictions.find(restriction =>
    restriction.fromEdgeId === 'e93428' && String(restriction.viaNodeId) === '13128'
  );
  const unrestrictedRouter = routerSandbox.LehrfahrerLocalBusRouting.createRouter({
    ...graph,
    turnRestrictions: graph.turnRestrictions.filter(restriction => restriction !== culprit)
  }, { snapRadiusM: 220 });
  const withoutCulprit = await unrestrictedRouter.routeBusPath({ from, to: hauptbahnhof, constraints: {} });

  assert.equal(selected.ok, true);
  assert.equal(selected.distanceM, 1203);
  assert.equal(selected.durationSec, 111);
  assert.deepEqual([
    selected.localPath.startSnapDistanceM,
    selected.localPath.targetSnapDistanceM
  ], [36, 19]);
  assert.equal(shortestLegal.distanceM, 1172);
  assert.equal(shortestLegal.durationSec, 109);
  assert.equal(shortestLegal.targetSnapDistanceM, 19);
  assert.deepEqual(culprit, {
    fromEdgeId: 'e93428', viaNodeId: 13128, toEdgeId: 'e76535',
    type: 'only_turn', restriction: 'only_straight_on'
  });
  assert.equal(withoutCulprit.distanceM, 872);
  assert.equal(withoutCulprit.durationSec, 87);
  const shortcutIndex = withoutCulprit.localPath.edgeIds.indexOf('e76321');
  assert.deepEqual(
    Array.from(withoutCulprit.localPath.edgeIds.slice(shortcutIndex, shortcutIndex + 3)),
    ['e76321', 'e76323', 'e76325']
  );
});
