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
    navRouteRecoveryCandidate: null,
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
    navRouteRecoveryCandidate: null,
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

function recoveryHarness({hint=0,off=true}={}) {
  const sandbox={console:{info(){}},NAV_SNAP_WINDOW:2,NAV_SNAP_MAX_M:120,NAV_OFF_ROUTE_MAX_ACCURACY_M:50,
    NAV_OFF_ROUTE_ENTER_M:50,NAV_OFF_ROUTE_ENTER_FIXES:3,NAV_REJOIN_START_M:25,NAV_REJOIN_FIXES:3,
    navNearestIdx:hint,navProgressIdx:hint,navCumDists:[],navOffRouteActive:off,navOffRouteEnterFixCount:0,
    navRejoinFixCount:0,navRouteRecoveryCandidate:null,navLastRouteDistanceM:null,navRejoinBlend:0,timeMs:0,
    noteNavPerfFallback(){},noteNavRouteState(){},noteNavSnap(){},transitions:[]};
  sandbox.Date={now:()=>sandbox.timeMs};
  // Mirror only the UI-independent transition effects.
  sandbox.setConfirmedNavOffRoute=active=>{sandbox.navOffRouteActive=active;sandbox.navOffRouteEnterFixCount=0;sandbox.navRejoinFixCount=0;sandbox.navRouteRecoveryCandidate=null;sandbox.transitions.push(active);};
  vm.createContext(sandbox);
  vm.runInContext([
    functionSource('navGetLatLon','haversineM'),functionSource('haversineM','bearingDeg'),
    functionSource('bearingDeg','buildNavCumDists'),functionSource('buildNavCumDists','detectNavRoundabouts'),
    functionSource('navGetRouteHeadingAtIndex','navGetStableRouteTangent'),functionSource('findNearestNavIdx','snapGpsToRoute'),
    functionSource('snapGpsToRoute','lerpValue'),functionSource('lerpValue','resolveNavTrackPoint'),
    functionSource('resolveNavTrackPoint','getTurnInfo'),functionSource('updateNavOffRouteState','startNavigation')
  ].join('\n'),sandbox);
  sandbox.route=Array.from({length:220},(_,index)=>[51+index*0.0001,14]);
  sandbox.navCumDists=sandbox.buildNavCumDists(sandbox.route);
  sandbox.fix=(index,accuracy=8,displayIndex=index)=>sandbox.resolveNavTrackPoint(...sandbox.route[displayIndex],sandbox.route,accuracy,...sandbox.route[index]);
  return sandbox;
}

test('Wiedererkennung nach veraltetem Index bleibt bis zum dritten Fix bestaetigungsbeduerftig',()=>{
 const h=recoveryHarness({off:false});
 assert.equal(h.fix(80).routeState,'SUSPECTED');assert.equal(h.navNearestIdx,0);
 assert.equal(h.fix(80).routeState,'SUSPECTED');assert.equal(h.navNearestIdx,0);
 const r=h.fix(80);assert.equal(r.routeState,'ON');assert.equal(h.navNearestIdx,80);assert.equal(h.navProgressIdx,80);
 assert.deepEqual(h.transitions,[]);assert.equal(h.navOffRouteEnterFixCount,0);
});

test('Glaettung auf altem Abschnitt kann bestaetigte Wiedererkennung nicht zuruecksetzen',()=>{
 const h=recoveryHarness();
 for(let i=0;i<3;i++)h.fix(80,8,0);
 assert.equal(h.navOffRouteActive,false);assert.equal(h.navNearestIdx,80);
 for(let i=0;i<4;i++){
  const r=h.fix(80,8,0);assert.equal(r.routeState,'ON');assert.equal(r.index,80);assert.equal(h.navNearestIdx,80);
  assert.equal(r.routeProgressM,h.navCumDists[80]);
 }
 assert.deepEqual(h.transitions,[false]);
});

test('Ein GPS-Ausreisser springt nicht auf einen spaeteren Streckenabschnitt',()=>{
 const h=recoveryHarness({off:false});h.fix(80);h.fix(0);
 assert.equal(h.navNearestIdx,0);assert.equal(h.navRouteRecoveryCandidate,null);assert.equal(h.navOffRouteEnterFixCount,0);
 assert.equal(h.fix(80).routeState,'SUSPECTED');assert.equal(h.navNearestIdx,0);
});

test('Wechselnde weit auseinanderliegende Rueckkehrpunkte werden nicht zusammengezaehlt',()=>{
 const h=recoveryHarness();
 for(const index of [80,170,80,170]){h.fix(index);assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,1);assert.equal(h.navNearestIdx,0);}
 h.fix(170);assert.equal(h.navOffRouteActive,true);
 h.fix(170);assert.equal(h.navOffRouteActive,false);assert.equal(h.navNearestIdx,170);
});

test('Unzuverlaessige und unbekannte GPS-Genauigkeit bestaetigen keine globale Wiedererkennung',()=>{
 const h=recoveryHarness();h.fix(80);h.fix(80);h.fix(80,60);
 assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,0);assert.equal(h.navRouteRecoveryCandidate,null);
 h.fix(80,null);assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,0);
 h.fix(80);h.fix(80);assert.equal(h.navOffRouteActive,true);
 h.fix(80);assert.equal(h.navOffRouteActive,false);
});

test('Globale Rueckkehr und lokaler Korridor muessen jeweils drei zusammenpassende Fixes haben',()=>{
 const h=recoveryHarness();h.fix(80);h.fix(80);
 h.fix(0);assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,1);
 h.fix(0);assert.equal(h.navOffRouteActive,true);
 h.fix(0);assert.equal(h.navOffRouteActive,false);assert.equal(h.navNearestIdx,0);
});

test('Ein bereits abgefahrener entfernter Abschnitt loest keinen globalen Ruecksprung aus',()=>{
 const h=recoveryHarness({hint:150});
 for(let i=0;i<4;i++)h.fix(0);
 assert.equal(h.navOffRouteActive,true);assert.equal(h.navNearestIdx,150);assert.equal(h.navProgressIdx,150);
 assert.equal(h.navRouteRecoveryCandidate,null);
});

test('Geglaettete Position auf Route verdeckt echte Raw-GPS-Abweichung nicht',()=>{
 const h=recoveryHarness({hint:20,off:false});
 let r;for(let i=0;i<3;i++)r=h.resolveNavTrackPoint(...h.route[20],h.route,8,h.route[20][0],14.005);
 assert.equal(h.navOffRouteActive,true);assert.equal(r.routeState,'OFF');assert.equal(r.snapApplied,false);assert.equal(h.navNearestIdx,20);
});

test('Spaeterer langer Abschnitt wird als Segment erkannt statt nur anhand seiner Stuetzpunkte',()=>{
 const h=recoveryHarness({hint:20,off:false});
 h.route=Array.from({length:61},(_,index)=>[51+index*0.0001,14]);
 h.route.push([51.006,14.01],[51.002,14.01],[51.002,13.99]);h.navCumDists=h.buildNavCumDists(h.route);
 let r;for(let i=0;i<3;i++)r=h.resolveNavTrackPoint(51.002,14.001,h.route,8);
 assert.equal(r.routeState,'ON');assert.ok(r.snapDistanceM<1);assert.ok(h.navNearestIdx>=61);
});

test('Nahe spaetere Schleife verdraengt den weiterhin passenden aktuellen Korridor nicht',()=>{
 const h=recoveryHarness({hint:20,off:false});
 h.route.push([51.002,14]);h.navCumDists=h.buildNavCumDists(h.route);
 for(let i=0;i<4;i++)h.fix(20);
 assert.equal(h.navNearestIdx,20);assert.equal(h.navRouteRecoveryCandidate,null);assert.deepEqual(h.transitions,[]);
});

test('Routenwechsel verwirft eine bereits angefangene Wiedererkennung',()=>{
 const h=recoveryHarness();h.fix(80);h.fix(80);
 h.route=h.route.map(p=>[...p]);h.navCumDists=h.buildNavCumDists(h.route);
 h.fix(80);assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,1);
});

test('Eine laengere GPS-Pause startet die Wiedererkennungsbestaetigung neu',()=>{
 const h=recoveryHarness();h.fix(80);h.timeMs=1000;h.fix(80);
 h.timeMs=20000;h.fix(80);assert.equal(h.navOffRouteActive,true);assert.equal(h.navRejoinFixCount,1);
 h.timeMs=21000;h.fix(80);assert.equal(h.navOffRouteActive,true);
 h.timeMs=22000;h.fix(80);assert.equal(h.navOffRouteActive,false);
});

for(const accuracy of [8,null])test(`Dichte Routenpunkte erhalten normalen Fortschritt (${accuracy===null?'Simulation':'GPS'})`,()=>{
 const h=recoveryHarness({off:false});h.route=Array.from({length:1001},(_,index)=>[51+index*0.000001,14]);
 h.navCumDists=h.buildNavCumDists(h.route);
 for(const index of [80,160,240,320,400]){const r=h.fix(index,accuracy);assert.equal(r.routeState,'ON');assert.equal(r.index,index);}
 assert.deepEqual(h.transitions,[]);
});
