const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const routing = fs.readFileSync(path.join(root, 'js/editor.routing.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const events = fs.readFileSync(path.join(root, 'js/editor.events.js'), 'utf8');
const routingStart = routing.indexOf('let streetRouteProgressRunning = false;');
const routingEnd = routing.indexOf('async function buildStreetRouteFromStopsImpl()', routingStart);
const progressStart = api.indexOf('function setRouteLoadPhase(message)');
const progressEnd = api.indexOf('async function loadLineFromServer(', progressStart);
assert.ok(routingStart >= 0 && routingEnd > routingStart && progressStart >= 0 && progressEnd > progressStart);

function setup(mode = 'guidedStreet', failure = false) {
  let active = false;
  let runs = 0;
  let finishRouting;
  const gate = new Promise(resolve => { finishRouting = resolve; });
  const heading = { textContent: '' };
  const step = { textContent: '' };
  const actions = { classList: { toggle() {}, add() {} } };
  const cancel = { onclick: null };
  const statuses = [];
  const modal = {
    classList: {
      remove() { active = true; },
      add() { active = false; }
    }
  };
  const context = {
    document: { getElementById(id) {
      return id === 'routeLoadProgressModal' ? modal
        : id === 'routeLoadProgressTitle' ? heading
        : id === 'routeLoadProgressActions' ? actions
        : id === 'routeLoadProgressCancelBtn' ? cancel : step;
    } },
    requestAnimationFrame(callback) { setImmediate(callback); },
    state: { stops: [{}, {}], routingMode: mode },
    streetRoutingRunning: false,
    routingAbortController: null,
    normalizeEditorRoutingMode(value) { return value; },
    setStatus(...args) { statuses.push(args); },
    error() {},
    setImmediate,
    Promise
  };
  vm.runInNewContext(api.slice(progressStart, progressEnd) + '\n' +
    routing.slice(routingStart, routingEnd) + '\n' +
    'async function buildStreetRouteFromStopsImpl() { globalThis.mockRuns++; await globalThis.routingGate; if (globalThis.mockFailure) throw new Error("Routingfehler"); }\n' +
    'globalThis.testBuildStreetRouteFromStops = buildStreetRouteFromStops;', context);
  context.mockRuns = runs;
  context.routingGate = gate;
  context.mockFailure = failure;
  return { context, heading, step, cancel, statuses, get active() { return active; }, get runs() { return context.mockRuns; }, finishRouting, build: context.testBuildStreetRouteFromStops };
}

test('dieselbe Fortschrittskomponente deckt die zentrale Straßenroute und deren Aufrufer ab', () => {
  assert.match(routing, /showRouteProgress\("Straßenroute aufbauen"/);
  assert.match(routing, /Routensegmente werden verarbeitet: Abschnitt/);
  assert.match(routing, /setRouteLoadPhase\("Karte wird aktualisiert/);
  assert.match(events, /buildStreetRouteBtn\.addEventListener\("click"[\s\S]*?buildStreetRouteFromStops\(\)/);
  assert.match(events, /finishSpecialTrackBtn\.addEventListener\("click"[\s\S]*?buildStreetRouteFromStops\(\)/);
});

test('geführtes Straßenrouting zeigt sofort Arbeit an und verhindert Doppelauslösung', async () => {
  const app = setup();
  const first = app.build();
  assert.equal(app.active, true);
  assert.equal(app.heading.textContent, 'Straßenroute aufbauen');
  assert.match(app.step.textContent, /Fahrwegpunkte werden vorbereitet/);
  const second = app.build();
  app.finishRouting();
  await Promise.all([first, second]);
  assert.equal(app.runs, 1);
  assert.equal(app.active, false);
});

test('Fehler beendet den Dialog und zeigt die bisherige Fehlermeldung', async () => {
  const app = setup('street', true);
  const work = app.build();
  app.finishRouting();
  await work;
  assert.equal(app.active, false);
  assert.ok(app.statuses.some(([message, kind]) => message === 'Fehler beim Straßenrouting: Routingfehler' && kind === 'error'));
});

test('Abbruch vor Berechnungsbeginn verhindert den Start und schließt den Dialog', async () => {
  const app = setup();
  const work = app.build();
  app.cancel.onclick();
  await work;
  assert.equal(app.runs, 0);
  assert.equal(app.active, false);
});

test('Punktführung ohne längere Straßenberechnung behält ihren bisherigen Pfad', async () => {
  const app = setup('manual');
  const work = app.build();
  assert.equal(app.active, false);
  app.finishRouting();
  await work;
  assert.equal(app.runs, 1);
});
