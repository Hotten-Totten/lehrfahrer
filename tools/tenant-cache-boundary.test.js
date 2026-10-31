const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/tenant-cache-boundary.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app/js/app.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'app/sw.js'), 'utf8');
const editorHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const account = (accountId, companyId, membershipId) => ({
  ok: true, context: 'TENANT', accountId, companyId, membershipId
});

function storage() {
  const values = new Map();
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function fixture() {
  const localStorage = storage();
  const sessionStorage = storage();
  const deletedDbs = [];
  const cacheNames = new Set(['lehrfahrer-api-v1', 'lehrfahrer-app-shell']);
  const handlers = {};
  let current = null;
  let networkDown = false;
  let legacyDown = false;
  let accountStatus = 200;
  const indexedDB = {
    deleteDatabase(name) {
      deletedDbs.push(name);
      const request = {};
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  };
  const caches = {
    async keys() { return [...cacheNames]; },
    async delete(name) { return cacheNames.delete(name); }
  };
  const window = {
    location: { reload() {} },
    addEventListener(name, callback) { handlers[name] = callback; }
  };
  async function fetch(url, options) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    if (networkDown) throw new TypeError('network down');
    if (url.includes('account_test.php')) {
      return { status: accountStatus, ok: accountStatus === 200,
        json: async () => current };
    }
    if (legacyDown) throw new TypeError('legacy network down');
    return { status: 401, ok: false };
  }
  vm.runInNewContext(source, {
    window, localStorage, sessionStorage, indexedDB, caches, fetch,
    AbortController, setTimeout, clearTimeout, Date, Math, JSON, encodeURIComponent,
    TypeError, Error
  });
  return { api: window.LehrfahrerTenantCache, localStorage, sessionStorage,
    cacheNames, deletedDbs, handlers,
    setCurrent(value) { current = value; },
    setOffline(value) { networkDown = value; },
    setLegacyOffline(value) { legacyDown = value; },
    setAccountStatus(value) { accountStatus = value; }
  };
}

test('A→B→A invalidiert Route, laufende Fahrt, Editor-Zustand und alte API-Caches', async () => {
  const f = fixture();
  await f.api.applyValidatedContext(account('one', 'A', 'a'), 'account');
  const keyA = f.api.tenantStorageKey('linieneditor_autosave_v1');
  f.localStorage.setItem(keyA, 'route A');
  f.localStorage.setItem('lehrfahrer-active-drive', 'active A');
  f.sessionStorage.setItem('lf_startup_download_done_v1', 'done');
  await f.api.applyValidatedContext(account('one', 'B', 'b'), 'account');
  assert.equal(f.localStorage.getItem(keyA), null);
  assert.equal(f.localStorage.getItem('lehrfahrer-active-drive'), null);
  assert.equal(f.sessionStorage.length, 0);
  assert.equal(f.cacheNames.has('lehrfahrer-api-v1'), false);
  assert.equal(f.cacheNames.has('lehrfahrer-app-shell'), true);
  const keyB = f.api.tenantStorageKey('linieneditor_autosave_v1');
  assert.notEqual(keyA, keyB);
  f.localStorage.setItem(keyB, 'route B');
  await f.api.applyValidatedContext(account('one', 'A', 'a'), 'account');
  assert.equal(f.localStorage.getItem(keyB), null);
  assert.equal(f.localStorage.getItem(keyA), null);
  assert.ok(f.deletedDbs.length >= 3);
});

test('Logout und Accountwechsel trennen auch gleiche Gesellschaft; alte globale Keys werden verworfen', async () => {
  const f = fixture();
  f.localStorage.setItem('linieneditor_autosave_v1', 'unbound route');
  f.localStorage.setItem('lehrfahrer_api_token', 'legacy secret');
  await f.api.applyValidatedContext(account('one', 'A', 'a'), 'account');
  assert.equal(f.localStorage.getItem('linieneditor_autosave_v1'), null);
  assert.equal(f.localStorage.getItem('lehrfahrer_api_token'), null);
  const oldKey = f.api.tenantStorageKey('lehrfahrer_last_save_target');
  f.localStorage.setItem(oldKey, 'private A');
  await f.api.clearForLogout();
  assert.equal(f.api.readContext(), null);
  await f.api.applyValidatedContext(account('two', 'A', 'other'), 'account');
  assert.equal(f.localStorage.getItem(oldKey), null);
  assert.notEqual(f.api.tenantStorageKey('lehrfahrer_last_save_target'), oldKey);
});

test('Offline nutzt nur zuletzt bestätigten Kontext; Server-401 und Fehlerantworten sind fail-closed', async () => {
  const f = fixture();
  f.setCurrent(account('one', 'B', 'b'));
  const online = await f.api.ensureContext();
  assert.equal(online.context.company, 'B');
  f.setOffline(true);
  const offline = await f.api.ensureContext();
  assert.equal(offline.offline, true);
  assert.equal(offline.context.company, 'B');
  f.setOffline(false);
  f.setAccountStatus(401);
  assert.equal(await f.api.ensureContext(), null);
  assert.equal(f.api.readContext(), null);
  f.setCurrent(account('one', 'A', 'a'));
  f.setAccountStatus(200);
  await f.api.ensureContext();
  f.setAccountStatus(403);
  await assert.rejects(f.api.ensureContext());
  assert.equal(f.api.readContext(), null);
  f.setAccountStatus(200);
  await f.api.ensureContext();
  f.setAccountStatus(401);
  f.setLegacyOffline(true);
  assert.equal(await f.api.ensureContext(), null);
  assert.equal(f.api.readContext(), null);
});

test('Manipulierte company-ID erteilt keine Serverrechte und passt nicht zur IndexedDB-Eigentümerprüfung', async () => {
  const f = fixture();
  f.setCurrent(account('one', 'A', 'a'));
  await f.api.ensureContext();
  const raw = JSON.parse(f.localStorage.getItem('lehrfahrer_verified_local_context_v2'));
  raw.company = 'B';
  f.localStorage.setItem('lehrfahrer_verified_local_context_v2', JSON.stringify(raw));
  assert.match(app, /request\.result\?\.key !== key/);
  assert.match(app, /tx\.objectStore\(name\)\.clear\(\)/);
  const checked = await f.api.ensureContext();
  assert.equal(checked.context.company, 'A');
});

test('Legacy- und Account-Kontext sind getrennt; Service Worker cached nur statische Shell', async () => {
  const f = fixture();
  await f.api.applyValidatedContext({ ok: true, user: { id: 'legacy-1' }, company: { id: 'A' } }, 'legacy');
  const legacyKey = f.api.tenantStorageKey('linieneditor_autosave_v1');
  await f.api.applyValidatedContext(account('account-1', 'A', 'a'), 'account');
  assert.notEqual(f.api.tenantStorageKey('linieneditor_autosave_v1'), legacyKey);
  assert.match(worker, /event\.respondWith\(fetch\(event\.request\)\)/);
  assert.match(worker, /if \(shellUrls\.includes\(url\.href\)\)/);
  assert.doesNotMatch(worker, /CACHE_API|CACHE_ROUTE/);
  assert.match(app, /state\?\.owner !== localContextKey\(context\)/);
  assert.match(editorHtml, /LehrfahrerTenantCache\.ensureContext\(\)/);
});

test('Alle neuen Script-Referenzen besitzen den passenden Cache-Hash', () => {
  const crypto = require('node:crypto');
  const refs = [
    ['js/tenant-cache-boundary.js', ['index.html', 'login.html', 'account-login.php', 'app/index.html', 'app/sw.js']],
    ['js/editor.api.js', ['index.html']],
    ['js/editor.autosave.js', ['index.html']],
    ['js/login.js', ['login.html']],
    ['js/account-login.js', ['account-login.php']],
    ['app/js/app.js', ['app/index.html', 'app/sw.js']],
    ['app/js/debug-helper.js', ['app/index.html', 'app/sw.js']]
  ];
  for (const [file, pages] of refs) {
    const hash = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'))
      .digest('hex').slice(0, 12);
    for (const page of pages) {
      assert.ok(fs.readFileSync(path.join(root, page), 'utf8').includes(hash), `${page}: ${file}`);
    }
  }
});

test('IndexedDB-Migration entfernt Altbestand und trennt A/B auch bei gleichem Routenschlüssel', async () => {
  const stores = new Map(['contextOwner', 'routes', 'linesCatalog', 'linesData', 'linesGPX', 'linesPDF']
    .map(name => [name, new Map()]));
  stores.get('routes').set('route-1', { id: 'route-1', data: 'alte Route A' });
  const fakeDb = {
    transaction(names, mode) {
      assert.equal(mode, 'readwrite');
      const tx = {
        objectStore(name) {
          assert.ok(names.includes(name));
          const entries = stores.get(name);
          return {
            get(id) {
              const request = { result: entries.get(id) };
              queueMicrotask(() => { request.onsuccess(); tx.oncomplete(); });
              return request;
            },
            put(value) { entries.set(value.id, value); },
            clear() { entries.clear(); }
          };
        }
      };
      return tx;
    }
  };
  let current = account('one', 'A', 'a');
  const script = app.slice(app.indexOf('function requireDB()'), app.indexOf('function dbPut(', app.indexOf('function requireDB()')));
  const context = vm.createContext({ fakeDb, window: {
    LehrfahrerTenantCache: { readContext: () => ({ mode: 'account',
      principal: current.accountId, company: current.companyId, membership: current.membershipId }) }
  }});
  vm.runInContext(`let db = fakeDb; let activeLocalContextKey = null; ${script}`, context);
  await vm.runInContext("verifyLocalDatabaseOwner({mode:'account', principal:'one', company:'A', membership:'a'})", context);
  assert.equal(stores.get('routes').size, 0, 'ungebundene Daten aus v3 werden nicht A zugeordnet');
  stores.get('routes').set('route-1', { id: 'route-1', data: 'Route A' });
  current = account('one', 'B', 'b');
  assert.throws(() => vm.runInContext('requireDB()', context), /Mandantenkontext/);
  await vm.runInContext("verifyLocalDatabaseOwner({mode:'account', principal:'one', company:'B', membership:'b'})", context);
  assert.equal(stores.get('routes').size, 0);
  stores.get('routes').set('route-1', { id: 'route-1', data: 'Route B' });
  await vm.runInContext("verifyLocalDatabaseOwner({mode:'account', principal:'one', company:'B', membership:'b'})", context);
  assert.equal(stores.get('routes').get('route-1').data, 'Route B');
});
