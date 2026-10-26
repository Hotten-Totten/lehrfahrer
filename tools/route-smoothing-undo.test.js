const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'js/editor.route.js'), 'utf8');
const historySource = fs.readFileSync(path.join(root, 'js/editor.history.js'), 'utf8');
const start = routeSource.indexOf('function smoothRoute(options = {})');
const end = routeSource.indexOf('// SIMPLIFY', start);
assert.ok(start >= 0 && end > start);

function setup(points, promptValue = '2') {
  const state = {
    stops: [], routePoints: points.map(point => ({ ...point, sourceType: 'manual', marker: {} })),
    selectedRoutePointIds: new Set(['p1', 'p3']), selected: null,
    simplifiedRoutePoints: [{ lat: 1, lon: 2 }], specialTracks: [], currentSpecialTrack: null,
    historyUndo: [], historyRedo: [], routeMode: 'street', placementMode: 'route',
    routingMode: 'guidedStreet', preserveManualChains: true, previewMode: 'simplified'
  };
  state.selected = state.routePoints[1] ? { type: 'route', ref: state.routePoints[1] } : null;
  const field = value => ({ value });
  const context = {
    state, mode: 'route', stopIdCounter: 0, routePointIdCounter: 5, DEBUG: false,
    lineNameInput: field('16'), routeNameInput: field('01'),
    directionNameInput: field('Ziel'), lineColorInput: field('#123456'),
    undoBtn: {}, redoBtn: {},
    getVariantName: () => '', getVariantCategory: () => 'Standard',
    getOperationalRouteFields: () => ({}), getLineValidity: () => ({}),
    getLineDescription: () => '',
    normalizeEditorPlacementMode: value => value,
    normalizeEditorRoutingMode: value => value,
    setVariantName() {}, setVariantCategory() {}, setLineDescription() {},
    setLineValidity() {}, setOperationalRouteFields() {},
    clearEditorData() {
      state.stops = []; state.routePoints = []; state.simplifiedRoutePoints = [];
      state.selectedRoutePointIds.clear(); state.selected = null;
    },
    addStopToLine() { throw new Error('No stops expected'); },
    removeAllRoutePointMarkers() { state.routePoints = []; },
    createRoutePointObject(lat, lon, _silent, sourceType) {
      const point = { id: 'temporary', lat, lon, sourceType, marker: {} };
      state.routePoints.push(point);
      return point;
    },
    createRouteLineOverlay() { throw new Error('No special tracks expected'); },
    refreshRouteLine() {}, updateModeButtons() {}, updatePreviewButtons() {},
    updateStats() {}, renderStopOrderList() {}, applyRoutePointIcons() {},
    clearSelection() { state.selected = null; },
    selectRoutePoint(point) { state.selected = { type: 'route', ref: point }; },
    setStatus() {}, prompt: () => promptValue,
    approxDistanceMeters: (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon),
    pointToSegmentDistanceMeters: point => Math.abs(point.lon),
    removeMarkerSafe() {},
    clearRouteSelectionIfDeleted(ids) {
      if (state.selected?.type === 'route' && ids.has(state.selected.ref.id)) state.selected = null;
      for (const id of ids) state.selectedRoutePointIds.delete(id);
    },
    routeEditor: { classList: { add() {} } },
    noSelection: { classList: { remove() {} } }
  };
  vm.runInNewContext(historySource + '\n' + routeSource.slice(start, end) +
    '\nglobalThis.testSmooth = smoothRouteInteractive; globalThis.testUndo = undoHistory; globalThis.testRedo = redoHistory; globalThis.testPush = pushHistorySnapshot;', context);
  return { context, state };
}

test('Route glätten: genau ein Undo-Schritt stellt Punkte, Geometrie und Auswahl wieder her', () => {
  const points = [0, 5, 10, 15, 20].map((lat, i) => ({ id: `p${i}`, lat, lon: 0 }));
  const { context, state } = setup(points, '3');
  context.testSmooth();
  assert.ok(state.routePoints.length < points.length);
  assert.equal(state.historyUndo.length, 1);
  const smoothed = JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon]));
  context.testUndo();
  assert.equal(JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon])),
    JSON.stringify(points.map(({ id, lat, lon }) => [id, lat, lon])));
  assert.equal(JSON.stringify(state.simplifiedRoutePoints), '[{"lat":1,"lon":2}]');
  assert.equal(state.previewMode, 'simplified');
  assert.equal(state.selected?.ref.id, 'p1');
  assert.equal(JSON.stringify([...state.selectedRoutePointIds].sort()), '["p1","p3"]');
  context.testRedo();
  assert.equal(JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon])), smoothed);
  assert.equal(state.historyUndo.length, 1);
  assert.equal(state.historyRedo.length, 0);
});

test('Abbruch und Glätten ohne Punktänderung erzeugen keinen Undo-Schritt', () => {
  const points = [
    { id: 'p0', lat: 0, lon: 0 }, { id: 'p1', lat: 10, lon: 10 },
    { id: 'p2', lat: 20, lon: 0 }
  ];
  for (const answer of [null, '2']) {
    const { context, state } = setup(points, answer);
    const before = JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon]));
    context.testSmooth();
    assert.equal(JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon])), before);
    assert.equal(state.historyUndo.length, 0);
  }
  const shortRoute = setup(points.slice(0, 2));
  shortRoute.context.testSmooth();
  assert.equal(shortRoute.state.historyUndo.length, 0);
});

test('Bestehender History-Mechanismus stellt auch eine andere Editoränderung wieder her', () => {
  const points = [
    { id: 'p0', lat: 0, lon: 0 }, { id: 'p1', lat: 10, lon: 10 },
    { id: 'p2', lat: 20, lon: 0 }
  ];
  const { context } = setup(points);
  context.testPush('Routendaten geändert');
  context.routeNameInput.value = '02';
  context.testUndo();
  assert.equal(context.routeNameInput.value, '01');
  context.testRedo();
  assert.equal(context.routeNameInput.value, '02');
});
