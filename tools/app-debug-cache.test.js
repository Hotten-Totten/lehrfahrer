const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/js/debug-helper.js'), 'utf8');

test('App und Service Worker referenzieren den aktuellen Debug-Helper-Hash', () => {
  const hash = crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
  const app = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'app/sw.js'), 'utf8');
  assert.ok(app.includes(`js/debug-helper.js?v=${hash}`));
  assert.ok(worker.includes(`./js/debug-helper.js?v=${hash}`));
});

function fakeDatabase(version = 4) {
  const values = {
    routes: [{ key: 'cottbus/16/Route_02', data: { stops: [{ name: 'A' }], routePoints: [] } }],
    linesCatalog: [{ id: 'cottbus/16/Route_02', lineName: 'Linie 16' }],
    linesData: [{ id: 'cottbus/16/Route_02', data: { stops: [{ name: 'A' }], routePoints: [] } }],
    linesGPX: [],
    linesPDF: [{ id: 'cottbus/16/Route_02' }],
    contextOwner: [{ id: 'active', key: 'verified-context' }]
  };
  const names = Object.keys(values);
  names.contains = name => names.includes(name);
  return {
    name: 'lehrfahrer-offline', version, objectStoreNames: names, closed: false,
    close() { this.closed = true; },
    transaction(name) {
      assert.ok(names.includes(name));
      return { objectStore() { return {
        count() {
          const request = {};
          queueMicrotask(() => { request.result = values[name].length; request.onsuccess?.(); });
          return request;
        },
        openCursor() {
          const request = {};
          let index = 0;
          const advance = () => {
            request.result = index < values[name].length
              ? { value: values[name][index], key: index, continue() { index++; queueMicrotask(advance); } }
              : null;
            request.onsuccess?.();
          };
          queueMicrotask(advance);
          return request;
        }
      }; } };
    }
  };
}

function debugContext(connection, indexedDB, cacheStorage = undefined) {
  const messages = [];
  const context = vm.createContext({ indexedDB, caches: cacheStorage,
    requireDB() { if (!connection) throw new Error('Mandantenkontext ist nicht bestätigt.'); return connection; },
    console: { log: (...args) => messages.push(args), warn: (...args) => messages.push(args),
      error: (...args) => messages.push(args) },
    window: { location: { reload() { messages.push(['reload']); } } }
  });
  context.connection = connection;
  vm.runInContext('const DB_NAME = "lehrfahrer-offline"; let db = connection;', context);
  vm.runInContext(source, context, { filename: 'app/js/debug-helper.js' });
  return { context, messages };
}

test('Cache-Status liest aktuelle Katalog- und Routendaten ohne ältere DB-Version', async () => {
  const connection = fakeDatabase();
  const { context } = debugContext(connection, { open() { throw new Error('Bestehende App-Verbindung muss verwendet werden'); } });
  const status = await context.window.DEBUG_showCacheStatus();
  assert.equal(status.version, 4);
  assert.equal(status.catalog[0].line, 'Linie 16');
  assert.equal(status.downloads[0].stops, 1);
  assert.equal(status.downloads[0].routePoints, 0);
  assert.equal(status.offlineRoutes[0].id, 'cottbus/16/Route_02');
  assert.equal(connection.closed, false);
});

test('Store-Liste öffnet eine vorhandene höhere DB-Version ohne Versionsargument', async () => {
  const connection = fakeDatabase(5);
  const calls = [];
  const indexedDB = { open(...args) {
    calls.push(args);
    const request = {};
    queueMicrotask(() => { request.result = connection; request.onsuccess?.(); });
    return request;
  } };
  const { context } = debugContext(connection, indexedDB);
  const result = await context.window.DEBUG_listStores();
  assert.deepEqual(calls, []);
  assert.equal(result.version, 5);
  assert.equal(result.stores.length, 6);
  assert.deepEqual(Array.from(result.stores, item => item.name),
    ['routes', 'linesCatalog', 'linesData', 'linesGPX', 'linesPDF', 'contextOwner']);
  assert.equal(result.stores.find(item => item.name === 'linesPDF').count, 1);
  assert.equal(connection.closed, false);
  const invalid = debugContext(null, indexedDB);
  await assert.rejects(invalid.context.window.DEBUG_showCacheStatus(), /Mandantenkontext/);
});

test('Reset schließt die App-DB, löscht Download- und API-Cache und erlaubt Neuaufbau', async () => {
  const connection = fakeDatabase();
  const deleted = [];
  const indexedDB = {
    deleteDatabase(name) {
      assert.equal(connection.closed, true);
      deleted.push(name);
      const request = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    open(name, version) {
      assert.equal(name, 'lehrfahrer-offline');
      assert.equal(version, 4);
      return { result: fakeDatabase(4) };
    }
  };
  const cacheNames = new Set(['lehrfahrer-api-v1', 'lehrfahrer-app-v21065', 'other-origin-cache']);
  const cacheStorage = {
    async keys() { return Array.from(cacheNames); },
    async delete(name) { return cacheNames.delete(name); }
  };
  const { context, messages } = debugContext(connection, indexedDB, cacheStorage);
  assert.equal(await context.window.DEBUG_resetDownloadCache(), true);
  assert.deepEqual(deleted, ['lehrfahrer-offline']);
  assert.equal(vm.runInContext('db', context), null);
  assert.deepEqual(Array.from(cacheNames), ['lehrfahrer-app-v21065', 'other-origin-cache']);
  assert.equal(messages.some(message => message[0] === 'reload'), true);
  assert.equal(indexedDB.open('lehrfahrer-offline', 4).result.version, 4);
});

test('Debug-Reset lädt bei blockierter Löschung nicht voreilig neu', async () => {
  const connection = fakeDatabase();
  const indexedDB = { deleteDatabase() {
    const request = {};
    queueMicrotask(() => request.onblocked?.());
    return request;
  } };
  const { context, messages } = debugContext(connection, indexedDB);
  context.window.DEBUG_resetDownloadCache();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message[0] === 'reload'), false);
  assert.equal(messages.some(message => String(message[0]).includes('anderen Tab')), true);
});
