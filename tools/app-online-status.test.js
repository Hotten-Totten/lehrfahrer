const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app/js/app.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'app/sw.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const start = appSource.indexOf('function detectOffline() {');
const end = appSource.indexOf('// ── Events binden', start);
assert.ok(start >= 0 && end > start);
const detectionSource = appSource.slice(start, end);

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
    window: { addEventListener(name, handler) { handlers[name] = handler; } },
    AbortSignal: { timeout(ms) { assert.equal(ms, 4000); return { timeoutMs: ms }; } },
    fetch(url, options) { calls.push({ url, options }); return fetchImpl(url, options); }
  });
  vm.runInContext(`${detectionSource}\ndetectOffline();`, context);
  return { badge, handlers, calls, lineStates };
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
    self: { addEventListener(name, handler) { handlers[name] = handler; } }
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

test('Verbindungscheck umgeht den Service-Worker-Cache; übriger API-Offline-Fallback bleibt', async () => {
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
  assert.equal((await workerRequest(handlers.fetch, 'https://example.test/api/list_lines.php?scope=driver')).source, 'offline-cache');
  assert.deepEqual(cacheCalls, ['match']);
});

test('App und Service Worker laden denselben neuen App-Scriptstand', () => {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  const hash = crypto.createHash('sha256').update(appSource.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const scriptKey = `js/app.js?v=${version}-${hash}`;
  const cacheKey = `lehrfahrer-app-v${version.slice(1).replaceAll('.', '')}-${hash}`;
  assert.ok(appHtml.includes(`id="versionBadge" class="version-badge" title="App-Version">${version}</span>`));
  assert.ok(appHtml.includes(scriptKey));
  assert.ok(workerSource.includes(`./${scriptKey}`));
  assert.ok(workerSource.includes(cacheKey));
});
