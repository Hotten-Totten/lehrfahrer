const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'js/editor.route.js'), 'utf8');
const historySource = fs.readFileSync(path.join(root, 'js/editor.history.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');
const editorHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = routeSource.indexOf('function smoothRoute(options = {})');
const end = routeSource.indexOf('// SIMPLIFY', start);
const renderStart = routeSource.indexOf('function refreshRouteLine()');
const renderEnd = routeSource.indexOf('// ROUTE POINTS', renderStart);
const loadStart = apiSource.indexOf('function readSavedSpecialTracks(data)');
const loadEnd = apiSource.indexOf('function loadLineFromFile(file)', loadStart);
assert.ok(start >= 0 && end > start && renderStart >= 0 && renderEnd > renderStart && loadStart >= 0 && loadEnd > loadStart);

test('Editor lädt Route und History nach dem alten Browser-Cache-Schlüssel neu', () => {
  const routeVersion = editorHtml.match(/js\/editor\.route\.js\?v=([^"&]+)/)?.[1];
  const historyVersion = editorHtml.match(/js\/editor\.history\.js\?v=([^"&]+)/)?.[1];
  const styleVersion = editorHtml.match(/editor\.css\?v=([^"&]+)/)?.[1];
  const assetHash = source => crypto.createHash('sha256')
    .update(source.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  assert.equal(routeVersion, assetHash(routeSource));
  assert.equal(historyVersion, assetHash(historySource));
  assert.equal(styleVersion, assetHash(cssSource));
});

test('Glättungsdialog besitzt alle Aktionen und der Ablauf enthält keinen nativen Prompt', () => {
  assert.match(editorHtml, /id="routeSmoothingModal"[^>]*role="dialog"/);
  for (const [strength, label] of [['weak', 'Weich'], ['medium', 'Mittel'], ['strong', 'Stark']]) {
    assert.match(editorHtml, new RegExp(`data-smooth-strength="${strength}"[^>]*>${label}<`));
  }
  assert.match(editorHtml, /id="routeSmoothingCancelBtn"[^>]*>Abbrechen</);
  assert.match(editorHtml, /data-smooth-strength="medium"[^>]*>/);
  assert.doesNotMatch(routeSource.slice(start, end), /\bprompt\s*\(/);
});

function setup(points, engine = 'leaflet') {
  let hidden = true;
  let clickHandler = null;
  let keyHandler = null;
  const buttons = Object.fromEntries(['weak', 'medium', 'strong'].map(strength => [strength, {
    dataset: { smoothStrength: strength }, closest() { return this; }
  }]));
  const cancelButton = { closest() { return null; } };
  const modal = {
    classList: {
      contains() { return hidden; },
      add() { hidden = true; }, remove() { hidden = false; }
    },
    addEventListener(_type, handler) { clickHandler = handler; },
    removeEventListener() { clickHandler = null; },
    contains(button) { return Object.values(buttons).includes(button); },
    focus() {}
  };
  const document = {
    activeElement: { focus() {} },
    getElementById(id) { return id === 'routeSmoothingModal' ? modal : id === 'routeSmoothingCancelBtn' ? cancelButton : null; },
    addEventListener(_type, handler) { keyHandler = handler; },
    removeEventListener() { keyHandler = null; }
  };
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
      context.refreshRouteLine();
    },
    addStopToLine(stopData) {
      if (!context.testIsRestoring()) context.testPush('Stop hinzugefügt');
      const stop = { id: `temporary_${state.stops.length}`, ...stopData, marker: null };
      state.stops.push(stop);
      return stop;
    },
    updateStopMarkerTooltip() {},
    removeAllRoutePointMarkers() { state.routePoints = []; },
    createRoutePointObject(lat, lon, _silent, sourceType) {
      const point = { id: 'temporary', lat, lon, sourceType, marker: {} };
      state.routePoints.push(point);
      return point;
    },
    routeLine: null, simplifiedPreviewLine: null, visibleMapLibreRoute: null,
    createRouteLineOverlay(coords, options) { return engine === 'maplibre' ? null : { coords, options }; },
    removeRouteOverlay() {},
    window: { EditorMapAdapter: { refreshEditorMapFeatures() {
      if (engine === 'maplibre') {
        context.visibleMapLibreRoute = state.routePoints.length >= 2
          ? state.routePoints.map(point => [point.lat, point.lon]) : null;
      }
    } } },
    updateRouteStats() {}, updateModeButtons() {}, updatePreviewButtons() {},
    updateStats() {}, renderStopOrderList() {}, applyRoutePointIcons() {},
    clearSelection() { state.selected = null; },
    selectRoutePoint(point) { state.selected = { type: 'route', ref: point }; },
    document, setStatus() {}, debug() {}, error(message) { throw new Error(message); },
    prompt() { throw new Error('Native prompt must not be called'); },
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
  vm.runInNewContext(historySource + '\n' + routeSource.slice(renderStart, renderEnd) + '\n' +
    routeSource.slice(start, end) + '\n' + apiSource.slice(loadStart, loadEnd) +
    '\nglobalThis.testSmooth = smoothRouteInteractive; globalThis.testUndo = undoHistory; globalThis.testRedo = redoHistory; globalThis.testPush = pushHistorySnapshot; globalThis.testLoad = loadLineFromData; globalThis.testIsRestoring = () => historyRestoreRunning; globalThis.testWeak = smoothRouteWeak; globalThis.testMedium = smoothRouteMedium; globalThis.testStrong = smoothRouteStrong;', context);
  context.testDialogOpen = () => !hidden;
  context.testChoose = strength => clickHandler?.({ target: buttons[strength] });
  context.testCancel = () => clickHandler?.({ target: cancelButton });
  context.testEscape = () => keyHandler?.({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  context.refreshRouteLine();
  return { context, state };
}

test('Geladene Route: Undo und Redo zeichnen die sichtbare Routengeometrie vollständig', () => {
  const file = path.join(root, 'backup_liniendaten/linien/cottbus/Linie_800/Standard',
    'Route_01_Route_01_-_Hauptbahnhof_____Hoyerswerda__Bahnhof6.json');
  const savedRoute = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const engine of ['leaflet', 'maplibre']) {
    const { context, state } = setup([], engine);
    const visibleLine = () => JSON.stringify(engine === 'maplibre'
      ? context.visibleMapLibreRoute : context.routeLine?.coords);
    context.testLoad(savedRoute);
    const originalPoints = JSON.stringify(state.routePoints.map(point => [point.lat, point.lon]));
    const originalVisibleLine = visibleLine();
    assert.equal(state.stops.length, savedRoute.stops.length);
    assert.equal(originalVisibleLine, originalPoints);
    assert.ok(state.routePoints.length > 100);

    const undoCount = state.historyUndo.length;
    context.testSmooth();
    assert.equal(context.testDialogOpen(), true);
    assert.equal(state.historyUndo.length, undoCount);
    context.testChoose('medium');
    assert.equal(state.historyUndo.length, undoCount + 1);
    assert.equal(state.historyUndo.at(-1).routePoints.length, savedRoute.route.original.length);
    assert.ok(state.routePoints.length < savedRoute.route.original.length);
    const smoothedVisibleLine = visibleLine();
    assert.notEqual(smoothedVisibleLine, originalVisibleLine);

    context.testUndo();
    assert.equal(JSON.stringify(state.routePoints.map(point => [point.lat, point.lon])), originalPoints);
    assert.equal(visibleLine(), originalVisibleLine, `${engine}: sichtbare Route nach Undo`);
    assert.equal(state.stops.length, savedRoute.stops.length);

    context.testRedo();
    assert.equal(visibleLine(), smoothedVisibleLine, `${engine}: sichtbare Route nach Redo`);
    assert.equal(state.stops.length, savedRoute.stops.length);
  }
});

test('Route glätten: genau ein Undo-Schritt stellt Punkte, Geometrie und Auswahl wieder her', () => {
  const points = [0, 5, 10, 15, 20].map((lat, i) => ({ id: `p${i}`, lat, lon: 0 }));
  const { context, state } = setup(points);
  context.testSmooth();
  context.testChoose('strong');
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

test('Abbruch, Escape und Glätten ohne Punktänderung erzeugen keinen Undo-Schritt', () => {
  const points = [
    { id: 'p0', lat: 0, lon: 0 }, { id: 'p1', lat: 10, lon: 10 },
    { id: 'p2', lat: 20, lon: 0 }
  ];
  for (const action of ['cancel', 'escape', 'medium']) {
    const { context, state } = setup(points);
    const before = JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon]));
    context.testSmooth();
    assert.equal(context.testDialogOpen(), true);
    assert.equal(state.historyUndo.length, 0);
    if (action === 'cancel') context.testCancel();
    else if (action === 'escape') context.testEscape();
    else context.testChoose('medium');
    assert.equal(context.testDialogOpen(), false);
    assert.equal(JSON.stringify(state.routePoints.map(({ id, lat, lon }) => [id, lat, lon])), before);
    assert.equal(state.historyUndo.length, 0);
  }
  const shortRoute = setup(points.slice(0, 2));
  shortRoute.context.testSmooth();
  assert.equal(shortRoute.state.historyUndo.length, 0);
});

test('Weich, Mittel und Stark wählen jeweils die bestehende Glättungsstufe', () => {
  const points = [0, 5, 10, 15, 20].map((lat, i) => ({ id: `p${i}`, lat, lon: 0 }));
  for (const [choice, direct] of [['weak', 'testWeak'], ['medium', 'testMedium'], ['strong', 'testStrong']]) {
    const selected = setup(points);
    const reference = setup(points);
    selected.context.testSmooth();
    assert.equal(selected.state.routePoints.length, points.length);
    assert.equal(selected.state.historyUndo.length, 0);
    selected.context.testChoose(choice);
    reference.context[direct]();
    assert.equal(JSON.stringify(selected.state.routePoints.map(point => point.id)),
      JSON.stringify(reference.state.routePoints.map(point => point.id)));
    assert.equal(selected.state.historyUndo.length, 1);
    const smoothed = JSON.stringify(selected.state.routePoints.map(point => point.id));
    selected.context.testUndo();
    assert.equal(JSON.stringify(selected.state.routePoints.map(point => point.id)),
      JSON.stringify(points.map(point => point.id)));
    selected.context.testRedo();
    assert.equal(JSON.stringify(selected.state.routePoints.map(point => point.id)), smoothed);
  }
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
