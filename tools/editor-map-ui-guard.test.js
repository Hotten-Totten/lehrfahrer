const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/editor.map-adapter.js'), 'utf8');
const eventsSource = fs.readFileSync(path.join(__dirname, '../js/editor.events.js'), 'utf8');
const section = (start, end) => {
  const first = source.indexOf(`  function ${start}(`);
  const last = source.indexOf(`  function ${end}(`, first);
  assert.ok(first >= 0 && last > first, `${start} source available`);
  return source.slice(first, last);
};
const guardSource = section('isMapLibreEditorSurfaceEvent', 'stopHitTestDiagnostics');
const dragSource = section('startMapLibreObjectDragging', 'stopMapLibreObjectDragging');
const placementSource = eventsSource.slice(
  eventsSource.indexOf('function handleEditorPointPlacement('),
  eventsSource.indexOf('function deleteSelectedEditorPointObject(')
);
assert.ok(placementSource.includes('function handleEditorPointPlacement('));

function element(tag = 'div', classes = [], parent = null, role = '') {
  return {
    tagName: tag.toLowerCase(), classes, parent, role,
    contains(target) {
      for (let node = target; node; node = node.parent) if (node === this) return true;
      return false;
    },
    closest(selector) {
      const selectors = selector.split(',').map(item => item.trim());
      for (let node = this; node; node = node.parent) {
        if (selectors.some(item => item.startsWith('.')
          ? node.classes.includes(item.slice(1))
          : item.startsWith('[role=')
            ? node.role === item.match(/"([^"]+)"/)[1]
            : node.tagName === item)) return node;
      }
      return null;
    }
  };
}

function fixture() {
  const listeners = new Map();
  const container = element('div');
  container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 500 });
  const canvas = element('canvas', ['maplibregl-canvas'], container);
  const marker = element('div', ['maplibregl-marker'], container);
  const markerButton = element('button', [], marker);
  const mapControl = element('button', [], element('div', ['maplibregl-ctrl'], container));
  const overlaidUi = element('div', ['editor-overlay'], container);
  const outside = name => element('button', [], element('div', [name]));
  const document = { addEventListener(name, callback) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  } };
  const calls = { placed: [], stops: 0, routePoints: 0, specialTracks: 0,
    detours: 0, drafts: 0, selected: 0, hit: 0, drag: 0, dragPreview: 0, panDisabled: 0 };
  let hitFeatureType = 'stop';
  const state = {
    global: { document },
    managedMap: { dragPan: {
      isEnabled: () => true,
      disable: () => { calls.panDisabled++; }
    } },
    MAPLIBRE_MIGRATION_ENABLED: true,
    MAPLIBRE_TEST_INTERACTION_ENABLED: true,
    MAPLIBRE_DEVELOPER_TEST_ENABLED: false,
    state: { routeMode: 'freeStop', placementMode: 'freeStop', detourWizard: null },
    createFreeStop: () => { calls.stops++; },
    createManualRoutePoint: () => { calls.routePoints++; },
    insertRoutePointOnSegment: () => { calls.routePoints++; },
    addSpecialTrackPoint: () => { calls.specialTracks++; },
    extendSelectedSpecialTrack: () => { calls.specialTracks++; },
    addDetourReplacementFreeStop: () => { calls.detours++; },
    addDetourManualRoutePoint: () => { calls.detours++; },
    addDetourDraftPoint: () => { calls.drafts++; },
    getTestContainer: () => container,
    getOrCreateHitTestDiagnostic: () => null,
    getOrCreateClickDiagnostic: () => null,
    hitTestEditorObject: () => { calls.hit++; return { featureType: hitFeatureType }; },
    setMapLibreTestSelection: () => { calls.selected++; },
    applyMapLibreEditorSelection: () => {},
    createEditorObjectAtMapLibrePoint: (_hit, event) => {
      if (state.handleEditorPointPlacement({ lat: 1, lng: 2 })) calls.placed.push(event.mode);
    },
    isMapLibreDraggablePointHit: hit => ['stop', 'routePoint'].includes(hit && hit.featureType),
    resolveEditorSelectionReference: () => ({ lat: 1, lon: 2 }),
    mapLibrePointerLngLat: () => ({ lat: 1, lng: 2 }),
    setMapLibreDragCursor: () => {},
    clearEditorHoverHighlight: () => {},
    closeMapLibreFeatureTooltip: () => {},
    applyEditorSelectionDragPreview: () => { calls.dragPreview++; },
    finishMapLibreObjectDrag: () => { calls.drag++; state.mapLibreObjectDragState = null; },
    suppressNextMapLibreClick: false,
    mapLibreEditorInteractionFocused: false,
    mapLibreObjectDragState: null,
    mapLibreObjectDragMouseDownHandler: null,
    mapLibreObjectDragMouseMoveHandler: null,
    mapLibreObjectDragMouseUpHandler: null,
    hitTestDiagnosticMoveHandler: null,
    hitTestDiagnosticClickHandler: null,
    hitTestDiagnosticFrame: null,
    pendingHitTestPoint: null
  };
  vm.createContext(state);
  vm.runInContext(`${placementSource}\n${dragSource}\n${guardSource}`, state);
  const fire = (name, target, mode = 'freeStop', clientX = 100) => {
    state.state.routeMode = mode;
    state.state.placementMode = mode === 'route' ? 'route' : 'freeStop';
    state.state.detourWizard = mode === 'detourBuildReplacement'
      ? { phase: 'buildReplacement', routingMode: 'street', manualInputMode: 'passThroughStop' }
      : null;
    const event = {
      target, mode, button: 0, clientX, clientY: 100,
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.propagationStopped = true; }
    };
    for (const listener of listeners.get(name) || []) listener(event);
    return event;
  };
  return { state, calls, fire, canvas, markerButton, mapControl, overlaidUi, outside,
    setHitFeatureType(value) { hitFeatureType = value; } };
}

test('Karten-Zielprüfung trennt Kartenfläche und Marker von UI und MapLibre-Controls', () => {
  const app = fixture();
  for (const target of [app.canvas, app.markerButton]) {
    assert.equal(app.state.isMapLibreEditorSurfaceEvent({ target }, app.canvas.parent), true);
  }
  for (const target of [app.mapControl, app.overlaidUi, app.outside('menu'), app.outside('modal')]) {
    assert.equal(app.state.isMapLibreEditorSurfaceEvent({ target }, app.canvas.parent), false);
  }
  assert.equal(app.state.isMapLibreEditorSurfaceEvent({ target: element('input', [], app.canvas.parent) }, app.canvas.parent), false);
});

test('Platzierungsmodi reagieren nur auf echte Kartenklicks, nicht auf überlagerndes UI', () => {
  const app = fixture();
  assert.equal(app.state.startHitTestDiagnostics(), true);
  const modes = ['freeStop', 'route', 'specialTrack', 'detourBuildReplacement', 'detourDraft'];
  const ui = ['main-menu', 'submenu', 'toolbar', 'route-data', 'sidebar', 'properties', 'stop-order', 'statistics', 'modal'];
  for (const mode of modes) {
    for (const name of ui) app.fire('click', app.outside(name), mode);
    const controlClick = app.fire('click', app.mapControl, mode);
    assert.equal(controlClick.defaultPrevented, false, 'MapLibre control remains usable');
    app.fire('click', app.overlaidUi, mode);
    assert.equal(app.calls.placed.length, modes.indexOf(mode), `${mode}: UI must not place`);
    app.fire('click', app.canvas, mode);
    assert.equal(app.calls.placed.at(-1), mode, `${mode}: map must place`);
  }
  app.fire('click', app.markerButton, 'select');
  assert.ok(app.calls.selected > 0, 'marker selection remains reachable');
  assert.equal(app.calls.placed.length, modes.length);
  assert.deepEqual([app.calls.stops, app.calls.routePoints, app.calls.specialTracks, app.calls.detours, app.calls.drafts],
    [1, 1, 1, 1, 1]);
});

test('UI-Mousedown startet keinen Kartendrag; Marker-Mousedown bleibt erlaubt', () => {
  const app = fixture();
  assert.equal(app.state.startMapLibreObjectDragging(), true);
  for (const name of ['main-menu', 'submenu', 'toolbar', 'sidebar', 'modal']) {
    app.fire('mousedown', app.outside(name));
  }
  app.fire('mousedown', app.mapControl);
  assert.equal(app.calls.panDisabled, 0);
  assert.equal(app.state.mapLibreObjectDragState, null);
  app.fire('mousedown', app.markerButton);
  assert.equal(app.calls.panDisabled, 1, 'marker drag still starts');
  assert.equal(app.state.mapLibreObjectDragState.hit.featureType, 'stop');
  app.fire('mousemove', app.markerButton, 'freeStop', 110);
  assert.equal(app.calls.dragPreview, 1);
  app.fire('mouseup', app.markerButton);
  assert.equal(app.calls.drag, 1);
  app.setHitFeatureType('routePoint');
  app.fire('mousedown', app.canvas);
  assert.equal(app.state.mapLibreObjectDragState.hit.featureType, 'routePoint');
  app.fire('mousemove', app.canvas, 'route', 110);
  assert.equal(app.calls.dragPreview, 2);
  app.fire('mouseup', app.canvas);
  assert.equal(app.calls.drag, 2);
});
