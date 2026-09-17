const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');

function functionSource(name, nextName) {
  return appSource.slice(
    appSource.indexOf(`function ${name}`),
    appSource.indexOf(`function ${nextName}`)
  );
}

test('OFF-Route wird nach drei genauen Raw-GPS-Fixes bestaetigt', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    const NAV_OFF_ROUTE_MAX_ACCURACY_M = 50;
    const NAV_OFF_ROUTE_ENTER_M = 50;
    const NAV_OFF_ROUTE_ENTER_FIXES = 3;
    const NAV_REJOIN_START_M = 25;
    const NAV_REJOIN_FIXES = 3;
    let navOffRouteActive = false;
    let navOffRouteEnterFixCount = 0;
    let navRejoinFixCount = 0;
    let navLastRouteDistanceM = null;
    function setConfirmedNavOffRoute(active) { navOffRouteActive = active; }
    ${functionSource('updateNavOffRouteState', 'startNavigation')}
  `, sandbox);

  assert.equal(vm.runInContext('updateNavOffRouteState(60, 10)', sandbox), false);
  assert.equal(vm.runInContext('updateNavOffRouteState(60, 10)', sandbox), false);
  assert.equal(vm.runInContext('updateNavOffRouteState(60, 10)', sandbox), true);
});

test('Genauigkeitspuffer und ungenaue Fixes bleiben wirksam', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    const NAV_OFF_ROUTE_MAX_ACCURACY_M = 50;
    const NAV_OFF_ROUTE_ENTER_M = 50;
    const NAV_OFF_ROUTE_ENTER_FIXES = 3;
    const NAV_REJOIN_START_M = 25;
    const NAV_REJOIN_FIXES = 3;
    let navOffRouteActive = false;
    let navOffRouteEnterFixCount = 0;
    let navRejoinFixCount = 0;
    let navLastRouteDistanceM = null;
    function setConfirmedNavOffRoute(active) { navOffRouteActive = active; }
    ${functionSource('updateNavOffRouteState', 'startNavigation')}
  `, sandbox);

  vm.runInContext('updateNavOffRouteState(60, 30)', sandbox);
  vm.runInContext('updateNavOffRouteState(90, 60)', sandbox);
  assert.equal(vm.runInContext('navOffRouteEnterFixCount', sandbox), 0);
  assert.equal(vm.runInContext('navOffRouteActive', sandbox), false);
});

test('Distanzquelle ist Raw-GPS im lokalen Routenkorridor', () => {
  const sandbox = {
    console,
    NAV_SNAP_WINDOW: 2,
    NAV_SNAP_MAX_M: 120,
    navNearestIdx: 20,
    navProgressIdx: 20,
    navCumDists: [],
    navOffRouteActive: false,
    navOffRouteEnterFixCount: 0,
    navRejoinBlend: 0,
    capturedDistanceM: null,
    noteNavPerfFallback() {},
    noteNavRouteState() {},
    noteNavSnap() {},
    updateNavOffRouteState(distanceM) {
      sandbox.capturedDistanceM = distanceM;
      sandbox.navOffRouteEnterFixCount = 1;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    functionSource('navGetLatLon', 'haversineM'),
    functionSource('haversineM', 'bearingDeg'),
    functionSource('bearingDeg', 'buildNavCumDists'),
    functionSource('buildNavCumDists', 'detectNavRoundabouts'),
    functionSource('navGetRouteHeadingAtIndex', 'navGetStableRouteTangent'),
    functionSource('findNearestNavIdx', 'snapGpsToRoute'),
    functionSource('snapGpsToRoute', 'lerpValue'),
    functionSource('lerpValue', 'resolveNavTrackPoint'),
    functionSource('resolveNavTrackPoint', 'getTurnInfo')
  ].join('\n'), sandbox);

  // Der spaetere Routenteil liegt absichtlich am Raw-Fix. Die Erkennung darf
  // nicht global dorthin springen, sondern muss den aktuellen Korridor messen.
  const points = Array.from({ length: 61 }, (_, index) => [51 + index * 0.0001, 14]);
  for (let index = 0; index < 20; index++) points.push([51.006 + index * 0.0001, 14.002]);
  points.push([51.002, 14.001]);
  sandbox.navCumDists = sandbox.buildNavCumDists(points);
  const result = sandbox.resolveNavTrackPoint(
    51.002,
    14.00005,
    points,
    8,
    51.002,
    14.0010
  );

  assert.ok(sandbox.capturedDistanceM > 60);
  assert.equal(result.routeState, 'SUSPECTED');
  assert.equal(result.snapApplied, false);
});
