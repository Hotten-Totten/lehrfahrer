const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const autosave = fs.readFileSync(path.join(root, 'js/editor.autosave.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'js/editor.main.js'), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} fehlt`);
  return source.slice(from, to);
}

function harness() {
  const calls = { confirms: 0, saves: [], loads: [], toasts: [] };
  const settings = { target: null, existing: false, saveOk: true, saveFileBase: null, confirmOk: true, changeType: null };
  const state = { loadedServerRouteSource: null, stops: [], routePoints: [] };
  const context = {
    state, console,
    citySelect: { value: 'cottbus' }, lineNameInput: { value: '16' },
    routeNameInput: { value: '01' }, directionNameInput: { value: 'Nord' },
    localStorage: { setItem() {} },
    buildExportData: () => ({ routePoints: [[51.7, 14.3], [51.71, 14.31]], ...settings.target }),
    showSaveConfirmDialog: async () => settings.target && ({
      city: settings.target.city, lineSuffix: '16', routeSuffix: '01',
      variantName: 'Nord', variantCategory: 'Standard', directionName: 'Nord'
    }),
    setVariantName() {}, setVariantCategory() {}, setLineDescription() {},
    setLineValidity() {}, loadCityDispatchPhoneSetting() {}, setStatus() {},
    findExistingLineEntry: async () => settings.existing ? {} : null,
    confirm: () => { calls.confirms++; return settings.confirmOk; },
    withApiAuthHeaders: value => value,
    API_SAVE_LINE_URL: '/api/save_line.php', API_LOAD_LINE_URL: '/api/load_line.php',
    fetch: async (url, options) => {
      if (url.startsWith('/api/save_line.php')) {
        const payload = JSON.parse(options.body);
        calls.saves.push(payload);
        return { ok: settings.saveOk, json: async () => settings.saveOk
          ? { ok: true, fileBase: settings.saveFileBase || payload.fileBase, changeType: settings.changeType }
          : { ok: false, error: 'Testfehler' } };
      }
      calls.loads.push(url);
      return { ok: true, text: async () => JSON.stringify({ ok: true, line: { stops: [], routePoints: [] } }) };
    },
    buildGpxString: () => '<gpx/>', saveGpxToServer: async () => ({ ok: true }),
    showSaveToast(info) { calls.toasts.push(info); }, debug() {}, warn() {}, error() {},
    showRouteProgress() {}, hideRouteProgress() {}, setRouteLoadPhase() {},
    waitForRouteLoadPaint: async () => {},
    loadLineFromData: () => { state.loadedServerRouteSource = null; },
    setRouteDataExpanded() {}
  };
  vm.createContext(context);
  vm.runInContext(`let routeLoadInProgress = false;\n${section('function routeStorageIdentity(', '// Zeigt den Speichern-Dialog')}\n${section('async function _doSaveLineToServer(', 'let vbbImportAutoCloseTimer')}\n${section('async function loadLineFromServer(', '// Löscht eine Linie')}`, context);
  return { calls, settings, state, context };
}

const own = { city: 'cottbus', lineFolder: 'Linie_16', categoryFolder: 'Standard', fileBase: 'Route_01_Nord' };

test('Save reicht changeType an denselben Erfolgstoast weiter', async () => {
  const h = harness();
  h.settings.target = own;
  for (const changeType of ['NEW', 'UNCHANGED', 'CHANGED', undefined, 'UNKNOWN']) {
    h.settings.changeType = changeType;
    await h.context.saveLineToServer();
  }
  assert.deepEqual(h.calls.toasts.map(info => info.changeType),
    ['NEW', 'UNCHANGED', 'CHANGED', undefined, 'UNKNOWN']);
  assert.equal(h.calls.toasts.length, 5);
  assert.ok(h.calls.toasts.every(info => info.fileBase === own.fileBase && info.gpxSaved));
});

test('Dauerhaft deaktivierter Arbeitsstatus ist passiv; laufender Status-Request zeigt wait', () => {
  const css = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');
  assert.match(css, /\.gtfs-work-row select:disabled\s*\{\s*cursor:\s*default;\s*\}/);
  assert.match(css, /\.gtfs-work-row select:disabled\.gtfs-work-status-pending\s*\{\s*cursor:\s*wait;\s*\}/);
  assert.match(css, /\.gtfs-work-row button:disabled\s*\{\s*cursor:\s*wait;\s*\}/);
});

test('Geladene Route speichert identisches Ziel mit und ohne fachliche Änderung ohne Überschreiben-Warnung', async () => {
  const h = harness();
  await h.context.loadLineFromServer(own.fileBase, own.lineFolder, own.city, own.categoryFolder);
  assert.deepEqual({ ...h.state.loadedServerRouteSource }, own);
  h.settings.target = own;
  h.settings.existing = true;
  await h.context.saveLineToServer();
  h.settings.target = { ...own, routePoints: [[51.72, 14.32]] };
  await h.context.saveLineToServer();
  assert.equal(h.calls.confirms, 0);
  assert.deepEqual(h.calls.saves.map(save => save.forceOverwrite), [true, true]);
  assert.notDeepEqual(h.calls.saves[0].routePoints, h.calls.saves[1].routePoints);
});

test('Neue und fremde Zielkollision warnen; fehlende Ladeidentität warnt ebenfalls', async () => {
  const h = harness();
  h.settings.target = own;
  h.settings.existing = true;
  await h.context.saveLineToServer();
  assert.equal(h.calls.confirms, 1);
  h.state.loadedServerRouteSource = { ...own, categoryFolder: '' };
  await h.context.saveLineToServer();
  assert.equal(h.calls.confirms, 2);
  h.state.loadedServerRouteSource = { ...own };
  h.settings.target = { ...own, fileBase: 'Route_02_Nord' };
  await h.context.saveLineToServer();
  assert.equal(h.calls.confirms, 3);
});

test('Neues Projekt löscht Quelle und andere Serverroute ersetzt sie', async () => {
  const h = harness();
  await h.context.loadLineFromServer(own.fileBase, own.lineFolder, own.city, own.categoryFolder);
  await h.context.loadLineFromServer('Route_02_Nord', own.lineFolder, own.city, own.categoryFolder);
  assert.equal(h.state.loadedServerRouteSource.fileBase, 'Route_02_Nord');
  const clear = autosave.match(/function clearEditorData\(\) \{[\s\S]*?^\}/m);
  assert.ok(clear);
  const reset = {
    state: { ...h.state, stops: [], routePoints: [], simplifiedRoutePoints: [], specialTracks: [] },
    window: { EditorTestDrive: { stop() {} }, EditorMapAdapter: { usesLeafletOverlays: () => false } },
    clearEditorSelectionStateOnly() {}, setLineValidity() {},
    routeLine: null, simplifiedPreviewLine: null
  };
  vm.createContext(reset);
  vm.runInContext(`${clear[0]}; clearEditorData();`, reset);
  assert.equal(reset.state.loadedServerRouteSource, null);
  assert.match(main, /pushHistorySnapshot\("Neue Linie erstellt"\);[\s\S]*?clearEditorData\(\);/);
});

test('Erfolgreicher erster Save setzt tatsächliches Ziel; Abbruch und Fehler ändern Quelle nicht', async () => {
  const h = harness();
  h.settings.target = own;
  h.settings.saveFileBase = 'Route_01_Nord_02';
  await h.context.saveLineToServer();
  assert.equal(h.state.loadedServerRouteSource.fileBase, 'Route_01_Nord_02');
  h.settings.target = { ...own, fileBase: 'Route_01_Nord_02' };
  h.settings.existing = true;
  h.settings.saveFileBase = null;
  await h.context.saveLineToServer();
  assert.equal(h.calls.confirms, 0);
  const savedSource = { ...h.state.loadedServerRouteSource };
  h.settings.target = null;
  await h.context.saveLineToServer();
  assert.deepEqual({ ...h.state.loadedServerRouteSource }, savedSource);
  h.settings.target = { ...own, fileBase: 'Route_Cancel' };
  h.settings.existing = true;
  h.settings.confirmOk = false;
  const savedCount = h.calls.saves.length;
  await h.context.saveLineToServer();
  assert.deepEqual({ ...h.state.loadedServerRouteSource }, savedSource);
  assert.equal(h.calls.saves.length, savedCount);
  h.settings.target = { ...own, fileBase: 'Route_Fail' };
  h.settings.saveOk = false;
  h.settings.confirmOk = true;
  await h.context.saveLineToServer();
  assert.deepEqual({ ...h.state.loadedServerRouteSource }, savedSource);
});

test('Nur vollständige Pfadidentität erlaubt eine warnungsfreie Kollision', () => {
  const h = harness();
  h.state.loadedServerRouteSource = { ...own };
  assert.equal(h.context.isLoadedServerRouteTarget(h.context.routeStorageIdentity(...Object.values(own))), true);
  for (const key of Object.keys(own)) {
    assert.equal(h.context.isLoadedServerRouteTarget({ ...own, [key]: 'anders' }), false);
  }
  assert.equal(h.context.routeStorageIdentity(own.city, own.lineFolder, '', own.fileBase), null);
});

test('Ladequelle bleibt ausschließlich Editorzustand und gelangt nicht in Route oder Autosave', () => {
  assert.doesNotMatch(section('function buildExportData()', '// Exportiert die aktuelle Linie'), /loadedServerRouteSource/);
  assert.doesNotMatch(autosave.slice(autosave.indexOf('function buildAutosaveData()'), autosave.indexOf('// Speichert die aktuellen Daten')), /loadedServerRouteSource/);
});

test('Geänderte Scripts besitzen passende Cache-Schlüssel', () => {
  for (const file of ['js/editor.state.js', 'js/editor.autosave.js', 'js/editor.api.js']) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 12);
    assert.ok(editor.includes(`${file}?v=${hash}`), `${file} Cache-Schlüssel ${hash} fehlt`);
  }
});
