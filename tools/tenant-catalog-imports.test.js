const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-phase4d-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
const password = 'Phase4D-Testpasswort!';
let php; let phpArgs; let server; let vbbServer; let origin; let vbbOrigin;
let companyA; let companyB; let sessionA; let sessionB;
const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const env = () => ({ ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
  LEHRFAHRER_ENV: 'dev', LEHRFAHRER_PUBLIC_ORIGIN: origin,
  LEHRFAHRER_API_TOKEN: 'phase4d-token', LEHRFAHRER_LEGACY_COMPANY_ID: companyA?.id || '',
  VBB_API_BASE_URL: vbbOrigin, VBB_ACCESS_ID: 'test-access' });
function runPhp(code) {
  const result = spawnSync(php, [...phpArgs, '-r', code], { cwd: root, env: env(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function freePort() {
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
  if (options.body !== undefined) {
    headers.Origin = origin;
    headers['X-CSRF-Token'] = session?.csrf || '';
  }
  const response = await fetch(origin + url, {
    method: options.body === undefined ? 'GET' : 'POST', headers, body: options.body,
    redirect: 'manual'
  });
  const body = await response.text();
  return { status: response.status, body, json: () => JSON.parse(body), headers: response.headers };
}
function form(values) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.append(key, value);
  return body;
}
async function login(slug) {
  const response = await request('/api/auth/login.php', { body: JSON.stringify({
    company: slug, login: 'admin', password
  }), headers: { 'Content-Type': 'application/json' } }, null);
  assert.equal(response.status, 200, response.body);
  return { cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0], csrf: response.json().csrfToken };
}
function zipFixture(company, agency, route) {
  const file = path.join(privateRoot, 'companies', company.id, 'imports', 'gtfs', 'latest.zip');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tables = {
    'agency.txt': `agency_id,agency_name\n${agency},Test Company ${agency}\n`,
    'routes.txt': `route_id,agency_id,route_short_name,route_long_name,route_type\n${route},${agency},15,Route ${route},3\n`,
    'stops.txt': `stop_id,stop_name,stop_lat,stop_lon\n${route}_1,First,51.7,14.3\n${route}_2,Second,51.71,14.31\n`,
    'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id\n${route},all,${route}_trip,Second,0\n`,
    'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${route}_trip,08:00:00,08:00:00,${route}_1,1\n${route}_trip,08:05:00,08:05:00,${route}_2,2\n`
  };
  const payload = Buffer.from(JSON.stringify(tables), 'utf8').toString('base64');
  runPhp(`$z=new ZipArchive(); $z->open(${phpString(file)}, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    foreach(json_decode(base64_decode(${phpString(payload)}),true) as $name=>$contents) $z->addFromString($name,$contents); $z->close();`);
  return file;
}

before(async () => {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  php = candidates.find(candidate => {
    if (!candidate) return false;
    const check = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    return !check.error && check.status === 0;
  });
  if (!php) throw new Error('PHP fehlt.');
  phpArgs = [];
  const zip = spawnSync(php, ['-r', "echo class_exists('ZipArchive') ? 'yes' : 'no';"], { encoding: 'utf8' });
  if (zip.stdout !== 'yes') phpArgs = ['-d', 'extension=zip'];
  const enabled = spawnSync(php, [...phpArgs, '-r', "echo class_exists('ZipArchive') ? 'yes' : 'no';"], { encoding: 'utf8' });
  if (enabled.stdout !== 'yes') throw new Error('PHP ZipArchive fehlt.');
  fs.mkdirSync(webroot);
  fs.cpSync(path.join(root, 'api'), path.join(webroot, 'api'), { recursive: true });
  origin = 'http://127.0.0.1:' + await freePort();
  vbbOrigin = 'http://127.0.0.1:' + await freePort();
  vbbServer = http.createServer((req, res) => {
    const url = new URL(req.url, vbbOrigin);
    let data = {};
    if (url.pathname.endsWith('/location.name')) data = { stopLocationOrCoordLocation: [
      { StopLocation: { name: 'Town A First', id: 'stop1', lat: 51.7, lon: 14.3 } }
    ] };
    if (url.pathname.endsWith('/departureBoard')) data = { Departure: [
      { Product: { line: '15' }, JourneyDetailRef: { ref: 'trip-a' }, direction: 'Second', stop: 'First' }
    ] };
    if (url.pathname.endsWith('/journeyDetail')) data = { Names: { Name: [{ name: '15' }] }, Stops: { Stop: [
      { name: 'First', id: 'stop1', lat: 51.7, lon: 14.3 },
      { name: 'Second', id: 'stop2', lat: 51.71, lon: 14.31 }
    ] } };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => vbbServer.listen(Number(new URL(vbbOrigin).port), '127.0.0.1', resolve));
  const seed = `require ${phpString(path.join(root, 'api', '_control_repositories.php'))};
    $pdo=lehrfahrer_control_database(); $companies=new LehrfahrerCompanyRepository($pdo);
    $users=new LehrfahrerUserRepository($pdo); $roles=new LehrfahrerRoleRepository($pdo); $result=[];
    foreach (['firma-a','firma-b'] as $slug) {
      $company=$companies->create(['slug'=>$slug,'name'=>$slug,'status'=>'active','license_status'=>'active']);
      $user=$users->create($company['id'],['login'=>'admin','display_name'=>'Admin','password'=>${phpString(password)}]);
      $roles->assignRole($company['id'],$user['id'],'ADMIN'); $result[]=$company;
    } echo json_encode($result);`;
  [companyA, companyB] = JSON.parse(runPhp(seed));
  for (const [company, city] of [[companyA, 'town-a'], [companyB, 'town-b']]) {
    fs.mkdirSync(path.join(privateRoot, 'companies', company.id, 'cities', city), { recursive: true });
  }
  zipFixture(companyA, 'agencyA', 'routeA'); zipFixture(companyB, 'agencyB', 'routeB');
  server = spawn(php, [...phpArgs, '-S', origin.replace('http://', ''), '-t', webroot],
    { cwd: webroot, env: env(), stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin + '/api/auth/runtime.php')).status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  sessionA = await login('firma-a'); sessionB = await login('firma-b');
});
after(() => { if (server) server.kill(); if (vbbServer) vbbServer.close();
  fs.rmSync(sandbox, { recursive: true, force: true }); });

test('Kataloge A/B bleiben getrennt; Legacy-Token sieht nur A', async () => {
  const stopsA = [{ id: 'a1', name: 'A-Halt', lat: 51.7, lon: 14.3 }];
  const stopsB = [{ id: 'b1', name: 'B-Halt', lat: 51.8, lon: 14.4 }];
  const save = (session, stops) => request('/api/save_catalog.php', { body: form({
    catalog: JSON.stringify(stops), company_id: companyB.id
  }) }, session);
  assert.equal((await save(sessionA, stopsA)).status, 200);
  assert.equal((await save(sessionB, stopsB)).status, 200);
  const a = await request('/api/load_catalog.php?company_id=' + companyB.id);
  const b = await request('/api/load_catalog.php', {}, sessionB);
  assert.deepEqual(a.json().stops.map(stop => stop.name), ['A-Halt']);
  assert.deepEqual(b.json().stops.map(stop => stop.name), ['B-Halt']);
  const legacy = await request('/api/load_catalog.php', { headers: { 'X-Api-Token': 'phase4d-token' } }, null);
  assert.deepEqual(legacy.json().stops.map(stop => stop.name), ['A-Halt']);
  assert.equal(fs.existsSync(path.join(webroot, 'data', 'haltestellen.js')), false);
  assert.equal((await request('/private/companies/' + companyA.id + '/catalogs/haltestellen.json')).status, 404);
});

test('GTFS-A/B-Upload, Sessions und Indizes kollidieren nicht', async () => {
  const upload = async (session, file) => {
    const body = form({ action: 'upload' });
    body.append('feed', new Blob([fs.readFileSync(file)], { type: 'application/zip' }), 'feed.zip');
    return request('/api/import_gtfs.php', { body }, session);
  };
  const aFile = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'latest.zip');
  const bFile = path.join(privateRoot, 'companies', companyB.id, 'imports', 'gtfs', 'latest.zip');
  const [aUpload, bUpload] = await Promise.all([upload(sessionA, aFile), upload(sessionB, bFile)]);
  assert.equal(aUpload.status, 200, aUpload.body);
  assert.equal(bUpload.status, 200, bUpload.body);
  const aToken = aUpload.json().token; const bToken = bUpload.json().token;
  assert.notEqual(aToken, bToken);
  const baseA = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs');
  const baseB = path.join(privateRoot, 'companies', companyB.id, 'imports', 'gtfs');
  assert.ok(fs.existsSync(path.join(baseA, 'sessions', aToken, 'feed.zip')));
  assert.ok(fs.existsSync(path.join(baseB, 'sessions', bToken, 'feed.zip')));
  assert.equal(fs.existsSync(path.join(baseA, 'sessions', bToken)), false);
  assert.equal(fs.existsSync(path.join(baseB, 'sessions', aToken)), false);
  const routes = (session, token, agencyIds) => request('/api/import_gtfs.php', { body: form({
    action: 'routes', token, agencyIds: JSON.stringify(agencyIds)
  }) }, session);
  const [aRoutes, bRoutes] = await Promise.all([
    routes(sessionA, aToken, ['agencyA']), routes(sessionB, bToken, ['agencyB'])
  ]);
  assert.equal(aRoutes.status, 200, aRoutes.body); assert.equal(bRoutes.status, 200, bRoutes.body);
  assert.deepEqual(aRoutes.json().routes.map(route => route.id), ['routeA']);
  assert.deepEqual(bRoutes.json().routes.map(route => route.id), ['routeB']);
  assert.equal((await routes(sessionA, bToken, ['agencyB'])).status, 410);
  assert.equal((await routes(sessionB, aToken, ['agencyA'])).status, 410);
  const start = (session, agency) => request('/api/import_gtfs.php', { body: form({
    action: 'indexstart', agencyIds: JSON.stringify([agency])
  }) }, session);
  const [aIndex, bIndex] = await Promise.all([start(sessionA, 'agencyA'), start(sessionB, 'agencyB')]);
  assert.equal(aIndex.status, 200, aIndex.body); assert.equal(bIndex.status, 200, bIndex.body);
  assert.ok(fs.existsSync(path.join(baseA, 'index', 'variants.building.sqlite')));
  assert.ok(fs.existsSync(path.join(baseB, 'index', 'variants.building.sqlite')));
  for (let i = 0; i < 20; i++) {
    const [stepA, stepB] = await Promise.all([
      request('/api/import_gtfs.php', { body: form({ action: 'indexstep' }) }, sessionA),
      request('/api/import_gtfs.php', { body: form({ action: 'indexstep' }) }, sessionB)
    ]);
    assert.equal(stepA.status, 200, stepA.body); assert.equal(stepB.status, 200, stepB.body);
    if (stepA.json().done && stepB.json().done) break;
  }
  assert.ok(fs.existsSync(path.join(baseA, 'index', 'variants.sqlite')));
  assert.ok(fs.existsSync(path.join(baseB, 'index', 'variants.sqlite')));
  const indexRoutes = file => JSON.parse(runPhp(`$pdo=new PDO('sqlite:' . ${phpString(file)});
    echo json_encode($pdo->query('SELECT route_id FROM routes')->fetchAll(PDO::FETCH_COLUMN));`));
  assert.deepEqual(indexRoutes(path.join(baseA, 'index', 'variants.sqlite')), ['routeA']);
  assert.deepEqual(indexRoutes(path.join(baseB, 'index', 'variants.sqlite')), ['routeB']);
  const bIndexBytes = fs.readFileSync(path.join(baseB, 'index', 'variants.sqlite'));
  const restartA = await request('/api/import_gtfs.php', { body: form({
    action: 'indexstart', restart: '1', agencyIds: JSON.stringify(['agencyA'])
  }) });
  assert.equal(restartA.status, 200, restartA.body);
  assert.deepEqual(fs.readFileSync(path.join(baseB, 'index', 'variants.sqlite')), bIndexBytes);
  assert.equal(fs.existsSync(path.join(webroot, 'gtfs', 'imports')), false);
  assert.equal((await request('/api/import_gtfs.php', { body: form({ action: 'routes', token: '../' }) })).status, 400);
  assert.equal((await request('/api/import_gtfs.php', { body: form({ action: 'routes', token: '%252e%252e' }) })).status, 400);
});

test('VBB akzeptiert nur eigenen Ort; Ergebnis bleibt ohne Server-Schreibpfad', async () => {
  const foreign = await request('/api/import_vbb_line.php', { body: JSON.stringify({
    action: 'import', lineQuery: '15', city: 'town-b'
  }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(foreign.status, 404, foreign.body);
  const own = await request('/api/import_vbb_line.php', { body: JSON.stringify({
    action: 'import', lineQuery: '15', city: 'town-a'
  }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(own.status, 200, own.body);
  assert.equal(own.json().line.city, 'town-a');
  assert.equal(fs.existsSync(path.join(privateRoot, 'companies', companyB.id, 'lines', 'town-a')), false);
});

test('Editor laedt Katalog authentifiziert; alle neuen Pfade sind privat', async () => {
  const editor = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(editor, /src="data\/haltestellen\.js/);
  assert.match(editor, /fetch\("api\/load_catalog\.php"/);
  assert.match(editor, /withApiAuthHeaders/);
  for (const area of ['catalogs', 'imports', 'settings']) {
    assert.equal((await request('/private/companies/' + companyA.id + '/' + area + '/')).status, 404);
  }
});

test('Symlink aus A auf B wird bei Katalog und GTFS abgewiesen', async t => {
  const aCatalog = path.join(privateRoot, 'companies', companyA.id, 'catalogs', 'haltestellen.json');
  const bCatalog = path.join(privateRoot, 'companies', companyB.id, 'catalogs', 'haltestellen.json');
  const backup = aCatalog + '.saved';
  fs.renameSync(aCatalog, backup);
  try {
    try { fs.symlinkSync(bCatalog, aCatalog, 'file'); }
    catch { return t.skip('Datei-Symlinks sind hier nicht verfuegbar.'); }
    const result = await request('/api/load_catalog.php');
    assert.notEqual(result.status, 200, result.body);
    assert.doesNotMatch(result.body, /B-Halt/);
    assert.doesNotMatch(result.body, /Stack trace|lehrfahrer-phase4d-/);
  } finally {
    if (fs.existsSync(aCatalog) || fs.lstatSync(aCatalog, { throwIfNoEntry: false })) fs.unlinkSync(aCatalog);
    fs.renameSync(backup, aCatalog);
  }
  const aZip = path.join(privateRoot, 'companies', companyA.id, 'imports', 'gtfs', 'latest.zip');
  const bZip = path.join(privateRoot, 'companies', companyB.id, 'imports', 'gtfs', 'latest.zip');
  fs.renameSync(aZip, aZip + '.saved');
  try {
    fs.symlinkSync(bZip, aZip, 'file');
    const result = await request('/api/import_gtfs.php', { body: form({ action: 'server' }) });
    assert.notEqual(result.status, 200, result.body);
    assert.doesNotMatch(result.body, /agencyB/);
    assert.doesNotMatch(result.body, /Stack trace|lehrfahrer-phase4d-/);
  } finally {
    if (fs.existsSync(aZip) || fs.lstatSync(aZip, { throwIfNoEntry: false })) fs.unlinkSync(aZip);
    fs.renameSync(aZip + '.saved', aZip);
  }
});
