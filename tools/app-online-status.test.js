const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app/js/app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'app/css/app.css'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'app/sw.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const start = appSource.indexOf('function detectOffline() {');
const end = appSource.indexOf('// ── Events binden', start);
assert.ok(start >= 0 && end > start);
const detectionSource = appSource.slice(start, end);
const catalogStart = appSource.indexOf('async function fetchLinesCatalogFromServer() {');
const catalogEnd = appSource.indexOf('async function fetchLineRecordFromServer(', catalogStart);
assert.ok(catalogStart >= 0 && catalogEnd > catalogStart);
const catalogSource = appSource.slice(catalogStart, catalogEnd);

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

function detectionFixture(fetchImpl) {
  const classes = new Set(['hidden']);
  const badge = {
    textContent: '● Offline', title: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const handlers = {};
  const calls = [];
  const lineStates = [];
  const context = vm.createContext({
    API_BASE: '../api', offlineBadge: badge, Date,
    availableLinesCatalog: [{ id: 'cached-line' }],
    renderLineDataStatus(state, count) { lineStates.push([state, count]); },
    deduplicateLinesCatalog: lines => lines,
    window: { addEventListener(name, handler) { handlers[name] = handler; } },
    AbortSignal: { timeout(ms) { assert.equal(ms, 4000); return { timeoutMs: ms }; } },
    fetch(url, options) { calls.push({ url, options }); return fetchImpl(url, options); }
  });
  vm.runInContext(`${detectionSource}\ndetectOffline();`, context);
  return { badge, handlers, calls, lineStates, context };
}

function response(status, payload = { ok: true, cities: ['cottbus'] }) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

test('gültige Session und routes.read ergeben Online per authentifiziertem GET', async () => {
  const fixture = detectionFixture(async () => response(200));
  await settle();
  assert.equal(fixture.badge.classList.contains('hidden'), true);
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0].url, /^\.\.\/api\/list_cities\.php\?lf-connection-check=\d+$/);
  assert.equal(fixture.calls[0].options.method, 'GET');
  assert.equal(fixture.calls[0].options.credentials, 'same-origin');
  assert.equal(fixture.calls[0].options.cache, 'no-store');
  assert.equal(fixture.calls[0].options.signal.timeoutMs, 4000);
});

test('Online-Zustand verbirgt das Statuslabel tatsächlich über die App-CSS-Regel', async () => {
  const fixture = detectionFixture(async () => response(200));
  await settle();
  assert.equal(fixture.badge.classList.contains('hidden'), true);
  assert.match(appCss, /#offlineBadge\.hidden\s*\{\s*display:\s*none\s*;\s*\}/);
});

test('nach 200 bleibt der Serverstatus auch bei späterem Katalogfehler online', async () => {
  let catalogStatus = 200;
  const fixture = detectionFixture(async url => url.includes('list_cities.php')
    ? response(200) : response(catalogStatus, { ok: true, lines: [{ id: 'route' }] }));
  vm.runInContext(catalogSource, fixture.context);
  await settle();
  assert.equal((await vm.runInContext('fetchLinesCatalogFromServer()', fixture.context)).length, 1);
  assert.equal(fixture.badge.classList.contains('hidden'), true);
  catalogStatus = 403;
  await assert.rejects(vm.runInContext('fetchLinesCatalogFromServer()', fixture.context), /HTTP 403/);
  assert.equal(fixture.badge.classList.contains('hidden'), true);
  assert.equal(fixture.calls.filter(call => call.url.includes('list_lines.php')).length, 2);
});

test('Netzwerkfehler und Timeout zeigen Offline', async () => {
  for (const name of ['TypeError', 'TimeoutError']) {
    const fixture = detectionFixture(async () => { const error = new Error(name); error.name = name; throw error; });
    await settle();
    assert.equal(fixture.badge.textContent, '● Offline');
    assert.equal(fixture.badge.classList.contains('hidden'), false);
    assert.deepEqual(fixture.lineStates, [['offline', 1]]);
  }
});

test('401, 403, 405 und 5xx werden nicht als normaler Onlinezustand angezeigt', async () => {
  const cases = [
    [401, '● Anmeldung erforderlich'],
    [403, '● Zugriff verweigert'],
    [405, '● Serverfehler'],
    [503, '● Serverfehler']
  ];
  for (const [status, label] of cases) {
    const fixture = detectionFixture(async () => response(status));
    await settle();
    assert.equal(fixture.badge.textContent, label);
    assert.equal(fixture.badge.classList.contains('hidden'), false);
  }
});

test('ungültige API-Antwort bleibt sichtbar; Browser-Offline-Ereignis prüft den Server erneut', async () => {
  let payload = { ok: false };
  const fixture = detectionFixture(async () => response(200, payload));
  await settle();
  assert.equal(fixture.badge.textContent, '● Serverfehler');
  payload = { ok: true, cities: [] };
  await fixture.handlers.offline();
  assert.equal(fixture.badge.classList.contains('hidden'), true);
});

test('älterer Timeout überschreibt keinen neueren erfolgreichen Verbindungscheck', async () => {
  let rejectFirst;
  let calls = 0;
  const fixture = detectionFixture(async () => {
    calls++;
    if (calls === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
    return response(200);
  });
  await fixture.handlers.online();
  rejectFirst(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
  await settle();
  assert.equal(fixture.badge.classList.contains('hidden'), true);
  assert.deepEqual(fixture.lineStates, []);
});

function workerFixture(fetchImpl, cacheImpl) {
  const handlers = {};
  const context = vm.createContext({
    URL, fetch: fetchImpl, caches: cacheImpl,
    Response: class { constructor(body, options) { this.body = body; this.status = options.status; } },
    self: { registration: { scope: 'https://example.test/app/' },
      addEventListener(name, handler) { handlers[name] = handler; } }
  });
  vm.runInContext(workerSource, context);
  return handlers;
}

function workerRequest(handler, url) {
  let result;
  const request = { url, clone() { return this; } };
  handler({ request, respondWith(promise) { result = promise; } });
  assert.ok(result);
  return result;
}

test('API- und Tenant-Ressourcen nutzen keinen gemeinsamen Offline-Cache', async () => {
  const cacheCalls = [];
  const cached = { ok: true, source: 'offline-cache' };
  let networkAvailable = true;
  const handlers = workerFixture(
    async () => { if (!networkAvailable) throw new TypeError('network down'); return { ok: true, source: 'network' }; },
    { match: async () => { cacheCalls.push('match'); return cached; }, open: async () => ({ put() {} }) }
  );
  const probe = 'https://example.test/api/list_cities.php?lf-connection-check=1';
  assert.equal((await workerRequest(handlers.fetch, probe)).source, 'network');
  networkAvailable = false;
  await assert.rejects(workerRequest(handlers.fetch, probe), /network down/);
  assert.deepEqual(cacheCalls, []);
  await assert.rejects(workerRequest(handlers.fetch, 'https://example.test/api/list_lines.php?scope=driver'), /network down/);
  await assert.rejects(workerRequest(handlers.fetch, 'https://example.test/liniendaten/cottbus/route.json'), /network down/);
  assert.deepEqual(cacheCalls, []);
  assert.equal((await workerRequest(handlers.fetch, 'https://example.test/app/index.html')).source, 'offline-cache');
  assert.deepEqual(cacheCalls, ['match']);
});

test('App und Service Worker laden denselben neuen App-Scriptstand', () => {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const hash = crypto.createHash('sha256').update(appSource.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const cssHash = crypto.createHash('sha256').update(appCss.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const scriptKey = `js/app.js?v=${version}-${hash}`;
  const cssKey = `css/app.css?v=V2.1.063-${cssHash}`;
  const cacheKey = `lehrfahrer-app-v${version.slice(1).replaceAll('.', '')}-${hash}-${cssHash}`;
  assert.ok(appHtml.includes(`id="versionBadge" class="version-badge" title="App-Version">${version}</span>`));
  assert.ok(appHtml.includes(scriptKey));
  assert.ok(appHtml.includes(cssKey));
  assert.ok(workerSource.includes(`./${cssKey}`));
  assert.ok(workerSource.includes(`./${scriptKey}`));
  assert.ok(workerSource.includes(cacheKey));
});
