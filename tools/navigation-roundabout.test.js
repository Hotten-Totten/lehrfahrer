const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
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

const REAL_LINE_999_TURBO = [
  [51.768611, 14.356698],
  [51.768507, 14.357053],
  [51.768454, 14.357149],
  [51.768404, 14.357159],
  [51.768343, 14.357199],
  [51.768325, 14.357222],
  [51.768284, 14.357271],
  [51.768243, 14.357372],
  [51.768230, 14.357466],
  [51.768186, 14.357592],
  [51.768117, 14.357682],
  [51.767683, 14.357984],
  [51.767543, 14.358055],
  [51.767285, 14.358163],
  [51.767005, 14.358244],
  [51.766852, 14.358282],
  // Punkt 137 liefert nur den ausgehenden Segmentwinkel fuer Punkt 136.
  [51.766755, 14.358287]
];

function analyze(points) {
  const cumDists = sandbox.buildNavCumDists(points);
  return {
    roundabouts: sandbox.detectNavRoundabouts(points, cumDists),
    turns: sandbox.detectNavTurns(points, cumDists)
  };
}

function pathFromHeadings(headings, segmentM = 12) {
  const points = [[51.75, 14.33]];
  const metersPerLat = 111320;
  const metersPerLon = Math.cos(points[0][0] * Math.PI / 180) * metersPerLat;
  for (const heading of headings) {
    const radians = heading * Math.PI / 180;
    const previous = points[points.length - 1];
    points.push([
      previous[0] + Math.cos(radians) * segmentM / metersPerLat,
      previous[1] + Math.sin(radians) * segmentM / metersPerLon
    ]);
  }
  return points;
}

test('realer Turbokreisel Linie 999 wird normalisiert und im HUD priorisiert', () => {
  const result = analyze(REAL_LINE_999_TURBO);
  assert.equal(result.roundabouts.length, 1);
  assert.equal(result.roundabouts[0].type, 'roundabout');
  const roundaboutTurn = result.turns.find(turn => turn.type === 'roundabout');
  assert.ok(roundaboutTurn);
  assert.equal(sandbox.getTurnInfo(roundaboutTurn.angle, roundaboutTurn.type).label, 'Kreisverkehr folgen');
  assert.equal(result.turns.some(turn => !turn.type && turn.angle <= -20 && turn.angle > -50), false);
});

test('reale Linie 999 behaelt das Folgemanoever nach der Ausfahrt', () => {
  const route = JSON.parse(fs.readFileSync(path.join(
    projectRoot,
    'backup_liniendaten/linien/cottbus/Linie_999/Linie_999_Route_Test001_BHs-Cottbus_Ueber_Stadtring.json'
  ), 'utf8'));
  const result = analyze(route.routePoints);
  const roundaboutIndex = result.turns.findIndex(turn => turn.type === 'roundabout');
  assert.ok(roundaboutIndex >= 0);
  assert.equal(result.turns[roundaboutIndex + 1].index, 228);
  assert.equal(Math.round(result.turns[roundaboutIndex + 1].angle), -90);
});

test('normale Kreisverkehrsgeometrie bleibt erkannt', () => {
  const radiusM = 20;
  const centerLat = 51.75;
  const centerLon = 14.33;
  const metersPerLat = 111320;
  const metersPerLon = Math.cos(centerLat * Math.PI / 180) * metersPerLat;
  const points = [];
  for (let angle = 0; angle <= 180; angle += 15) {
    const radians = angle * Math.PI / 180;
    points.push([
      centerLat + Math.cos(radians) * radiusM / metersPerLat,
      centerLon + Math.sin(radians) * radiusM / metersPerLon
    ]);
  }
  assert.ok(analyze(points).roundabouts.length > 0);
});

test('normale S-Kurve wird nicht als Kreisverkehr erkannt', () => {
  const points = pathFromHeadings([0, 15, 30, 15, 0, -15, -30, -15, 0, 0, 0]);
  assert.equal(analyze(points).roundabouts.length, 0);
});

test('einzelne starke Kurve und echte Abzweigung bleiben negativ', () => {
  const strongCurve = pathFromHeadings([0, 0, 0, 45, 90, 90, 90]);
  const branch = pathFromHeadings([0, 0, 0, 90, 90, 90, 90]);
  assert.equal(analyze(strongCurve).roundabouts.length, 0);
  assert.equal(analyze(branch).roundabouts.length, 0);
});

test('normales Leicht-links bleibt ein generisches Manoever', () => {
  const points = pathFromHeadings([0, 0, 0, -12, -24, -36, -36, -36, -36]);
  const result = analyze(points);
  assert.equal(result.roundabouts.length, 0);
  assert.equal(sandbox.getTurnInfo(-36).label, 'Leicht links');
});
