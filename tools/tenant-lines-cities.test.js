const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-phase4b-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
const password = 'Phase4B-Testpasswort!';
const legacyToken = 'phase4b-legacy-token';
let php;
let server;
let origin;
let companyA;
let companyB;
let sessionA;
let sessionB;

function phpString(value) { return JSON.stringify(String(value).replaceAll('\\', '/')); }
function environment() {
  return {
    ...process.env,
    LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
    LEHRFAHRER_DB_DRIVER: 'sqlite',
    LEHRFAHRER_ENV: 'dev',
    LEHRFAHRER_PUBLIC_ORIGIN: origin,
    LEHRFAHRER_API_TOKEN: legacyToken,
    LEHRFAHRER_LEGACY_COMPANY_ID: companyA?.id || ''
  };
}
function runPhp(code) {
  const result = spawnSync(php, ['-r', code], { cwd: root, env: environment(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function port() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const value = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(value));
    });
  });
}
async function request(url, options = {}, session = sessionA) {
  const headers = { ...(options.headers || {}) };
  if (session) headers.Cookie = session.cookie;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Origin = origin;
    headers['X-CSRF-Token'] = session?.csrf || '';
  }
  const response = await fetch(origin + url, {
    method: options.method || (options.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    redirect: 'manual'
  });
  const body = await response.text();
  return { status: response.status, body, json: () => JSON.parse(body), headers: response.headers };
}
async function login(slug) {
  const result = await request('/api/auth/login.php', {
    json: { company: slug, login: 'admin', password }
  }, null);
  assert.equal(result.status, 200, result.body);
  return {
    cookie: (result.headers.get('set-cookie') || '').split(';', 1)[0],
    csrf: result.json().csrfToken
  };
}
function seedCity(company, city, line) {
  const base = path.join(privateRoot, 'companies', company.id);
  const routeDir = path.join(base, 'lines', city, 'Linie_1', 'Standard');
  fs.mkdirSync(path.join(base, 'cities', city), { recursive: true });
  fs.mkdirSync(routeDir, { recursive: true });
  fs.mkdirSync(path.join(base, 'settings'), { recursive: true });
  const route = { city, lineName: line, routeName: 'Route 001', directionName: 'Test',
    lineFolder: 'Linie_1', categoryFolder: 'Standard', routePoints: [{ lat: 51.7, lon: 14.3 }], stops: [] };
  fs.writeFileSync(path.join(routeDir, line + '.json'), JSON.stringify(route));
  fs.writeFileSync(path.join(routeDir, line + '.gpx'), '<gpx><name>' + line + '</name></gpx>');
  fs.writeFileSync(path.join(routeDir, line + '.pdf'), '%PDF-1.4\n' + line);
  fs.writeFileSync(path.join(base, 'settings', 'city_settings.json'),
    JSON.stringify({ [city]: { dispatchPhone: company === companyA ? '111' : '222' } }));
}

before(async () => {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  php = candidates.find(candidate => {
    if (!candidate) return false;
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    return !result.error && result.status === 0;
  });
  if (!php) throw new Error('PHP fehlt.');
  fs.mkdirSync(webroot);
  fs.cpSync(path.join(root, 'api'), path.join(webroot, 'api'), { recursive: true });
  origin = 'http://127.0.0.1:' + await port();
  const seed = `
    require ${phpString(path.join(root, 'api', '_control_repositories.php'))};
    $pdo=lehrfahrer_control_database();
    $companies=new LehrfahrerCompanyRepository($pdo);
    $users=new LehrfahrerUserRepository($pdo);
    $roles=new LehrfahrerRoleRepository($pdo);
    $result=[];
    foreach (['betrieb-a','betrieb-b'] as $slug) {
      $company=$companies->create(['slug'=>$slug,'name'=>$slug,'status'=>'active','license_status'=>'active']);
      $user=$users->create($company['id'],['login'=>'admin','display_name'=>'Admin','password'=>${phpString(password)}]);
      $roles->assignRole($company['id'],$user['id'],'ADMIN');
      $result[]=$company;
    }
    echo json_encode($result);
  `;
  [companyA, companyB] = JSON.parse(runPhp(seed));
  seedCity(companyA, 'stadt-a', 'Route_A');
  seedCity(companyB, 'stadt-b', 'Route_B');
  server = spawn(php, ['-S', origin.replace('http://', ''), '-t', webroot], {
    cwd: webroot, env: environment(), stdio: 'ignore', windowsHide: true
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin + '/api/auth/runtime.php')).status === 200) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  sessionA = await login('betrieb-a');
  sessionB = await login('betrieb-b');
});
after(() => {
  if (server) server.kill();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('Stadt- und Linienlisten zeigen nur den eigenen Mandanten', async () => {
  const aCities = await request('/api/list_cities.php?includeEmpty=1');
  const bCities = await request('/api/list_cities.php?includeEmpty=1', {}, sessionB);
  assert.deepEqual(aCities.json().cities, ['stadt-a']);
  assert.deepEqual(bCities.json().cities, ['stadt-b']);
  const aLines = await request('/api/list_lines.php');
  const bLines = await request('/api/list_lines.php', {}, sessionB);
  assert.deepEqual(aLines.json().lines.map(line => line.fileBase), ['Route_A']);
  assert.deepEqual(bLines.json().lines.map(line => line.fileBase), ['Route_B']);
  assert.match(aLines.json().lines[0].jsonPath, /^api\/download_line_json\.php\?/);
  assert.match(aLines.json().lines[0].gpxPath, /^api\/download_line_gpx\.php\?/);
});

test('App-Laden und Editor-Downloads nutzen authentifizierte Tenant-Dateien', async () => {
  const line = (await request('/api/list_lines.php')).json().lines[0];
  const loaded = await request('/api/load_line.php?city=stadt-a&line=Route_A&lineFolder=Linie_1&categoryFolder=Standard');
  assert.equal(loaded.status, 200, loaded.body);
  assert.equal(loaded.json().line.lineName, 'Route_A');
  assert.match(loaded.json().gpx, /Route_A/);
  for (const [url, marker] of [
    [line.jsonPath, 'Route_A'], [line.gpxPath, 'Route_A'],
    ['api/download_line_pdf.php?city=stadt-a&line=Route_A&lineFolder=Linie_1&categoryFolder=Standard', '%PDF-1.4']
  ]) {
    const result = await request('/' + url);
    assert.equal(result.status, 200, result.body);
    assert.ok(result.body.includes(marker));
  }
});

test('bekannte Fremd-IDs und Fremdstadt liefern beidseitig 404', async () => {
  for (const [session, foreignCity, foreignLine] of [
    [sessionA, 'stadt-b', 'Route_B'], [sessionB, 'stadt-a', 'Route_A']
  ]) {
    for (const url of [
      'list_lines.php?city=' + foreignCity,
      'load_line.php?city=' + foreignCity + '&line=' + foreignLine,
      'download_line_json.php?city=' + foreignCity + '&line=' + foreignLine,
      'download_line_gpx.php?city=' + foreignCity + '&line=' + foreignLine,
      'download_line_pdf.php?city=' + foreignCity + '&line=' + foreignLine,
      'city_settings.php?city=' + foreignCity
    ]) {
      const result = await request('/api/' + url, {}, session);
      assert.equal(result.status, 404, url + ': ' + result.body);
    }
    const analyze = await request('/api/manage_city.php', {
      json: { action: 'analyze', city: foreignCity }
    }, session);
    assert.equal(analyze.status, 404, analyze.body);
    const deletion = await request('/api/delete_line.php', {
      json: { city: foreignCity, line: foreignLine }
    }, session);
    assert.equal(deletion.status, 404, deletion.body);
    const save = await request('/api/save_line.php', {
      json: { city: foreignCity, fileBase: 'Foreign_Write', lineName: 'Linie X',
        routeName: 'Route X', routePoints: [], stops: [] }
    }, session);
    assert.equal(save.status, 404, save.body);
    const saveGpx = await request('/api/save_gpx.php', {
      json: { city: foreignCity, lineFolder: 'Linie_X', categoryFolder: 'Standard',
        filename: 'Foreign_Write.gpx', gpx: '<gpx />' }
    }, session);
    assert.equal(saveGpx.status, 404, saveGpx.body);
    const settings = await request('/api/city_settings.php', {
      json: { city: foreignCity, dispatchPhone: '999' }
    }, session);
    assert.equal(settings.status, 404, settings.body);
    const rename = await request('/api/manage_city.php', {
      json: { action: 'rename', city: foreignCity, newName: 'gestohlen' }
    }, session);
    assert.equal(rename.status, 404, rename.body);
    const deleteCity = await request('/api/manage_city.php', {
      json: { action: 'delete', city: foreignCity, confirmed: true }
    }, session);
    assert.equal(deleteCity.status, 404, deleteCity.body);
  }
});

test('eigene Einstellungen bleiben getrennt und schreibbar', async () => {
  assert.equal((await request('/api/city_settings.php?city=stadt-a')).json().dispatchPhone, '111');
  assert.equal((await request('/api/city_settings.php?city=stadt-b', {}, sessionB)).json().dispatchPhone, '222');
  const changed = await request('/api/city_settings.php', {
    json: { city: 'stadt-a', dispatchPhone: '333' }
  });
  assert.equal(changed.status, 200, changed.body);
  assert.equal((await request('/api/city_settings.php?city=stadt-a')).json().dispatchPhone, '333');
  assert.equal((await request('/api/city_settings.php?city=stadt-b', {}, sessionB)).json().dispatchPhone, '222');
  const changedB = await request('/api/city_settings.php', {
    json: { city: 'stadt-b', dispatchPhone: '444' }
  }, sessionB);
  assert.equal(changedB.status, 200, changedB.body);
  assert.equal((await request('/api/city_settings.php?city=stadt-b', {}, sessionB)).json().dispatchPhone, '444');
  assert.equal((await request('/api/city_settings.php?city=stadt-a')).json().dispatchPhone, '333');
});

test('Legacy-Token bleibt auf explizite Startgesellschaft A begrenzt', async () => {
  const headers = { 'X-Api-Token': legacyToken };
  const own = await request('/api/list_lines.php', { headers }, null);
  assert.equal(own.status, 200, own.body);
  assert.deepEqual(own.json().lines.map(line => line.fileBase), ['Route_A']);
  const foreign = await request('/api/load_line.php?city=stadt-b&line=Route_B&company_id=' + companyB.id, { headers }, null);
  assert.equal(foreign.status, 404, foreign.body);
  const forgedList = await request('/api/list_lines.php?company_id=' + companyB.id, { headers }, null);
  assert.deepEqual(forgedList.json().lines.map(line => line.fileBase), ['Route_A']);
});

test('PDF-Regeneration und Ghost-Normalisierung bleiben im eigenen Tenant', async () => {
  for (const endpoint of ['regenerate_pdfs.php', 'normalize_ghost_points.php']) {
    const own = await request('/api/' + endpoint, { json: { city: 'stadt-a' } });
    assert.equal(own.status, 200, endpoint + ': ' + own.body);
    const foreign = await request('/api/' + endpoint, { json: { city: 'stadt-b' } });
    assert.equal(foreign.status, 404, endpoint + ': ' + foreign.body);
  }
});

test('private Tenant-Dateien liegen ausserhalb des HTTP-Webroots', async () => {
  assert.ok(!path.join(privateRoot, 'companies', companyA.id).startsWith(webroot + path.sep));
  const direct = await request('/companies/' + companyA.id + '/lines/stadt-a/Linie_1/Standard/Route_A.json', {}, null);
  assert.equal(direct.status, 404);
});

test('Editor und App verwenden die API-Pfade der Tenant-Testlinie', () => {
  const editor = fs.readFileSync(path.join(root, 'js', 'editor.lineBrowser.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app', 'js', 'app.js'), 'utf8');
  assert.ok(editor.includes('downloadTenantAsset(line.jsonPath'));
  assert.ok(editor.includes('downloadTenantAsset(line.gpxPath'));
  assert.ok(app.includes('load_line.php?scope=driver&city='));
  assert.ok(app.includes('buildAppRelativeAssetUrl(jsonPath)'));
});

test('Stadt und Linie werden nur bei A erstellt, umbenannt und geloescht', async () => {
  const created = await request('/api/create_city.php', { json: { city: 'Stadt Neu' } });
  assert.equal(created.status, 200, created.body);
  const city = created.json().city;
  assert.equal(city, 'stadt-neu');
  assert.equal((await request('/api/list_lines.php?city=' + city, {}, sessionB)).status, 404);

  const route = {
    city, lineName: 'Linie 9', routeName: 'Route 001', directionName: 'Test',
    lineFolder: 'Linie_9', categoryFolder: 'Standard', fileBase: 'Route_Neu',
    routePoints: [{ lat: 51.7, lon: 14.3 }, { lat: 51.71, lon: 14.31 }],
    stops: [{ name: 'Start', lat: 51.7, lon: 14.3 }]
  };
  const saved = await request('/api/save_line.php', { json: route });
  assert.equal(saved.status, 200, saved.body);
  assert.equal(saved.json().ok, true);
  const gpx = await request('/api/save_gpx.php', {
    json: { city, lineFolder: 'Linie_9', categoryFolder: 'Standard',
      filename: 'Route_Neu.gpx', gpx: '<gpx><name>Route_Neu</name></gpx>' }
  });
  assert.equal(gpx.status, 200, gpx.body);
  for (const endpoint of ['load_line.php', 'download_line_json.php', 'download_line_gpx.php', 'download_line_pdf.php']) {
    const url = '/api/' + endpoint + '?city=' + city + '&line=Route_Neu&lineFolder=Linie_9&categoryFolder=Standard';
    const own = await request(url);
    assert.equal(own.status, 200, endpoint + ': ' + own.body);
    const foreign = await request(url, {}, sessionB);
    assert.equal(foreign.status, 404, endpoint + ': ' + foreign.body);
  }
  const analyze = await request('/api/manage_city.php', { json: { action: 'analyze', city } });
  assert.equal(analyze.status, 200, analyze.body);
  const renamed = await request('/api/manage_city.php', {
    json: { action: 'rename', city, newName: 'Stadt Umbenannt' }
  });
  assert.equal(renamed.status, 200, renamed.body);
  assert.equal((await request('/api/load_line.php?city=stadt-neu&line=Route_Neu')).status, 404);
  assert.equal((await request('/api/load_line.php?city=stadt-umbenannt&line=Route_Neu&lineFolder=Linie_9&categoryFolder=Standard')).status, 200);
  const deleted = await request('/api/manage_city.php', {
    json: { action: 'delete', city: 'stadt-umbenannt', confirmed: true }
  });
  assert.equal(deleted.status, 200, deleted.body);
  assert.equal((await request('/api/list_lines.php?city=stadt-umbenannt')).status, 404);
  assert.equal((await request('/api/list_lines.php', {}, sessionB)).json().lines[0].fileBase, 'Route_B');
});

test('Speichern meldet NEW, UNCHANGED und fachliche Änderungen am tatsächlichen Ziel', async () => {
  const route = {
    city: 'stadt-a', lineFolder: 'Linie_42', categoryFolder: 'Standard',
    fileBase: 'Route_Semantic', lineName: 'Linie 42', routeName: 'Route Semantic',
    directionName: 'Nord',
    stops: [
      { name: 'A', lat: 51.7, lon: 14.3, order: 1 },
      { name: 'B', lat: 51.71, lon: 14.31, order: 2 }
    ],
    routePoints: [[51.7, 14.3], [51.71, 14.31]],
    specialTracks: [{ fromStopName: 'A', toStopName: 'B', points: [[51.7, 14.3], [51.71, 14.31]] }],
    meta: { formatVersion: '1.2', exportedAt: '2026-01-01T00:00:00Z' }
  };
  const save = async (data, expected) => {
    const response = await request('/api/save_line.php', { json: data });
    assert.equal(response.status, 200, response.body);
    assert.equal(response.json().changeType, expected);
  };
  await save(route, 'NEW');
  await save({ ...route, forceOverwrite: true, mapView: { zoom: 14 }, bounds: [1, 2],
    meta: { ...route.meta, exportedAt: '2026-02-01T00:00:00Z', source: 'Lehrfahrer Linien-Editor' } }, 'UNCHANGED');
  const reordered = Object.fromEntries(Object.entries(route).reverse());
  await save({ ...reordered, forceOverwrite: true }, 'UNCHANGED');
  await save({ ...route, forceOverwrite: true, routePoints: [[51.7, 14.3], [51.72, 14.32]] }, 'CHANGED');
  await save({ ...route, forceOverwrite: true }, 'CHANGED');
  await save({ ...route, forceOverwrite: true, stops: [...route.stops].reverse() }, 'CHANGED');
  await save({ ...route, forceOverwrite: true }, 'CHANGED');
  await save({ ...route, forceOverwrite: true, specialTracks: [{ ...route.specialTracks[0], points: [[51.7, 14.3], [51.72, 14.32]] }] }, 'CHANGED');
  await save({ ...route, forceOverwrite: true }, 'CHANGED');
  await save({ ...route, forceOverwrite: true, directionName: 'Süd' }, 'CHANGED');
  const changedLine = await request('/api/load_line.php?city=stadt-a&line=Route_Semantic&lineFolder=Linie_42&categoryFolder=Standard');
  assert.equal(changedLine.status, 200, changedLine.body);
  assert.equal(changedLine.json().line.directionName, 'Süd');
  await save({ ...route, forceOverwrite: true }, 'CHANGED');
  await save({ ...route, forceOverwrite: true, routeMode: 'manual' }, 'CHANGED');
  const loaded = await request('/api/load_line.php?city=stadt-a&line=Route_Semantic&lineFolder=Linie_42&categoryFolder=Standard');
  assert.equal(loaded.status, 200, loaded.body);
  assert.equal(loaded.json().line.directionName, 'Nord');
});

test('Unlesbare vorhandene Zieldatei wird nicht als NEW klassifiziert oder überschrieben', async () => {
  const filePath = path.join(privateRoot, 'companies', companyA.id, 'lines', 'stadt-a', 'Linie_44', 'Standard', 'Route_Broken.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{broken');
  const response = await request('/api/save_line.php', { json: {
    city: 'stadt-a', lineFolder: 'Linie_44', categoryFolder: 'Standard', fileBase: 'Route_Broken',
    lineName: 'Linie 44', routeName: 'Route Broken', forceOverwrite: true,
    stops: [], routePoints: []
  } });
  assert.equal(response.status, 409, response.body);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});

test('Konfliktvermeidung klassifiziert den tatsächlich neu angelegten Umleitungszielpfad als NEW', async () => {
  const route = {
    city: 'stadt-a', lineFolder: 'Linie_45', categoryFolder: 'Standard',
    fileBase: 'Route_Detour', lineName: 'Linie 45', routeName: 'Route Detour',
    directionName: 'Nord', stops: [], routePoints: []
  };
  const first = await request('/api/save_line.php', { json: route });
  assert.equal(first.status, 200, first.body);
  assert.equal(first.json().changeType, 'NEW');
  const second = await request('/api/save_line.php', { json: route });
  assert.equal(second.status, 200, second.body);
  assert.equal(second.json().changeType, 'NEW');
  assert.notEqual(second.json().fileBase, first.json().fileBase);
});

test('Änderungserkennung lässt GEPRUEFT und FREIGEGEBEN im GTFS-Arbeitsstatus unverändert', async () => {
  const inventoryPath = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'index', 'work-inventory.json');
  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  const entries = ['GEPRUEFT', 'FREIGEGEBEN'].map((status, index) => ({
    routeId: `route-status-${index}`, variantId: `variant-status-${index}`, status, timetableStatus: 'UNVERAENDERT'
  }));
  fs.writeFileSync(inventoryPath, JSON.stringify({ entries }));
  for (const [index, entry] of entries.entries()) {
    const base = {
      city: 'stadt-a', lineFolder: 'Linie_43', categoryFolder: 'Standard',
      fileBase: `Route_Status_${index}`, lineName: 'Linie 43', routeName: `Route Status ${index}`,
      stops: [{ name: 'A', lat: 51.7, lon: 14.3 }, { name: 'B', lat: 51.71, lon: 14.31 }],
      routePoints: [[51.7, 14.3], [51.71, 14.31]],
      meta: { gtfsWork: { routeId: entry.routeId, variantId: entry.variantId } }
    };
    for (const [payload, expected] of [[base, 'NEW'], [{ ...base, forceOverwrite: true }, 'UNCHANGED'],
      [{ ...base, forceOverwrite: true, routePoints: [[51.7, 14.3], [51.72, 14.32]] }, 'CHANGED'],
      [{ ...base, forceOverwrite: true, routePoints: [[51.7, 14.3], [51.72, 14.32]],
        meta: { gtfsWork: { ...base.meta.gtfsWork, signature: 'changed' } } }, 'CHANGED']]) {
      const response = await request('/api/save_line.php', { json: payload });
      assert.equal(response.status, 200, response.body);
      assert.equal(response.json().changeType, expected);
      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      assert.equal(inventory.entries[index].status, entry.status);
    }
  }
});
