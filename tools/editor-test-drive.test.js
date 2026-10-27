const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/editor.test-drive.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');

function harness(points, engine = 'maplibre') {
  const frames = new Map(), markers = [], notices = [];
  let nextFrame = 1;
  const routePoints = points.map(([lat, lon]) => ({ lat, lon }));
  const state = { routePoints, specialTracks: [{ id: 'track', points: [[1, 2]] }] };
  const before = JSON.stringify(state);
  const bar = { hidden: true, querySelectorAll() { return []; } };
  const pause = { textContent: '', disabled: false };
  const follow = { setAttribute() {}, classList: { toggle() {} } };
  const controls = { testDriveControls: bar, testDrivePauseBtn: pause, testDriveFollowBtn: follow };
  let projected = { x: 500, y: 400 };
  const map = {
    getContainer() { return { clientWidth: 1000, clientHeight: 800 }; },
    handlers: {}, pans: [],
    on(name, fn) { this.handlers[name] = fn; },
    off(name) { delete this.handlers[name]; },
    panTo(...args) { this.pans.push(args); }
  };
  const svg = { style: { setProperty(name, value) { this[name] = value; } } };
  const element = () => ({ className: '', innerHTML: '', style: {}, querySelector() { return svg; } });
  class MapLibreMarker {
    constructor(options) { markers.push(this); this.element = options.element; }
    setLngLat(point) { this.position = point; return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
  }
  const leaflet = {
    divIcon(options) { return options; },
    marker(point) {
      const marker = {
        position: point,
        setLatLng(value) { this.position = value; },
        addTo() { return this; },
        getElement() { return element(); },
        remove() { this.removed = true; }
      };
      markers.push(marker);
      return marker;
    }
  };
  const win = {
    EditorMapAdapter: {
      getActiveMapEngine() { return engine; },
      getActiveMap() { return map; },
      projectEditorCoordinate() { return projected; }
    },
    maplibregl: { Marker: MapLibreMarker }, L: leaflet,
    requestAnimationFrame(fn) { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {}
  };
  const context = {
    window: win, state,
    document: { getElementById(id) { return controls[id] || null; }, createElement: element },
    distanceMetersBetween(a, b) { return Math.hypot(b.lat - a.lat, b.lon - a.lon) * 100; },
    showInfoPopup(message) { notices.push(message); },
    setStatus() {},
    Date
  };
  vm.runInNewContext(source, context);
  function frame(timestamp) {
    const next = frames.entries().next().value;
    assert.ok(next, 'animation frame expected');
    frames.delete(next[0]);
    next[1](timestamp);
  }
  return { api: win.EditorTestDrive, state, before, markers, frames, notices, bar, pause, frame,
    map, setProjected(value) { projected = value; } };
}

test('Route-Menü und lokale schematische Busdarstellung sind vorhanden', () => {
  assert.match(html, /id="startTestDriveBtn"[^>]*>Testfahrt starten</);
  assert.match(html, /id="testDriveControls"/);
  assert.match(html, /js\/editor\.test-drive\.js\?v=/);
  assert.match(css, /\.test-drive-bus-marker/);
  assert.match(source, /<svg class="test-drive-bus-rotor"/);
  assert.doesNotMatch(source, /https?:\/\/|fetch\s*\(/);
});

test('Normale Route: streckenbasierte Zwischenposition und Endpunkt ohne Originalmutation', () => {
  const app = harness([[0, 0], [0, 1]]);
  assert.equal(app.api.start(), true);
  assert.equal(app.markers[0].element.style.pointerEvents, 'none');
  app.frame(0);
  app.frame(1000);
  assert.deepEqual(Array.from(app.markers[0].position), [0.5, 0]);
  assert.equal(app.markers[0].element.querySelector('svg').style.transform, 'rotate(90deg)');
  app.frame(2000);
  assert.deepEqual(Array.from(app.markers[0].position), [1, 0]);
  assert.equal(app.api.getState().finished, true);
  assert.equal(app.bar.hidden, false);
  assert.equal(JSON.stringify(app.state), app.before);
});

test('Haken und Sondertrasse in routePoints werden ohne Korrektur exakt abgefahren', () => {
  const app = harness([[0, 0], [0, 1], [0, 0], [0, 2]]);
  const snapshot = app.api.copyGeometry(app.state.routePoints);
  assert.equal(app.api.positionAt(snapshot, 100).lon, 1);
  assert.equal(app.api.positionAt(snapshot, 150).lon, 0.5);
  assert.equal(app.api.positionAt(snapshot, 200).lon, 0);
  assert.equal(app.api.positionAt(snapshot, 300).lon, 1);
  app.api.start();
  app.frame(0);
  app.frame(2000);
  assert.deepEqual(Array.from(app.markers[0].position), [1, 0]);
  app.frame(3000);
  assert.deepEqual(Array.from(app.markers[0].position), [0.5, 0]);
  assert.equal(JSON.stringify(app.state), app.before);
});

test('Pause, Weiter und Geschwindigkeitswechsel bewahren die Position', () => {
  const app = harness([[0, 0], [0, 10]]);
  app.api.start();
  app.frame(0);
  app.frame(1000);
  const beforePause = app.api.getState().meters;
  app.api.togglePause();
  assert.equal(app.frames.size, 0);
  assert.equal(app.api.getState().meters, beforePause);
  app.api.togglePause();
  app.frame(10000);
  assert.equal(app.api.getState().meters, beforePause);
  app.api.setSpeed(2);
  app.frame(11000);
  assert.equal(app.api.getState().meters, beforePause);
  app.frame(12000);
  assert.equal(app.api.getState().meters, beforePause + 100);
  app.api.setSpeed(0.5);
  assert.equal(app.api.getState().meters, beforePause + 100);
});

test('Doppelte Punkte und unbrauchbare Geometrie werden sicher behandelt', () => {
  const app = harness([[0, 0], [0, 0], [0, 1], [0, 1]]);
  assert.equal(app.api.start(), true);
  app.frame(0);
  app.frame(1000);
  assert.deepEqual(Array.from(app.markers[0].position), [0.5, 0]);
  assert.equal(harness([[0, 0], [0, 0]]).api.start(), false);
  assert.equal(harness([[0, 0]]).api.start(), false);
});

test('Beenden und Geometriewechsel entfernen Marker, Frame und Zustand', () => {
  const app = harness([[0, 0], [0, 1]]);
  app.api.start();
  app.api.stop();
  assert.equal(app.markers[0].removed, true);
  assert.equal(app.frames.size, 0);
  assert.equal(app.api.getState(), null);
  assert.equal(app.bar.hidden, true);
  app.api.start();
  app.state.routePoints[1].lon = 5;
  app.frame(0);
  app.frame(1000);
  assert.deepEqual(Array.from(app.markers[1].position), [0.5, 0]);
  app.state.routePoints = [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }];
  app.api.onRouteRender();
  assert.equal(app.api.getState(), null);
  assert.equal(app.markers[1].removed, true);
});

test('Erneuter Start nutzt eine frische Kopie und der Leaflet-Fallback räumt auf', () => {
  const app = harness([[0, 0], [0, 1]], 'leaflet');
  app.api.start();
  assert.deepEqual(Array.from(app.markers[0].position), [0, 0]);
  app.api.start();
  assert.equal(app.markers[0].removed, true);
  assert.equal(app.markers.length, 2);
  app.api.stop();
  assert.equal(app.markers[1].removed, true);
  assert.equal(JSON.stringify(app.state), app.before);
});

test('Karte folgt nur bei Bedarf und manuelles Verschieben schaltet Folgen ab', () => {
  const app = harness([[0, 0], [0, 10]]);
  app.api.start();
  assert.equal(app.map.pans.length, 0);
  app.setProjected({ x: 950, y: 400 });
  app.frame(0);
  assert.equal(app.map.pans.length, 1);
  app.map.handlers.dragstart();
  assert.equal(app.api.getState().follow, false);
  app.frame(1000);
  assert.equal(app.map.pans.length, 1);
  app.api.stop();
  assert.equal(app.map.handlers.dragstart, undefined);
});
