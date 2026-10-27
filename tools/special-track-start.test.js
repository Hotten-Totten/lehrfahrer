const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'js/editor.route.js'), 'utf8');
const events = fs.readFileSync(path.join(root, 'js/editor.events.js'), 'utf8');
const startCode = route.slice(route.indexOf('function startSpecialTrackBetweenSelectedStops()'));
assert.ok(startCode.startsWith('function startSpecialTrackBetweenSelectedStops()'));

const stops = ['A', 'B', 'C', 'D'].map(id => ({ id, name: id }));

function setup(ids, routeStops = stops) {
  const notices = [];
  const modeChanges = [];
  const state = {
    stops: routeStops,
    selectedStopIds: new Set(ids),
    routeMode: 'freeStop',
    currentSpecialTrack: { id: 'existing', points: [[1, 2]] },
    routePoints: [{ id: 'point', lat: 1, lon: 2 }],
    specialTracks: [{ id: 'saved', points: [[3, 4]] }]
  };
  const app = {
    state,
    showInfoPopup(notice) { notices.push(notice); },
    setMode(mode) { modeChanges.push(mode); state.routeMode = mode; },
    updateModeButtons() {},
    debug() {},
    setStatus() {}
  };
  vm.runInNewContext(startCode + '\nglobalThis.start = startSpecialTrackBetweenSelectedStops;', app);
  return { app, state, notices, modeChanges };
}

function assertRejected(ids, routeStops = stops) {
  const { app, state, notices, modeChanges } = setup(ids, routeStops);
  const before = structuredClone({
    routeMode: state.routeMode,
    selectedStopIds: [...state.selectedStopIds],
    currentSpecialTrack: state.currentSpecialTrack,
    routePoints: state.routePoints,
    specialTracks: state.specialTracks
  });
  app.start();
  assert.deepEqual({
    routeMode: state.routeMode,
    selectedStopIds: [...state.selectedStopIds],
    currentSpecialTrack: state.currentSpecialTrack,
    routePoints: state.routePoints,
    specialTracks: state.specialTracks
  }, before);
  assert.deepEqual(modeChanges, []);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, 'Bitte genau zwei direkt aufeinanderfolgende Haltestellen auswählen.');
}

test('Ohne Auswahl startet keine Sondertrasse und der Editorzustand bleibt unveraendert', () => {
  assertRejected([]);
});

test('Eine Auswahl startet keine Sondertrasse und der Editorzustand bleibt unveraendert', () => {
  assertRejected(['B']);
});

test('Nicht benachbarte Haltestellen werden ohne Zustandsaenderung abgewiesen', () => {
  assertRejected(['A', 'C']);
});

test('Fehlende und doppelte Stop-IDs werden abgewiesen', () => {
  assertRejected(['B', 'missing']);
  assertRejected(['B', 'C'], [stops[1], stops[1], stops[2]]);
});

test('Zwei benachbarte Haltestellen starten in Routenreihenfolge', () => {
  for (const ids of [['B', 'C'], ['C', 'B']]) {
    const { app, state, notices, modeChanges } = setup(ids);
    app.start();
    assert.deepEqual(modeChanges, ['specialTrack']);
    assert.equal(state.routeMode, 'specialTrack');
    assert.equal(state.currentSpecialTrack.fromStopId, 'B');
    assert.equal(state.currentSpecialTrack.toStopId, 'C');
    assert.deepEqual(Array.from(state.currentSpecialTrack.points), []);
    assert.deepEqual(notices, []);
    assert.deepEqual(state.routePoints, [{ id: 'point', lat: 1, lon: 2 }]);
    assert.deepEqual(state.specialTracks, [{ id: 'saved', points: [[3, 4]] }]);
  }
});

test('Button startet nur die validierende Funktion; kein vorheriges setMode', () => {
  assert.match(events, /startTrackBetweenStopsBtn\.addEventListener\("click", function \(\) \{\s*startSpecialTrackBetweenSelectedStops\(\);\s*\}\)/);
});
