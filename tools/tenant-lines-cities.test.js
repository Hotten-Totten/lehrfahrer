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
let accountSessionA;
let accountSessionB;

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
  if (/^\/api\/(?:save_(?:line|gpx)|delete_line|regenerate_pdfs|normalize_ghost_points|city_settings)\.php(?:\?|$)/.test(url) && (options.json !== undefined || options.form !== undefined)) {
    if (session === sessionA) session = accountSessionA;
    else if (session === sessionB) session = accountSessionB;
  }
  const headers = { ...(options.headers || {}) };
  if (session) headers.Cookie = session.cookie;
  if (options.json !== undefined || options.form !== undefined) {
    headers['Content-Type'] = options.form !== undefined
      ? 'application/x-www-form-urlencoded' : 'application/json';
    headers.Origin = origin;
    headers['X-CSRF-Token'] = session?.csrf || '';
  }
  const response = await fetch(origin + url, {
    method: options.method || (options.json !== undefined || options.form !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.form !== undefined ? new URLSearchParams(options.form).toString()
      : options.json !== undefined ? JSON.stringify(options.json) : undefined,
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
    require ${phpString(path.join(root, 'api', '_account_auth.php'))};
    $pdo=lehrfahrer_control_database();
    $companies=new LehrfahrerCompanyRepository($pdo);
    $users=new LehrfahrerUserRepository($pdo);
    $roles=new LehrfahrerRoleRepository($pdo);
    $result=[];
    $accountSessions=[];
    foreach (['betrieb-a','betrieb-b'] as $slug) {
      $company=$companies->create(['slug'=>$slug,'name'=>$slug,'status'=>'active','license_status'=>'active']);
      $user=$users->create($company['id'],['login'=>'admin','display_name'=>'Admin','password'=>${phpString(password)}]);
      $roles->assignRole($company['id'],$user['id'],'ADMIN');
      $record=$users->findAuthenticationRecordByLogin($company['id'],'admin');
      $accountId=lehrfahrer_control_id('acc'); $membershipId=lehrfahrer_control_id('mem');
      $login=$slug.'-admin'; $now=gmdate('c');
      $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
        ->execute([$accountId,$login,'Admin',$record['password_hash'],$now,$now]);
      $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)")
        ->execute([$membershipId,$accountId,$company['id'],$user['id'],$now,$now]);
      $roleId=$pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
      $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$roleId]);
      $created=lehrfahrer_account_login($pdo,$login,${phpString(password)});
      $accountSessions[]=['cookie'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$created['token'],'csrf'=>$created['csrf']];
      $result[]=$company;
    }
    echo json_encode(['companies'=>$result,'accountSessions'=>$accountSessions]);
  `;
  const seeded = JSON.parse(runPhp(seed));
  [companyA, companyB] = seeded.companies;
  [accountSessionA, accountSessionB] = seeded.accountSessions;
  seedCity(companyA, 'stadt-a', 'Route_A');
  seedCity(companyB, 'stadt-b', 'Route_B');
  const zipArgs = spawnSync(php, ['-r', 'echo class_exists("ZipArchive") ? "1" : "0";'],
    { encoding: 'utf8' }).stdout === '1' ? [] : ['-d', 'extension=zip'];
  server = spawn(php, [...zipArgs, '-S', origin.replace('http://', ''), '-t', webroot], {
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

test('BLOCKED sperrt Listing, Laden und direkte Downloads nur im betroffenen Mandanten', async () => {
  const relative = 'stadt-a/Linie_1/Standard/Route_A.json';
  runPhp(`
    require ${phpString(path.join(root, 'api/_audit_file_operation.php'))};
    $company=${phpString(companyA.id)};
    $route=${phpString(relative)};
    $record=['id'=>'op_'.bin2hex(random_bytes(16)),'companyId'=>$company,
      'routeRelative'=>$route,'objectId'=>lehrfahrer_audit_file_object_id($company,$route),
      'kind'=>'UPDATE','state'=>'BLOCKED','auditEventId'=>null,
      'files'=>[['area'=>'lines','relative'=>$route,'oldHash'=>hash('sha256',(string)file_get_contents(
        lehrfahrer_tenant_path($company,'lines',$route))),'newHash'=>hash('sha256','neuer Inhalt')]]];
    lehrfahrer_audit_file_store(lehrfahrer_audit_file_directory($company),$record);
  `);
  const query = 'city=stadt-a&line=Route_A&lineFolder=Linie_1&categoryFolder=Standard';
  assert.equal((await request('/api/list_lines.php')).status, 503);
  assert.equal((await request('/api/list_lines.php?scope=driver')).status, 503);
  assert.equal((await request('/api/load_line.php?' + query)).status, 503);
  for (const endpoint of ['download_line_json.php', 'download_line_gpx.php', 'download_line_pdf.php']) {
    assert.equal((await request('/api/' + endpoint + '?' + query)).status, 503, endpoint);
  }
  assert.deepEqual((await request('/api/list_lines.php', {}, sessionB)).json().lines.map(x => x.fileBase), ['Route_B']);
  runPhp(`
    require ${phpString(path.join(root, 'api/_audit_file_operation.php'))};
    $pdo=lehrfahrer_control_database();
    lehrfahrer_audit_file_recover($pdo,${phpString(companyA.id)});
  `);
  assert.deepEqual((await request('/api/list_lines.php')).json().lines.map(x => x.fileBase), ['Route_A']);
  assert.deepEqual((await request('/api/list_lines.php?scope=driver')).json().lines, []);
  assert.equal((await request('/api/load_line.php?' + query)).status, 200);
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
    assert.equal(saveGpx.status, 410, saveGpx.body);
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
  assert.equal(gpx.status, 410, gpx.body);
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
    directionName: 'Nord', stops: [], routePoints: [[51.7, 14.3], [51.71, 14.31]]
  };
  const first = await request('/api/save_line.php', { json: route });
  assert.equal(first.status, 200, first.body);
  assert.equal(first.json().changeType, 'NEW');
  const second = await request('/api/save_line.php', { json: route });
  assert.equal(second.status, 200, second.body);
  assert.equal(second.json().changeType, 'NEW');
  assert.notEqual(second.json().fileBase, first.json().fileBase);
});

test('Semantischer Save erhält UNCHANGED-Status und stuft CHANGED zurück', async () => {
  const inventoryPath = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'index', 'work-inventory.json');
  fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
  const entries = ['GEPRUEFT', 'FREIGEGEBEN'].map((status, index) => ({
    routeId: `route-status-${index}`, variantId: `variant-status-${index}`, status: 'IN_BEARBEITUNG', timetableStatus: 'UNVERAENDERT'
  }));
  fs.writeFileSync(inventoryPath, JSON.stringify({ entries }));
  for (const [index, entry] of entries.entries()) {
    const status = index === 0 ? 'GEPRUEFT' : 'FREIGEGEBEN';
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
      if (expected === 'NEW') {
        inventory.entries[index].status = status;
        inventory.entries[index].reviewRequired = status !== 'FREIGEGEBEN';
        fs.writeFileSync(inventoryPath, JSON.stringify(inventory));
      } else {
        assert.equal(inventory.entries[index].status, expected === 'UNCHANGED' ? status : 'IN_BEARBEITUNG');
        const driverLoad = await request(`/api/load_line.php?scope=driver&city=stadt-a&line=${base.fileBase}&lineFolder=Linie_43&categoryFolder=Standard`);
        assert.equal(driverLoad.status, expected === 'UNCHANGED' && status === 'FREIGEGEBEN' ? 200 : 404);
        const driverList = await request('/api/list_lines.php?scope=driver&city=stadt-a');
        assert.equal(driverList.status, 200, driverList.body);
        assert.equal(driverList.json().lines.some(line => line.fileBase === base.fileBase),
          expected === 'UNCHANGED' && status === 'FREIGEGEBEN');
      }
    }
  }
});

test('Account-Save koppelt JSON, PDF und GPX; UNCHANGED schreibt nichts und repariert nur Fehlendes', async () => {
  const directory = path.join(privateRoot, 'companies', companyA.id, 'lines', 'stadt-a', 'Linie_52', 'Standard');
  const route = { city: 'stadt-a', lineFolder: 'Linie_52', categoryFolder: 'Standard',
    fileBase: 'Route_Bundle', lineName: 'Linie 52', routeName: 'Route Bundle', directionName: 'Nord',
    routePoints: [[51.7, 14.3], [51.71, 14.31]],
    stops: [{ name: 'A', lat: 51.7, lon: 14.3 }, { name: 'B', lat: 51.71, lon: 14.31 }] };
  const files = ['json', 'pdf', 'gpx'].map(extension => path.join(directory, `Route_Bundle.${extension}`));
  const first = await request('/api/save_line.php', { json: route });
  assert.equal(first.status, 200, first.body);
  assert.equal(first.json().changeType, 'NEW');
  assert.ok(files.every(file => fs.existsSync(file)));
  const timestamps = files.map(file => fs.statSync(file).mtimeMs);
  const second = await request('/api/save_line.php', { json: { ...route, forceOverwrite: true } });
  assert.equal(second.status, 200, second.body);
  assert.equal(second.json().changeType, 'UNCHANGED');
  assert.equal(second.json().artifactRepair, false);
  assert.deepEqual(files.map(file => fs.statSync(file).mtimeMs), timestamps);
  fs.rmSync(files[2]);
  const repaired = await request('/api/save_line.php', { json: { ...route, forceOverwrite: true } });
  assert.equal(repaired.status, 200, repaired.body);
  assert.equal(repaired.json().changeType, 'UNCHANGED');
  assert.equal(repaired.json().artifactRepair, true);
  assert.ok(fs.existsSync(files[2]));
  assert.deepEqual(files.slice(0, 2).map(file => fs.statSync(file).mtimeMs), timestamps.slice(0, 2));
  const gpxBefore = fs.readFileSync(files[2]);
  const standalone = await request('/api/save_gpx.php', { json: {
    city: route.city, lineFolder: route.lineFolder, categoryFolder: route.categoryFolder,
    filename: 'Route_Bundle.gpx', gpx: '<gpx>foreign</gpx>'
  } });
  assert.equal(standalone.status, 410);
  assert.deepEqual(fs.readFileSync(files[2]), gpxBefore);
});

test('Legacy-Token kann weder JSON noch GPX schreiben', async () => {
  for (const endpoint of ['save_line.php', 'save_gpx.php']) {
    const response = await request('/api/' + endpoint, { headers: { 'X-Api-Token': legacyToken }, json: {} }, null);
    assert.equal(response.status, 401, response.body);
  }
});
test('GPX-Vorbereitungsfehler verhindert jede Aktivierung eines bestehenden Routensatzes', async () => {
  const route = { city: 'stadt-a', lineFolder: 'Linie_53', categoryFolder: 'Standard',
    fileBase: 'Route_Atomic', lineName: 'Linie 53', routeName: 'Route Atomic',
    routePoints: [[51.7, 14.3], [51.71, 14.31]], stops: [] };
  const saved = await request('/api/save_line.php', { json: route });
  assert.equal(saved.status, 200, saved.body);
  const directory = path.join(privateRoot, 'companies', companyA.id, 'lines', 'stadt-a', 'Linie_53', 'Standard');
  const files = ['json', 'pdf', 'gpx'].map(extension => path.join(directory, `Route_Atomic.${extension}`));
  const before = files.map(file => fs.readFileSync(file));
  const failed = await request('/api/save_line.php', { json: {
    ...route, forceOverwrite: true, routePoints: [], stops: [], directionName: 'Geaendert'
  } });
  assert.equal(failed.status, 409, failed.body);
  files.forEach((file, i) => assert.deepEqual(fs.readFileSync(file), before[i]));
});
test('Account-Route-Write erzwingt CSRF und lehnt Legacy-Session ab', async () => {
  for (const endpoint of ['save_line.php', 'save_gpx.php']) {
    const wrongCsrf = await request('/api/' + endpoint, { json: {}, headers: { 'X-CSRF-Token': 'wrong' } },
      { ...accountSessionA, csrf: 'wrong' });
    assert.equal(wrongCsrf.status, 403, wrongCsrf.body);
    const legacy = await request('/api/' + endpoint, { json: {} },
      { ...sessionA });
    assert.equal(legacy.status, 403, legacy.body);
  }
});
function auditRouteEvents() {
  return JSON.parse(runPhp(`
    require ${phpString(path.join(root, 'api/_audit.php'))};
    $pdo=lehrfahrer_control_database();
    echo json_encode(['chain'=>lehrfahrer_audit_verify_chain($pdo),
      'events'=>$pdo->query("SELECT action,object_id,company_id,account_id,membership_id,result FROM audit_events WHERE object_type='ROUTE' ORDER BY sequence_number")->fetchAll(PDO::FETCH_ASSOC)]);
  `));
}

function auditStatus(routeId, variantId, status, revoke = false, company = companyA.id) {
  return JSON.parse(runPhp(`
    require ${phpString(path.join(root, 'api/_route_audit.php'))};
    $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=${phpString(accountSessionA.cookie.split('=').slice(1).join('='))};
    $auth=lehrfahrer_api_require_session();
    $auth['company_id']=${phpString(company)};
    try {
      $inventory=lehrfahrer_route_audit_status($auth,${phpString(routeId)},${phpString(variantId)},
        ${phpString(status)},${revoke ? 'true' : 'false'});
      echo json_encode(['ok'=>true,'inventory'=>$inventory]);
    } catch (Throwable $error) {
      echo json_encode(['ok'=>false,'error'=>get_class($error)]);
    }
  `));
}

function rejectAuditAction(action) {
  runPhp(`
    require ${phpString(path.join(root, 'api/_audit.php'))};
    $pdo=lehrfahrer_control_database();
    $pdo->exec("CREATE TRIGGER reject_route_audit BEFORE INSERT ON audit_events WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END");
  `);
}

function restoreAuditWrites() {
  runPhp(`
    require ${phpString(path.join(root, 'api/_audit.php'))};
    lehrfahrer_control_database()->exec('DROP TRIGGER IF EXISTS reject_route_audit');
  `);
}

test('A4 koppelt den echten Save, Freigaben und Loeschen an technische Auditziele', async () => {
  const routeId = 'audit-route';
  const variantId = 'audit-variant';
  const inventoryPath = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'index', 'work-inventory.json');
  const entry = { routeId, variantId, status: 'UNGEPRUEFT', timetableStatus: 'UNVERAENDERT' };
  fs.writeFileSync(inventoryPath, JSON.stringify({ entries: [entry] }));
  assert.equal(auditStatus(routeId, variantId, 'IN_BEARBEITUNG').ok, true);
  const route = {
    city: 'stadt-a', lineFolder: 'Linie_51', categoryFolder: 'Standard',
    fileBase: 'Route_Audit', lineName: 'Private route name', routeName: 'Audit route',
    description: 'Private remark must never enter audit',
    stops: [{ name: 'A', lat: 51.7, lon: 14.3 }, { name: 'B', lat: 51.71, lon: 14.31 }],
    routePoints: [[51.7, 14.3], [51.71, 14.31]],
    meta: { gtfsWork: { routeId, variantId } }
  };
  const save = payload => request('/api/save_line.php', { json: payload });
  assert.equal((await save(route)).status, 200);
  const before = auditRouteEvents().events.length;
  const loadUrl = '/api/load_line.php?city=stadt-a&line=Route_Audit&lineFolder=Linie_51&categoryFolder=Standard';
  assert.equal((await request(loadUrl)).status, 200);
  assert.equal(auditRouteEvents().events.length, before);
  assert.equal(auditStatus(routeId, variantId, 'GEPRUEFT').ok, true);
  assert.equal(auditStatus(routeId, variantId, 'FREIGEGEBEN').ok, true);
  assert.equal((await request(loadUrl + '&scope=driver')).status, 200);
  const releasedBytes = fs.readFileSync(inventoryPath, 'utf8');
  const eventCount = auditRouteEvents().events.length;
  assert.equal(auditStatus(routeId, variantId, 'FREIGEGEBEN').ok, true);
  assert.equal((await save({ ...route, forceOverwrite: true })).json().changeType, 'UNCHANGED');
  assert.equal(fs.readFileSync(inventoryPath, 'utf8'), releasedBytes);
  assert.equal(auditRouteEvents().events.length, eventCount);

  const routeDir = path.join(privateRoot, 'companies', companyA.id, 'lines', 'stadt-a', 'Linie_51', 'Standard');
  const files = ['json', 'pdf', 'gpx'].map(ext => path.join(routeDir, 'Route_Audit.' + ext));
  const original = files.map(file => fs.readFileSync(file));
  const changed = { ...route, forceOverwrite: true, description: 'Changed private remark' };
  rejectAuditAction('ROUTE_AUTO_DOWNGRADE');
  try {
    assert.equal((await save(changed)).status, 409);
    assert.deepEqual(files.map(file => fs.readFileSync(file)), original);
    assert.equal(fs.readFileSync(inventoryPath, 'utf8'), releasedBytes);
    assert.equal(auditRouteEvents().events.length, eventCount);
  } finally { restoreAuditWrites(); }

  assert.equal((await save(changed)).json().changeType, 'CHANGED');
  assert.equal(JSON.parse(fs.readFileSync(inventoryPath)).entries[0].status, 'IN_BEARBEITUNG');
  assert.equal((await request(loadUrl + '&scope=driver')).status, 404);
  const statusBefore = fs.readFileSync(inventoryPath, 'utf8');
  const countBefore = auditRouteEvents().events.length;
  rejectAuditAction('ROUTE_REVIEW');
  try {
    assert.equal(auditStatus(routeId, variantId, 'GEPRUEFT').ok, false);
    assert.equal(fs.readFileSync(inventoryPath, 'utf8'), statusBefore);
    assert.equal(auditRouteEvents().events.length, countBefore);
  } finally { restoreAuditWrites(); }
  assert.equal(auditStatus(routeId, variantId, 'GEPRUEFT').ok, true);
  assert.equal(auditStatus(routeId, variantId, 'FREIGEGEBEN').ok, true);
  assert.equal(auditStatus(routeId, variantId, 'IN_BEARBEITUNG', true).ok, true);
  assert.equal((await request(loadUrl + '&scope=driver')).status, 404);
  const inventoryBefore = fs.readFileSync(inventoryPath, 'utf8');
  assert.equal(auditStatus(routeId, variantId, 'GEPRUEFT', false, companyB.id).ok, false);
  assert.equal(fs.readFileSync(inventoryPath, 'utf8'), inventoryBefore);

  const deletePayload = { city: 'stadt-a', line: 'Route_Audit', lineFolder: 'Linie_51', categoryFolder: 'Standard' };
  const deleteBefore = files.map(file => fs.readFileSync(file));
  rejectAuditAction('ROUTE_DELETE');
  try {
    assert.equal((await request('/api/delete_line.php', { json: deletePayload })).status, 503);
    assert.deepEqual(files.map(file => fs.readFileSync(file)), deleteBefore);
  } finally { restoreAuditWrites(); }
  assert.equal((await request('/api/delete_line.php', { json: deletePayload })).status, 200);
  assert.ok(files.every(file => !fs.existsSync(file)));
  const ledger = auditRouteEvents();
  assert.equal(ledger.chain, true);
  const ownEvents = ledger.events.slice(before - 1);
  assert.deepEqual(ownEvents.map(event => event.action), [
    'ROUTE_CREATE', 'ROUTE_REVIEW', 'ROUTE_RELEASE', 'ROUTE_CHANGE', 'ROUTE_AUTO_DOWNGRADE',
    'ROUTE_REVIEW', 'ROUTE_RELEASE', 'ROUTE_RELEASE_REVOKE', 'ROUTE_DELETE'
  ]);
  assert.equal(new Set(ownEvents.map(event => event.object_id)).size, 1);
  assert.ok(ownEvents.every(event => event.company_id === companyA.id && event.account_id
    && event.membership_id && event.result === 'SUCCESS'));
  assert.doesNotMatch(JSON.stringify(ledger), /Private route name|Private remark|Changed private remark|51\.7|Route_Audit/);
});

test('A4 verweigert Token und Legacy-Session fuer Loeschen und GTFS-Status', async () => {
  for (const [url, payload] of [
    ['/api/delete_line.php', {}],
    ['/api/import_gtfs.php', { action: 'workstatus', routeId: 'r', variantId: 'v', status: 'GEPRUEFT' }]
  ]) {
    const body = url.includes('import_gtfs') ? { form: payload } : { json: payload };
    const tokenResult = await request(url, { ...body, headers: { 'X-Api-Token': legacyToken } }, null);
    assert.ok([401, 403].includes(tokenResult.status), tokenResult.body);
  }
  // Preserve the legacy cookie deliberately; the request helper normally selects the account.
  const legacy = { ...sessionA };
  const result = await request('/api/delete_line.php', { json: {} }, legacy);
  assert.equal(result.status, 403);
});

test('GTFS-Pilot verwendet die gemeinsame Mehrfachanlage mit einem Audit je Route', () => {
  const result = JSON.parse(runPhp(`
    require ${phpString(path.join(root, 'api/_route_audit.php'))};
    require ${phpString(path.join(root, 'api/_gtfs_route_creation.php'))};
    $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=${phpString(accountSessionA.cookie.split('=').slice(1).join('='))};
    $auth=lehrfahrer_api_require_session();
    $company=$auth['company_id'];
    $writes=[];
    foreach (['Route_Pilot_01','Route_Pilot_02'] as $file) {
      $writes[]=['path'=>lehrfahrer_route_file($company,'stadt-a',$file,'json','Linie_52','Standard',true),
        'data'=>['stops'=>[],'routePoints'=>[],'meta'=>['source'=>'GTFS-Fahrplanwechsel']]];
    }
    $root=lehrfahrer_route_line_city_path($company,'stadt-a');
    lehrfahrer_gtfs_creation_install($root,$writes,static function(){},null,null,
      static fn($batch)=>lehrfahrer_route_audit_create_batch($auth,$batch));
    $foreign=lehrfahrer_route_file(${phpString(companyB.id)},'stadt-b','Route_ForeignBatch','json','Linie_52','Standard',true);
    $rejected=false;
    try {
      lehrfahrer_route_audit_create_batch($auth,[['path'=>$foreign,'data'=>['stops'=>[]]]]);
    } catch (InvalidArgumentException | RuntimeException $error) { $rejected=true; }
    if (!$rejected || is_file($foreign)) throw new RuntimeException('Foreign batch accepted');
    echo json_encode(['present'=>array_map(static fn($write)=>is_file($write['path']),$writes),
      'chain'=>lehrfahrer_audit_verify_chain($auth['pdo'])]);
  `));
  assert.deepEqual(result, { present: [true, true], chain: true });
  assert.ok(auditRouteEvents().events.slice(-2).every(event =>
    event.action === 'ROUTE_CREATE' && event.company_id === companyA.id && event.account_id));
});

test('Wartung koppelt PDF/GPX und Ghost-Normalisierung samt Freigaberueckstufung', async () => {
  const city = 'wartung-a';
  runPhp(`
    require ${phpString(path.join(root, 'api/_tenant_route_storage.php'))};
    lehrfahrer_route_register_city(${phpString(companyA.id)},${phpString(city)});
  `);
  const routeId = 'maintenance-route';
  const variantId = 'maintenance-variant';
  const inventoryPath = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'index', 'work-inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify({ entries: [{
    routeId, variantId, status: 'IN_BEARBEITUNG', timetableStatus: 'UNVERAENDERT'
  }] }));
  const route = {
    city, lineFolder: 'Linie_53', categoryFolder: 'Standard', fileBase: 'Route_Wartung',
    lineName: 'Linie 53', routeName: 'Route Wartung',
    stops: [
      { name: 'Freie Haltestelle 1', sourceType: 'free', lat: 51.7, lon: 14.3 },
      { name: 'Ziel', sourceType: 'catalog', lat: 51.71, lon: 14.31 }
    ],
    routePoints: [[51.7, 14.3], [51.71, 14.31]],
    meta: { gtfsWork: { routeId, variantId } }
  };
  assert.equal((await request('/api/save_line.php', { json: route })).status, 200);
  assert.equal(auditStatus(routeId, variantId, 'GEPRUEFT').ok, true);
  assert.equal(auditStatus(routeId, variantId, 'FREIGEGEBEN').ok, true);
  const dir = path.join(privateRoot, 'companies', companyA.id, 'lines', city, 'Linie_53', 'Standard');
  const files = ['json', 'pdf', 'gpx'].map(ext => path.join(dir, 'Route_Wartung.' + ext));
  fs.writeFileSync(files[1], '%PDF-old');
  fs.writeFileSync(files[2], '<gpx>old</gpx>');
  const original = files.map(file => fs.readFileSync(file));
  const released = fs.readFileSync(inventoryPath);
  const count = auditRouteEvents().events.length;
  rejectAuditAction('ROUTE_ARTIFACT_REPAIR');
  try {
    const failed = await request('/api/regenerate_pdfs.php', { json: { city } });
    assert.equal(failed.status, 200);
    assert.equal(failed.json().generatedPdfCount, 0);
    assert.equal(failed.json().errors.length, 1);
    assert.deepEqual(files.map(file => fs.readFileSync(file)), original);
    assert.equal(auditRouteEvents().events.length, count);
  } finally { restoreAuditWrites(); }
  const regenerated = await request('/api/regenerate_pdfs.php', { json: { city } });
  assert.equal(regenerated.json().generatedPdfCount, 1, regenerated.body);
  assert.equal(regenerated.json().generatedGpxCount, 1);
  assert.deepEqual(fs.readFileSync(files[0]), original[0]);
  assert.deepEqual(fs.readFileSync(inventoryPath), released);

  const beforeGhost = files.map(file => fs.readFileSync(file));
  const beforeGhostCount = auditRouteEvents().events.length;
  rejectAuditAction('ROUTE_AUTO_DOWNGRADE');
  try {
    const failed = await request('/api/normalize_ghost_points.php', { json: { city } });
    assert.equal(failed.json().modifiedLineCount, 0, failed.body);
    assert.equal(failed.json().modifiedStopCount, 0);
    assert.equal(failed.json().errors.length, 1);
    assert.deepEqual(files.map(file => fs.readFileSync(file)), beforeGhost);
    assert.deepEqual(fs.readFileSync(inventoryPath), released);
    assert.equal(auditRouteEvents().events.length, beforeGhostCount);
  } finally { restoreAuditWrites(); }
  const normalized = await request('/api/normalize_ghost_points.php', { json: { city } });
  assert.equal(normalized.json().modifiedLineCount, 1, normalized.body);
  assert.equal(normalized.json().modifiedStopCount, 1);
  assert.equal(normalized.json().errors.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(files[0])).stops[0].isGhostPoint, true);
  assert.equal(JSON.parse(fs.readFileSync(inventoryPath)).entries[0].status, 'IN_BEARBEITUNG');
  const afterGhostCount = auditRouteEvents().events.length;
  const repeated = await request('/api/normalize_ghost_points.php', { json: { city } });
  assert.equal(repeated.json().modifiedLineCount, 0);
  assert.equal(auditRouteEvents().events.length, afterGhostCount);
  assert.deepEqual(auditRouteEvents().events.slice(-2).map(event => event.action),
    ['ROUTE_CHANGE', 'ROUTE_AUTO_DOWNGRADE']);
  assert.equal(auditRouteEvents().chain, true);
});
