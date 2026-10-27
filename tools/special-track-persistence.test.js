const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'js/editor.route.js'), 'utf8');
const routing = fs.readFileSync(path.join(root, 'js/editor.routing.js'), 'utf8');
const exportCode = api.slice(api.indexOf('function buildExportData()'), api.indexOf('// Exportiert die aktuelle Linie als JSON-Datei'));
const loadCode = api.slice(api.indexOf('function readSavedSpecialTracks('), api.indexOf('// Lädt eine Linie aus einer lokalen JSON-Datei'));
const routingCode = routing.slice(routing.indexOf('function findMatchingSpecialTrack('), routing.indexOf('function findStopByAnchor(')) +
  routing.slice(routing.indexOf('function findStopByAnchor('), routing.indexOf('// Routet nur die zwei Abschnitte')) +
  routing.slice(routing.indexOf('async function buildStreetRouteFromStopsImpl()'));
const anchorCode = route.slice(route.indexOf('function buildRoutingAnchorsFromCurrentRoute('), route.indexOf('// ROUTE RENDER'));
assert.ok(exportCode.includes('function buildExportData()') && loadCode.includes('function loadLineFromData('));

function stop(id, name, lat, lon) {
  return { id, name, lat, lon, sourceType: 'catalog', minuteFromStart: 0 };
}

function specialTrack(id, from, to, points) {
  return {
    id, fromStopId: from.id, fromStopName: from.name,
    toStopId: to.id, toStopName: to.name, points
  };
}

function editor(stops, tracks, geometry) {
  let nextStop = 1;
  let nextPoint = 1;
  const field = value => ({ value });
  const state = {
    stops: structuredClone(stops),
    specialTracks: structuredClone(tracks),
    routePoints: geometry.map(([lat, lon]) => ({ lat, lon, sourceType: 'street' })),
    simplifiedRoutePoints: [], routingMode: 'guidedStreet', preserveManualChains: true,
    selectedStopIds: new Set(), selectedRoutePointIds: new Set(), previewMode: 'original',
    routeMode: 'street', placementMode: 'freeStop'
  };
  const context = {
    state, window: { EditorMapAdapter: { refreshEditorMapFeatures() {} } },
    citySelect: field('cottbus'), lineNameInput: field('16'), routeNameInput: field('01'),
    directionNameInput: field(''), lineColorInput: field('#d32f2f'),
    historyRestoreRunning: true, stopIdCounter: 1, routePointIdCounter: 1,
    getLineDescription: () => '', getLineValidity: () => ({ validFrom: '', validUntil: '' }),
    getVariantName: () => '01', getVariantCategory: () => 'Standard',
    getOperationalRouteFields: () => ({}), getDirectionId: () => 'a',
    buildLineFileBase: () => 'Route_01', buildLineFolder: () => 'Linie_16',
    sanitizeFilename: value => value, getMapBoundsData: () => null, getMapViewData: () => null,
    getStopDisplayType: () => 'catalog', getStopSegmentMinutes: () => 0,
    getTotalRouteLengthMeters: () => 0, getEstimatedDriveMinutes: () => 0,
    normalizeEditorPlacementMode: value => value || 'freeStop',
    normalizeEditorRoutingMode: value => value || 'guidedStreet',
    setVariantName() {}, setVariantCategory() {}, setLineDescription() {},
    setLineValidity() {}, setOperationalRouteFields() {},
    clearEditorData() {
      state.stops = []; state.routePoints = []; state.specialTracks = [];
      state.simplifiedRoutePoints = [];
    },
    addStopToLine(data) {
      const created = { ...data, id: `stop_${nextStop++}` };
      state.stops.push(created);
      return created;
    },
    updateStopMarkerTooltip() {}, removeAllRoutePointMarkers() { state.routePoints = []; },
    createRoutePointObject(lat, lon, _silent, sourceType) {
      const created = { id: `route_${nextPoint++}`, lat, lon, sourceType };
      state.routePoints.push(created);
      return created;
    },
    createRouteLineOverlay(points) { return { points, on() {} }; },
    selectSpecialTrack() {}, refreshRouteLine() {}, updateModeButtons() {},
    updatePreviewButtons() {}, updateStats() {}, renderStopOrderList() {},
    clearSelection() {}, setStatus() {}, debug() {},
    setImmediate
  };
  vm.createContext(context);
  vm.runInContext(exportCode + '\n' + loadCode +
    '\nglobalThis.exportRoute = buildExportData; globalThis.loadRoute = loadLineFromData;', context);
  return context;
}

function savedTrackData(tracks) {
  return JSON.parse(JSON.stringify(tracks.map(({ id, fromStopId, fromStopName, toStopId, toStopName, points }) =>
    ({ id, fromStopId, fromStopName, toStopId, toStopName, points }))));
}

const a = stop('stop_a', 'A', 51.750001, 14.330001);
const b = stop('stop_b', 'B', 51.751001, 14.331001);
const c = stop('stop_c', 'C', 51.752001, 14.332001);
const d = stop('stop_d', 'D', 51.753001, 14.333001);
const ab = specialTrack('track_ab', a, b, [[51.750301, 14.330301], [51.750701, 14.330701]]);
const bc = specialTrack('track_bc', b, c, [[51.751301, 14.331301], [51.751701, 14.331701]]);
const geometry = [[a.lat, a.lon], ...ab.points, [b.lat, b.lon]];

function prepareRouting(app) {
  const streetCalls = [];
  Object.assign(app, {
    streetRoutingRunning: false, routingAbortController: null,
    buildStreetRouteBtn: { disabled: false }, cancelRoutingBtn: { style: {} },
    findNearestRoutePointIndexFrom(start, stopPoint) {
      let best = start;
      let distance = Infinity;
      app.state.routePoints.slice(start).forEach((point, offset) => {
        const current = Math.hypot(point.lat - stopPoint.lat, point.lon - stopPoint.lon);
        if (current < distance) { best = start + offset; distance = current; }
      });
      return best;
    },
    approxDistanceMeters: (from, to) => Math.hypot(from.lat - to.lat, from.lon - to.lon) * 111320,
    clearRouteMultiSelection() {}, pushHistorySnapshot() {},
    async buildEditorStreetRouteItemsViaAnchors([from, to]) {
      streetCalls.push([from, to]);
      return [from, to].map(anchor => ({ coord: [anchor.lon, anchor.lat], sourceType: 'street' }));
    },
    setRouteLoadPhase() {}, updateRouteStats() {}, applyRoutePointIcons() {},
    error(_message, cause) { throw cause; }, AbortController
  });
  vm.runInContext(anchorCode + '\n' + routingCode +
    '\nglobalThis.rebuildRoute = buildStreetRouteFromStopsImpl; globalThis.getAnchors = buildRoutingAnchorsFromCurrentRoute; globalThis.getSteps = buildRoutingStepsFromAnchors;', app);
  return streetCalls;
}

test('Route ohne Sondertrasse bleibt nach normalem Speichern und Laden unverändert', () => {
  const app = editor([a, b], [], geometry);
  const saved = JSON.parse(JSON.stringify(app.exportRoute()));
  assert.deepEqual(saved.specialTracks, []);
  app.loadRoute(saved);
  assert.deepEqual(savedTrackData(app.state.specialTracks), []);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Eine Sondertrasse überlebt Speichern, Leeren und Laden samt Geometrie', () => {
  const app = editor([a, b], [ab], geometry);
  const saved = JSON.parse(JSON.stringify(app.exportRoute()));
  assert.deepEqual(saved.specialTracks, [ab]);
  app.loadRoute(saved);
  assert.deepEqual(savedTrackData(app.state.specialTracks), [ab]);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.specialTracks[0].polyline.points)), ab.points);
});

test('Mehrere Sondertrassen bleiben vollständig erhalten', () => {
  const app = editor([a, b, c], [ab, bc], [...geometry, ...bc.points, [c.lat, c.lon]]);
  const saved = JSON.parse(JSON.stringify(app.exportRoute()));
  app.loadRoute(saved);
  assert.deepEqual(savedTrackData(app.state.specialTracks), [ab, bc]);
});

test('Alte Route ohne specialTracks lädt ohne erfundene Sondertrasse', () => {
  const app = editor([a, b], [ab], geometry);
  const old = JSON.parse(JSON.stringify(app.exportRoute()));
  delete old.specialTracks;
  app.loadRoute(old);
  assert.equal(app.state.specialTracks.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Ungültige Sondertrassen werden vor dem Leeren des Editors abgewiesen', () => {
  const app = editor([a, b], [ab], geometry);
  for (const malformed of [null, {}, [{ ...ab, points: [[NaN, 14], [51, 14]] }],
    [{ ...ab, points: [[51, 14]] }], [ab, ab]]) {
    const doc = JSON.parse(JSON.stringify(app.exportRoute()));
    doc.specialTracks = malformed;
    assert.throws(() => app.loadRoute(doc), /Ungültige Sondertrass/);
    assert.deepEqual(savedTrackData(app.state.specialTracks), [ab]);
    assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
  }
});

test('Wiederaufbau nach Laden übernimmt Sondertrasse exakt und ruft keinen Straßenrouter für ihr Segment', async () => {
  const app = editor([a, b], [ab], geometry);
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
  assert.deepEqual(savedTrackData(app.state.specialTracks), [ab]);
});

test('Ein manueller Anker im geschützten Abschnitt wird nicht zum Straßenrouting-Anker', async () => {
  const app = editor([a, b], [ab], geometry);
  app.state.routePoints[1].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  const anchors = app.getAnchors({ preserveManualChains: true });
  const steps = app.getSteps(anchors);
  assert.equal(anchors.some(anchor => anchor.kind === 'manual'), true);
  assert.deepEqual(Array.from(steps, step => step.type), ['track']);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Mehrere manuelle Anker im selben Sondertrassenabschnitt brechen ihn nicht auf', async () => {
  const app = editor([a, b], [ab], geometry);
  app.state.routePoints[1].sourceType = 'manual';
  app.state.routePoints[2].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Ein manueller Anker unmittelbar am Trassenanfang verdrängt den geschützten Stop-Anker nicht', async () => {
  const nearStart = [a.lat + 0.000005, a.lon + 0.000005];
  const app = editor([a, b], [ab], [[a.lat, a.lon], nearStart, ...ab.points, [b.lat, b.lon]]);
  app.state.routePoints[1].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  assert.deepEqual(Array.from(app.getSteps(app.getAnchors({ preserveManualChains: true })), step => step.type), ['track']);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Ein manueller Anker unmittelbar am Trassenende verdrängt den geschützten Stop-Anker nicht', async () => {
  const nearEnd = [b.lat - 0.000005, b.lon - 0.000005];
  const app = editor([a, b], [ab], [[a.lat, a.lon], ...ab.points, nearEnd, [b.lat, b.lon]]);
  app.state.routePoints[3].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  assert.deepEqual(Array.from(app.getSteps(app.getAnchors({ preserveManualChains: true })), step => step.type), ['track']);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), geometry);
});

test('Manuelle Anker vor und nach der Sondertrasse bleiben für GuidedStreet wirksam', async () => {
  const before = [51.750501, 14.330501];
  const after = [51.752501, 14.332501];
  const expected = [[a.lat, a.lon], before, [b.lat, b.lon], ...bc.points, [c.lat, c.lon], after, [d.lat, d.lon]];
  const app = editor([a, b, c, d], [bc], expected);
  app.state.routePoints[1].sourceType = 'manual';
  app.state.routePoints[6].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  const steps = app.getSteps(app.getAnchors({ preserveManualChains: true }));
  assert.deepEqual(Array.from(steps, step => step.type), ['street', 'street', 'track', 'street', 'street']);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 4);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), expected);
});

test('Mehrere Sondertrassen bleiben trotz manueller Anker in beiden Abschnitten exakt', async () => {
  const expected = [[a.lat, a.lon], ...ab.points, [b.lat, b.lon], ...bc.points, [c.lat, c.lon]];
  const app = editor([a, b, c], [ab, bc], expected);
  app.state.routePoints[1].sourceType = 'manual';
  app.state.routePoints[4].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 0);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), expected);
});

test('Ohne Sondertrasse bleibt die GuidedStreet-Segmentierung über manuelle Anker erhalten', async () => {
  const expected = [[a.lat, a.lon], ab.points[0], [b.lat, b.lon]];
  const app = editor([a, b], [], expected);
  app.state.routePoints[1].sourceType = 'manual';
  app.loadRoute(JSON.parse(JSON.stringify(app.exportRoute())));
  const streetCalls = prepareRouting(app);
  assert.deepEqual(Array.from(app.getSteps(app.getAnchors({ preserveManualChains: true })), step => step.type), ['street', 'street']);
  await app.rebuildRoute();
  assert.equal(streetCalls.length, 2);
  assert.deepEqual(app.state.routePoints.map(p => [p.lat, p.lon]), expected);
});
