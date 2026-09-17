const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function navGetLatLon'),
  appSource.indexOf('function bearingDeg')
), sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function interpolateBusReroutePosition'),
  appSource.indexOf('function requestBusReroute')
), sandbox);

const routePoints = Array.from({ length: 31 }, (_, index) => [
  51.75 + index * 0.0009,
  14.33
]);
const routeCumDists = routePoints.map((_, index) => index * 100);
const routeStops = [
  { stop: { id: 'A', name: 'Erste offene Haltestelle' }, distFromStart: 700 },
  { stop: { id: 'B', name: 'Zweite offene Haltestelle' }, distFromStart: 1250 },
  { stop: { id: 'C', name: 'Dritte offene Haltestelle' }, distFromStart: 1850 },
  { stop: { id: 'D', name: 'Vierte offene Haltestelle' }, distFromStart: 2400 }
];

function prepare(overrides = {}) {
  return sandbox.buildBusReroutePreparation({
    currentPosition: { lat: 51.7545, lon: 14.34 },
    routePoints,
    routeCumDists,
    routeProgressIndex: 4,
    routeStops,
    ...overrides
  });
}

test('liefert drei bis fuenf ausschliesslich vorausliegende Rueckkehrkandidaten', () => {
  const result = prepare();
  assert.ok(result.returnCandidates.length >= 3 && result.returnCandidates.length <= 5);
  assert.ok(result.returnCandidates.every(candidate =>
    candidate.routeProgressM > result.originalRouteProgress.distanceM
  ));
});

test('ordnet verbleibende Haltestellen und kennzeichnet Kandidaten davor korrekt', () => {
  const result = prepare({
    routeStops: [routeStops[2], routeStops[0], routeStops[3], routeStops[1]]
  });
  assert.deepEqual(Array.from(result.remainingStops, stop => stop.id), ['A', 'B', 'C', 'D']);
  const beforeFirstStop = result.returnCandidates.find(candidate => candidate.beforeNextStop);
  assert.ok(beforeFirstStop);
  assert.equal(beforeFirstStop.nextStopId, 'A');
  assert.equal(beforeFirstStop.skippedStopCount, 0);
  assert.equal(beforeFirstStop.relativeToNextOpenStop, 'before');
  const atFirstStop = result.returnCandidates.find(candidate =>
    candidate.relativeToNextOpenStop === 'at'
  );
  assert.ok(atFirstStop);
  assert.equal(atFirstStop.nextStopId, 'A');
  assert.equal(atFirstStop.skippedStopCount, 0);
  assert.ok(result.returnCandidates.some(candidate => candidate.source === 'before-stop'));
  assert.ok(result.returnCandidates.some(candidate => candidate.source === 'after-stop'));
  assert.ok(result.returnCandidates.some(candidate => candidate.source === 'between-stops'));
});

test('bildet spaetere Alternativen mit korrekter Zahl ausgelassener Haltestellen', () => {
  const closeStops = [450, 500, 550, 1400].map((distFromStart, index) => ({
    stop: { id: String.fromCharCode(65 + index), name: `Haltestelle ${index + 1}` },
    distFromStart
  }));
  const result = prepare({ routeStops: closeStops });
  const afterSeveralStops = result.returnCandidates.find(candidate => candidate.skippedStopCount >= 2);
  assert.ok(afterSeveralStops);
  assert.ok(afterSeveralStops.routeProgressM > closeStops[1].distFromStart);
  assert.equal(afterSeveralStops.relativeToNextOpenStop, 'after');
  assert.ok(['C', 'D', null].includes(afterSeveralStops.nextStopId));
});

test('priorisiert weniger ausgelassene Haltestellen trotz laengerer Luftlinie', () => {
  const closeStops = [450, 500, 550, 1400].map((distFromStart, index) => ({
    stop: { id: String.fromCharCode(65 + index), name: `Haltestelle ${index + 1}` },
    distFromStart
  }));
  const result = prepare({
    currentPosition: { lat: routePoints[6][0], lon: routePoints[6][1] },
    routeStops: closeStops
  });
  const early = result.returnCandidates.find(candidate => candidate.skippedStopCount === 0);
  const late = result.returnCandidates.find(candidate => candidate.skippedStopCount >= 2);
  assert.ok(early && late);
  assert.ok(early.directDistanceM > late.directDistanceM);
  assert.ok(result.returnCandidates.indexOf(early) < result.returnCandidates.indexOf(late));
});

test('liefert auch ohne offene Haltestelle mehrere Punkte des Restverlaufs', () => {
  const result = prepare({ routeStops: [] });
  assert.ok(result.returnCandidates.length >= 3 && result.returnCandidates.length <= 5);
  assert.equal(result.remainingStops.length, 0);
  assert.ok(result.returnCandidates.every(candidate =>
    candidate.nextStopId === null &&
    candidate.skippedStopCount === 0 &&
    candidate.relativeToNextOpenStop === 'none' &&
    Number.isFinite(candidate.directDistanceM)
  ));
});
