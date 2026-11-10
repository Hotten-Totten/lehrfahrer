const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mapSource = fs.readFileSync(path.resolve(__dirname, '../app/js/map.js'), 'utf8');
const appHtml = fs.readFileSync(path.resolve(__dirname, '../app/index.html'), 'utf8');
const appCss = fs.readFileSync(path.resolve(__dirname, '../app/css/app.css'), 'utf8');
const serviceWorker = fs.readFileSync(path.resolve(__dirname, '../app/sw.js'), 'utf8');

function namedError(name) {
  const error = new Error(name);
  error.name = name;
  return error;
}

function createMapContext({ storage, manifest = null, online = false, fetchImpl } = {}) {
  const values = new Map();
  if (manifest) values.set('lehrfahrer_offline_pmtiles_manifest', JSON.stringify(manifest));
  const context = {
    console: { warn() {}, error() {}, log() {} },
    navigator: { storage, onLine: online },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    document: {
      getElementById() { return null; },
      body: { classList: { contains() { return false; }, toggle() {} } }
    },
    window: {
      isSecureContext: true,
      location: { href: 'https://example.test/app/' },
      addEventListener() {},
      dispatchEvent() {},
      matchMedia() { return { matches: false }; }
    },
    CustomEvent: function CustomEvent() {},
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (async () => ({ ok: false }))
  };
  vm.createContext(context);
  vm.runInContext(`${mapSource}\nthis.__offlineMapTest = { readStoredPMTilesSource, resolveInitialMapSource, buildPMTilesStyle };`, context);
  vm.runInContext(`createLocalPMTilesSource = async (file, metadata) => ({
    kind: 'local', label: metadata.displayName, url: 'local-pmtiles',
    style: buildPMTilesStyle('local-pmtiles'), metadata: { ...metadata, size: file.size }
  });`, context);
  return { context, values, api: context.__offlineMapTest };
}

test('OPFS vorhanden und gespeicherte PMTiles-Karte wird geladen', async () => {
  const file = { size: 4096, name: 'stored.pmtiles' };
  const storage = { getDirectory: async () => ({
    getFileHandle: async name => {
      assert.equal(name, 'stored.pmtiles');
      return { getFile: async () => file };
    }
  }) };
  const { api } = createMapContext({
    storage,
    manifest: { storageName: 'stored.pmtiles', displayName: 'Region.pmtiles', size: 4096 }
  });
  const result = await api.readStoredPMTilesSource();
  assert.equal(result.status, 'ready');
  assert.equal(result.source.kind, 'local');
});

test('OPFS vorhanden ohne installierte Karte liefert not-installed', async () => {
  const storage = { getDirectory: async () => ({
    getFileHandle: async () => { throw namedError('NotFoundError'); }
  }) };
  const { api } = createMapContext({ storage });
  const result = await api.readStoredPMTilesSource();
  assert.equal(result.status, 'not-installed');
  assert.equal(result.source, null);
});

test('fehlende OPFS-Unterstützung liefert opfs-unavailable', async () => {
  const { api } = createMapContext({ storage: {} });
  assert.equal((await api.readStoredPMTilesSource()).status, 'opfs-unavailable');
});

test('SecurityError von getDirectory wird strukturiert als opfs-denied behandelt', async () => {
  const storage = { getDirectory: async () => { throw namedError('SecurityError'); } };
  const { api } = createMapContext({ storage });
  const result = await api.readStoredPMTilesSource();
  assert.equal(result.status, 'opfs-denied');
  assert.match(result.detail, /Sicherheitsgründen/);
});

test('veraltete Manifest-Referenz wird erkannt und entfernt', async () => {
  const storage = { getDirectory: async () => ({
    getFileHandle: async () => { throw namedError('NotFoundError'); }
  }) };
  const { api, values } = createMapContext({
    storage,
    manifest: { storageName: 'missing.pmtiles', displayName: 'Alt.pmtiles' }
  });
  assert.equal((await api.readStoredPMTilesSource()).status, 'stale-reference');
  assert.equal(values.has('lehrfahrer_offline_pmtiles_manifest'), false);
});

test('ungültiges Manifest wird nicht als fehlende Installation verschleiert', async () => {
  const storage = { getDirectory: async () => ({
    getFileHandle: async () => { throw namedError('NotFoundError'); }
  }) };
  const fixture = createMapContext({ storage });
  fixture.values.set('lehrfahrer_offline_pmtiles_manifest', '{defekt');
  assert.equal((await fixture.api.readStoredPMTilesSource()).status, 'stale-reference');
  assert.equal(fixture.values.has('lehrfahrer_offline_pmtiles_manifest'), false);
});

test('offline ohne lesbare Karte startet mit leerem Style und ohne Netzaufruf', async () => {
  let fetchCount = 0;
  const { api } = createMapContext({
    storage: { getDirectory: async () => { throw namedError('SecurityError'); } },
    online: false,
    fetchImpl: async () => { fetchCount++; return { ok: true }; }
  });
  const source = await api.resolveInitialMapSource();
  assert.equal(source.kind, 'none');
  assert.equal(Object.keys(source.style.sources).length, 0);
  assert.equal(fetchCount, 0);
});

test('online bleibt OpenFreeMap-Fallback nach genau einer Verfügbarkeitsprüfung', async () => {
  let fetchCount = 0;
  const { api } = createMapContext({
    storage: { getDirectory: async () => ({ getFileHandle: async () => { throw namedError('NotFoundError'); } }) },
    online: true,
    fetchImpl: async () => { fetchCount++; return { ok: true }; }
  });
  const source = await api.resolveInitialMapSource();
  assert.equal(source.kind, 'online');
  assert.equal(fetchCount, 1);
});

test('PMTiles-Style nutzt ausschließlich lokale Glyphs', () => {
  const { api } = createMapContext({ storage: {} });
  const style = api.buildPMTilesStyle('local-key');
  assert.match(style.glyphs, /^https:\/\/example\.test\/app\/glyphs\//);
  assert.doesNotMatch(style.glyphs, /demotiles|unpkg|cdnjs/);
});

test('App-Start verwendet lokal ausgelieferte und vorgecachte Kartenbibliotheken', () => {
  assert.doesNotMatch(appHtml, /font-awesome|cdnjs\.cloudflare\.com|fa-solid|fa-arrow/);
  for (const url of [
    './vendor/maplibre-gl-4.7.1.css',
    './vendor/maplibre-gl-4.7.1.js',
    './vendor/pmtiles-3.2.1.js'
  ]) {
    assert.ok(appHtml.includes(url));
    assert.ok(serviceWorker.includes(url));
  }
  assert.ok(serviceWorker.includes("'./js/local-bus-router.js'"));
  assert.ok(serviceWorker.includes("new Request(url, { cache: 'reload' })"));
});

test('MapLibre-Reset schreibt niemals user-select undefined', () => {
  assert.ok(mapSource.includes('guardMapLibreBoxZoomReset(map)'));
  assert.ok(mapSource.includes('if (!boxZoom.isActive()) return'));
  assert.doesNotMatch(mapSource, /style\.userSelect\s*=\s*(?:undefined|['"]undefined['"])/);
  assert.doesNotMatch(appCss, /user-select\s*:\s*undefined/);
});

test('Cottbus-Karte wird nur vollständig an den vorhandenen Offline-Import übergeben', async () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
  const config = appSource.slice(appSource.indexOf('const COTTBUS_OFFLINE_MAP'), appSource.indexOf('let offlineMapActionPending'));
  const fileName = 'cottbus-20261101.pmtiles';
  const asset = fs.statSync(path.resolve(__dirname, '../assets/offline-maps', fileName));
  const buttons = [];
  const status = {};
  let responseSize = 1;
  let imported = null;
  const context = vm.createContext({
    availableLinesCatalog: [{ city: 'test' }],
    regionMapControls: { replaceChildren: (...items) => buttons.splice(0, buttons.length, ...items) },
    offlineMapSetupBtn: {},
    document: { createElement: () => ({ addEventListener() {} }) },
    regionMapDownloadStatus: status,
    OFFLINE_MAP_MANIFEST_KEY: 'center',
    OPTIONAL_MAP_MANIFEST_KEYS: ['north', 'east', 'south', 'west'],
    regionalMapSources: new Map(),
    navigator: { onLine: true },
    fetch: async (url, options) => {
      assert.equal(url, '../assets/offline-maps/' + fileName);
      assert.equal(options.cache, 'no-store');
      return { ok: true, blob: async () => new Blob([Buffer.alloc(responseSize)]) };
    },
    installOfflineMapFile: async file => { imported = file; return true; },
    requestPersistentStorage: async () => {},
    AbortController, File, setTimeout, clearTimeout,
    console: { warn() {} }
  });
  vm.runInContext(config + '\nlet offlineMapActionPending = false;\n' + appSource.slice(
    appSource.indexOf('function cottbusMapOffered()'),
    appSource.indexOf('async function onTilesFileSelected()')
  ), context);

  context.updateRegionMapDownloadButton();
  assert.equal(buttons.length, 0);
  context.availableLinesCatalog = [{ city: 'cottbus' }];
  context.updateRegionMapDownloadButton();
  assert.equal(buttons.length, 5);
  await vm.runInContext('downloadCottbusOfflineMap(COTTBUS_OFFLINE_MAP)', context);
  assert.equal(imported, null);
  assert.match(status.textContent, /konnte nicht geladen werden/);
  assert.equal(buttons[0].disabled, false);

  responseSize = asset.size;
  await vm.runInContext('downloadCottbusOfflineMap(COTTBUS_OFFLINE_MAP)', context);
  assert.equal(imported.name, fileName);
  assert.equal(imported.size, asset.size);
  assert.match(status.textContent, /offline verfügbar/);
});

test('Regionalkacheln kommen aus Zentrum, Nord oder bei Bedarf aus dem Internet', async () => {
  const requested = [];
  const context = vm.createContext({
    regionalMapSources: new Map([
      ['center', { archive: { getZxy: async (z, x, y) => y === 2 ? { data: 'center' } : undefined } }],
      ['north', { archive: { getZxy: async (z, x, y) => y === 1 ? { data: 'north' } : undefined } }]
    ]),
    navigator: { onLine: false },
    fetch: async url => {
      requested.push(url);
      return { ok: true, arrayBuffer: async () => 'online' };
    },
    ArrayBuffer
  });
  vm.runInContext(mapSource.slice(
    mapSource.indexOf('async function loadRegionalMapTile('),
    mapSource.indexOf('function hasCottbusRegionalMap()')
  ), context);
  const controller = new AbortController();
  const load = y => context.loadRegionalMapTile({ url: 'lf-regions://cottbus/3/4/' + y }, controller);
  assert.equal((await load(2)).data, 'center');
  assert.equal((await load(1)).data, 'north');
  assert.equal((await load(3)).data.byteLength, 0);
  assert.deepEqual(requested, []);
  context.navigator.onLine = true;
  assert.equal((await load(3)).data, 'online');
  assert.deepEqual(requested, ['https://tiles.openfreemap.org/planet/latest/3/4/3.pbf']);
});

test('installierte App und alter App-Startpfad öffnen offline dieselbe vorbereitete Seite', async () => {
  const listeners = new Map();
  const origin = 'https://example.test';
  const shell = new Response('cached shell');
  let networkRequests = 0;
  const context = vm.createContext({
    self: {
      registration: { scope: origin + '/app/' },
      addEventListener: (name, listener) => listeners.set(name, listener)
    },
    URL, Request, Response,
    caches: { match: async request => request.url === origin + '/app/index.html' ? shell : undefined },
    fetch: async () => { networkRequests++; throw new TypeError('offline'); }
  });
  vm.runInContext(serviceWorker, context);
  const navigate = url => {
    let response;
    listeners.get('fetch')({
      request: { url: origin + url, method: 'GET', mode: 'navigate' },
      respondWith: value => { response = value; }
    });
    return response;
  };
  assert.equal((await navigate('/app/')).status, 200);
  assert.equal(await (await navigate('/app/index.html?launch=1')).text(), 'cached shell');
  assert.equal(networkRequests, 0);
  await assert.rejects(navigate('/api/auth/account_test.php?action=me'), TypeError);
  assert.equal(networkRequests, 1);
});
