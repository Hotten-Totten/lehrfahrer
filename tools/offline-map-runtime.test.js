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

test('App-Start hat keine Font-Awesome-Pflicht und CDN-Runtime ist exakt vorgecached', () => {
  assert.doesNotMatch(appHtml, /font-awesome|cdnjs\.cloudflare\.com|fa-solid|fa-arrow/);
  for (const url of [
    'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
    'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
    'https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js'
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
