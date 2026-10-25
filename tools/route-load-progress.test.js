const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'editor.css'), 'utf8');
const start = api.indexOf('let routeLoadInProgress = false;');
const end = api.indexOf('// Löscht eine Linie vom Server', start);
assert.ok(start >= 0 && end > start);
const source = api.slice(start, end) + '\nglobalThis.testLoadLineFromServer = loadLineFromServer;';

function setup(payload, responseOk = true) {
  const modalClasses = new Set(['hidden']);
  const modal = {
    classList: {
      add(name) { modalClasses.add(name); },
      remove(name) { modalClasses.delete(name); },
      contains(name) { return modalClasses.has(name); }
    }
  };
  const step = { textContent: '' };
  const heading = { textContent: '' };
  const actions = { classList: { toggle() {}, add() {} } };
  const cancel = { onclick: null };
  const statuses = [];
  const loaded = [];
  let fetchCount = 0;
  let finishFetch;
  const fetchGate = new Promise(resolve => { finishFetch = resolve; });
  const context = {
    document: { getElementById(id) {
      return id === 'routeLoadProgressModal' ? modal
        : id === 'routeLoadProgressTitle' ? heading
        : id === 'routeLoadProgressActions' ? actions
        : id === 'routeLoadProgressCancelBtn' ? cancel : step;
    } },
    requestAnimationFrame(callback) { setImmediate(callback); },
    fetch: async () => {
      fetchCount++;
      await fetchGate;
      return { ok: responseOk, text: async () => JSON.stringify(payload) };
    },
    API_LOAD_LINE_URL: '/api/load_line.php',
    withApiAuthHeaders: value => value,
    citySelect: { value: 'cottbus' },
    loadLineFromData: value => { loaded.push(value); },
    setStatus: (...value) => statuses.push(value),
    error() {},
    debug() {},
    setImmediate,
    Promise,
    String,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(source, context);
  return { modal, step, statuses, loaded, get fetchCount() { return fetchCount; }, finishFetch, load: context.testLoadLineFromServer };
}

test('bestehendes Design zeigt einen unbestimmten, barrierefrei beschrifteten Ladezustand', () => {
  assert.match(html, /id="routeLoadProgressModal"[^>]*role="dialog"/);
  assert.match(html, /id="routeLoadProgressStep"[^>]*aria-live="polite"/);
  assert.match(html, /role="progressbar"[^>]*aria-valuetext="Fortschritt nicht numerisch bestimmbar"/);
  assert.doesNotMatch(html, /id="routeLoadProgressModal"[\s\S]*?role="progressbar"[^>]*aria-valuenow=/);
  assert.match(css, /\.route-load-progress-indicator[\s\S]*?animation: route-load-progress/);
});

test('Route 01 und punktreiche Route 02 laden einmalig und unverändert', async () => {
  for (const [route, stops, points] of [['01', 20, 0], ['02', 19, 1000]]) {
    const line = { stops: Array.from({ length: stops }, (_, i) => ({ name: `Stop ${i}` })), routePoints: Array.from({ length: points }, (_, i) => ({ lat: i, lon: i })) };
    const initial = JSON.stringify(line);
    const app = setup({ ok: true, line });
    const first = app.load(`Route_${route}`, 'Linie_16', 'cottbus', 'Standard');
    assert.equal(app.modal.classList.contains('hidden'), false, 'sofort sichtbar');
    assert.match(app.step.textContent, /Routendaten/);
    const second = app.load(`Route_${route}`, 'Linie_16', 'cottbus', 'Standard');
    app.finishFetch();
    await Promise.all([first, second]);
    assert.equal(app.fetchCount, 1, 'kein Doppelladen');
    assert.equal(app.loaded.length, 1);
    assert.equal(JSON.stringify(app.loaded[0]), initial);
    assert.equal(JSON.stringify(line), initial, 'Routendaten bleiben unverändert');
    assert.equal(app.loaded[0].stops.length, stops);
    assert.equal(app.loaded[0].routePoints.length, points);
    assert.equal(app.modal.classList.contains('hidden'), true);
    assert.equal(app.step.textContent, 'Route ist bereit');
  }
});

test('Fehler beendet Anzeige und erlaubt erneuten Ladeversuch', async () => {
  const app = setup({ ok: false, error: 'Testfehler' }, false);
  const first = app.load('Route_01');
  app.finishFetch();
  await first;
  assert.equal(app.modal.classList.contains('hidden'), true);
  assert.ok(app.statuses.some(([message, kind]) => message === 'Testfehler' && kind === 'error'));
  await app.load('Route_01');
  assert.equal(app.fetchCount, 2);
});
