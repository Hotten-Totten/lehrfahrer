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

test('Rejoin entfernt OFF-Route-Hinweis und schliesst eine vorbereitete Loesung', () => {
  const classChanges = [];
  let alertHidden = false;
  let previewCleared = false;
  let statePersisted = false;
  const sandbox = {
    document: { body: { classList: { toggle: (name, active) => classChanges.push([name, active]) } } },
    navOffRouteActive: true,
    navActiveBusReroute: null,
    navPendingBusRerouteRequest: { preview: { selectedCandidate: {} } },
    navOffRouteCompactVisible: true,
    navRejoinBlend: 0.5,
    navOffRouteEnterFixCount: 2,
    navRejoinFixCount: 2,
    navCumDists: [0],
    navProgressIdx: 0,
    hideNavOffRouteAlert() { alertHidden = true; },
    renderUpcomingStops() {},
    persistActiveDriveState() { statePersisted = true; },
    cancelBusReroutePreview() {
      previewCleared = true;
      sandbox.navPendingBusRerouteRequest = null;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    functionSource('syncNavOffRouteUi', 'setConfirmedNavOffRoute'),
    functionSource('setConfirmedNavOffRoute', 'updateNavOffRouteState')
  ].join('\n'), sandbox);

  sandbox.setConfirmedNavOffRoute(false);

  assert.equal(sandbox.navOffRouteActive, false);
  assert.equal(sandbox.navOffRouteCompactVisible, false);
  assert.equal(sandbox.navPendingBusRerouteRequest, null);
  assert.equal(alertHidden, true);
  assert.equal(previewCleared, true);
  assert.equal(statePersisted, true);
  assert.deepEqual(classChanges, [['nav-off-route', false], ['nav-off-route-compact', false]]);
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

test('mehrere Raw-GPS-Fixes auf spaeterem Routenteil bleiben trotz veraltetem Index ON', () => {
  const sandbox = {
    console,
    NAV_SNAP_WINDOW: 2,
    NAV_SNAP_MAX_M: 120,
    NAV_OFF_ROUTE_MAX_ACCURACY_M: 50,
    NAV_OFF_ROUTE_ENTER_M: 50,
    NAV_OFF_ROUTE_ENTER_FIXES: 3,
    NAV_REJOIN_START_M: 25,
    NAV_REJOIN_FIXES: 3,
    navNearestIdx: 20,
    navProgressIdx: 20,
    navCumDists: [],
    navOffRouteActive: false,
    navOffRouteEnterFixCount: 0,
    navRejoinFixCount: 0,
    navLastRouteDistanceM: null,
    navRejoinBlend: 0,
    capturedDistanceM: null,
    noteNavPerfFallback() {},
    noteNavRouteState() {},
    noteNavSnap() {},
    updateNavOffRouteState(distanceM) {
      sandbox.capturedDistanceM = distanceM;
      if (distanceM >= sandbox.NAV_OFF_ROUTE_ENTER_M) {
        sandbox.navOffRouteEnterFixCount++;
      } else {
        sandbox.navOffRouteEnterFixCount = 0;
      }
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

  // A later route segment is intentionally near the raw fix while the route
  // index is stale. Its nearest-route distance must still be measured.
  const points = Array.from({ length: 61 }, (_, index) => [51 + index * 0.0001, 14]);
  for (let index = 0; index < 20; index++) points.push([51.006 + index * 0.0001, 14.002]);
  points.push([51.002, 14.001]);
  sandbox.navCumDists = sandbox.buildNavCumDists(points);
  let result;
  for (let index = 0; index < 3; index++) {
    result = sandbox.resolveNavTrackPoint(51.002, 14.001, points, 8, 51.002, 14.001);
  }

  assert.ok(sandbox.capturedDistanceM < 1, `distance=${sandbox.capturedDistanceM}`);
  assert.equal(sandbox.navOffRouteEnterFixCount, 0);
  assert.equal(result.routeState, 'ON');
  assert.equal(result.snapApplied, true);
});

test('Rejoin erfordert weiter drei Fixes, auch wenn der Routenindex veraltet ist', () => {
  const sandbox = {
    console,
    NAV_SNAP_WINDOW: 2,
    NAV_SNAP_MAX_M: 120,
    NAV_OFF_ROUTE_MAX_ACCURACY_M: 50,
    NAV_OFF_ROUTE_ENTER_M: 50,
    NAV_OFF_ROUTE_ENTER_FIXES: 3,
    NAV_REJOIN_START_M: 25,
    NAV_REJOIN_FIXES: 3,
    navNearestIdx: 0,
    navProgressIdx: 0,
    navCumDists: [],
    navOffRouteActive: true,
    navOffRouteEnterFixCount: 0,
    navRejoinFixCount: 0,
    navLastRouteDistanceM: null,
    navRejoinBlend: 0,
    noteNavPerfFallback() {},
    noteNavRouteState() {},
    noteNavSnap() {},
    setConfirmedNavOffRoute(active) {
      sandbox.navOffRouteActive = active;
      sandbox.navRejoinFixCount = 0;
      sandbox.navOffRouteEnterFixCount = 0;
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
    functionSource('resolveNavTrackPoint', 'getTurnInfo'),
    functionSource('updateNavOffRouteState', 'startNavigation')
  ].join('\n'), sandbox);

  const points = Array.from({ length: 100 }, (_, index) => [51 + index * 0.0001, 14]);
  sandbox.navCumDists = sandbox.buildNavCumDists(points);
  let result;
  for (let index = 0; index < 3; index++) {
    result = sandbox.resolveNavTrackPoint(points[80][0], points[80][1], points, 8);
    assert.equal(sandbox.navOffRouteActive, index < 2);
  }

  assert.equal(result.routeState, 'ON');
  assert.equal(sandbox.navOffRouteActive, false);
  assert.equal(sandbox.navNearestIdx, 80);
});
