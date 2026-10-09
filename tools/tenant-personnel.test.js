const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-phase4c-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
const password = 'Phase4C-Testpasswort!';
let php; let server; let origin; let companyA; let companyB; let sessionA; let sessionB;
const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const env = () => ({ ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
  LEHRFAHRER_ENV: 'dev', LEHRFAHRER_PUBLIC_ORIGIN: origin,
  LEHRFAHRER_API_TOKEN: 'phase4c-token', LEHRFAHRER_LEGACY_COMPANY_ID: companyA?.id || '' });
function runPhp(code) {
  const result = spawnSync(php, ['-r', code], { cwd: root, env: env(), encoding: 'utf8' });
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
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Origin = origin;
    headers['X-CSRF-Token'] = session?.csrf || '';
  }
  const response = await fetch(origin + url, { method: options.json === undefined ? 'GET' : 'POST',
    headers, body: options.json === undefined ? undefined : JSON.stringify(options.json) });
  const body = await response.text();
  return { status: response.status, body, json: () => JSON.parse(body), headers: response.headers };
}
async function login(slug) {
  const response = await request('/api/auth/login.php',
    { json: { company: slug, login: 'admin', password } }, null);
  assert.equal(response.status, 200, response.body);
  return { cookie: (response.headers?.get?.('set-cookie') || '').split(';', 1)[0],
    csrf: response.json().csrfToken };
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
  fs.mkdirSync(webroot);
  fs.cpSync(path.join(root, 'api'), path.join(webroot, 'api'), { recursive: true });
  origin = 'http://127.0.0.1:' + await freePort();
  const seed = `require ${phpString(path.join(root, 'api', '_control_repositories.php'))};
    $pdo=lehrfahrer_control_database(); $companies=new LehrfahrerCompanyRepository($pdo);
    $users=new LehrfahrerUserRepository($pdo); $roles=new LehrfahrerRoleRepository($pdo); $result=[];
    foreach (['firma-a','firma-b'] as $slug) {
      $company=$companies->create(['slug'=>$slug,'name'=>$slug,'status'=>'active','license_status'=>'active']);
      $user=$users->create($company['id'],['login'=>'admin','display_name'=>'Admin','password'=>${phpString(password)}]);
      $roles->assignRole($company['id'],$user['id'],'ADMIN'); $result[]=$company;
    } echo json_encode($result);`;
  [companyA, companyB] = JSON.parse(runPhp(seed));
  const legacyDrivers = path.join(privateRoot, 'personnel', 'drivers.json');
  fs.mkdirSync(path.dirname(legacyDrivers), { recursive: true });
  fs.writeFileSync(legacyDrivers, '[{"id":"drv_legacy","firstName":"Legacy"}]');
  for (const [company, city, line] of [[companyA, 'stadt-a', 'Route_A'], [companyB, 'stadt-b', 'Route_B']]) {
    const routeDir = path.join(privateRoot, 'companies', company.id, 'lines', city, 'Linie_1', 'Standard');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.mkdirSync(path.join(privateRoot, 'companies', company.id, 'cities', city), { recursive: true });
    fs.writeFileSync(path.join(routeDir, line + '.json'), JSON.stringify({ lineName: line, routeName: 'Route 001', stops: [] }));
  }
  server = spawn(php, ['-S', origin.replace('http://', ''), '-t', webroot],
    { cwd: webroot, env: env(), stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin + '/api/auth/runtime.php')).status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  sessionA = await login('firma-a');
  sessionB = await login('firma-b');
});
after(() => { if (server) server.kill(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('Fahrer A/B getrennt; Fremd-ID kann nicht geaendert oder geloescht werden', async () => {
  const create = async (session, name) => request('/api/drivers.php',
    { json: { action: 'create', firstName: name, lastName: 'Test' } }, session);
  const a = await create(sessionA, 'Anna'); const b = await create(sessionB, 'Berta');
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  const idA = a.json().driver.id; const idB = b.json().driver.id;
  assert.deepEqual((await request('/api/drivers.php')).json().drivers.map(driver => driver.id), [idA]);
  assert.deepEqual((await request('/api/drivers.php', {}, sessionB)).json().drivers.map(driver => driver.id), [idB]);
  assert.deepEqual((await request('/api/drivers.php?company_id=' + companyB.id)).json().drivers.map(driver => driver.id), [idA]);
  assert.equal(fs.readFileSync(path.join(privateRoot, 'personnel', 'drivers.json'), 'utf8'),
    '[{"id":"drv_legacy","firstName":"Legacy"}]');
  for (const action of ['update', 'toggle', 'delete']) {
    const result = await request('/api/drivers.php', { json: { action, id: idB, firstName: 'X' } });
    assert.equal(result.status, 404, result.body);
  }
  const ownUpdate = await request('/api/drivers.php', { json: {
    action: 'update', id: idA, firstName: 'Anna Neu', lastName: 'Test'
  } });
  assert.equal(ownUpdate.status, 200, ownUpdate.body);
  const ownToggle = await request('/api/drivers.php', { json: { action: 'toggle', id: idA } });
  assert.equal(ownToggle.status, 200, ownToggle.body);
  globalThis.driverA = idA; globalThis.driverB = idB;
});

test('Einweisungen validieren Fahrer und Route im selben Tenant', async () => {
  const routeA = { city: 'stadt-a', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_A' };
  const routeB = { city: 'stadt-b', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_B' };
  const create = (session, driverId, route) => request('/api/trainings.php',
    { json: { action: 'create', driverId, routes: [route] } }, session);
  assert.equal((await create(sessionA, globalThis.driverB, routeA)).status, 404);
  assert.equal((await create(sessionA, globalThis.driverA, routeB)).status, 404);
  const a = await create(sessionA, globalThis.driverA, routeA);
  const bFirst = await create(sessionB, globalThis.driverB, routeB);
  const b = await create(sessionB, globalThis.driverB, routeB);
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  assert.equal(bFirst.status, 200, bFirst.body);
  assert.ok(a.body.startsWith('{'), a.body);
  assert.ok(b.body.startsWith('{'), b.body);
  const listA = await request('/api/trainings.php');
  const listB = await request('/api/trainings.php', {}, sessionB);
  assert.equal(listA.status, 200, listA.body);
  assert.equal(listB.status, 200, listB.body);
  assert.ok(listA.body.startsWith('{'), listA.body);
  assert.ok(listB.body.startsWith('{'), listB.body);
  assert.equal(listA.json().trainings.length, 1, listA.body);
  assert.equal(listB.json().trainings.length, 2, listB.body);
  globalThis.trainingA = a.json().training.trainingId;
  globalThis.trainingB = b.json().training.trainingId;
  for (const action of ['updateStatus', 'completeRoute']) {
    const result = await request('/api/trainings.php', { json: {
      action, trainingId: globalThis.trainingB, status: 'running', routeIndex: 0
    } });
    assert.equal(result.status, 404, result.body);
  }
  const own = await request('/api/trainings.php', { json: {
    action: 'completeRoute', trainingId: globalThis.trainingA, routeIndex: 0
  } });
  assert.equal(own.status, 200, own.body);
});

test('Pakete und PDFs bleiben pro Tenant; Fremd-Referenzen und Downloads scheitern', async () => {
  const itemA = { city: 'stadt-a', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_A' };
  const itemB = { city: 'stadt-b', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_B' };
  const create = (session, driverId, trainingId, item) => request('/api/create_driver_documents.php',
    { json: { driverId, trainingId, driverName: 'Test', items: [item] } }, session);
  assert.equal((await create(sessionA, globalThis.driverA, globalThis.trainingB, itemA)).status, 404);
  assert.equal((await create(sessionA, globalThis.driverA, globalThis.trainingA, itemB)).status, 404);
  const a = await create(sessionA, globalThis.driverA, globalThis.trainingA, itemA);
  const b = await create(sessionB, globalThis.driverB, globalThis.trainingB, itemB);
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  const packageA = a.json().package; const packageB = b.json().package;
  assert.equal((await request('/api/list_driver_packages.php')).json().packages.length, 1);
  assert.equal((await request('/api/list_driver_packages.php', {}, sessionB)).json().packages.length, 1);
  const pdf = await request('/api/download_driver_package.php?id=' + packageA.id + '&document=' + packageA.documents[0].file);
  assert.equal(pdf.status, 200, pdf.body); assert.match(pdf.body, /^%PDF/);
  const zip = await request('/api/download_driver_package.php?id=' + packageA.id);
  assert.ok([200, 501].includes(zip.status), zip.body);
  const pdfB = await request('/api/download_driver_package.php?id=' + packageB.id + '&document=' + packageB.documents[0].file, {}, sessionB);
  assert.equal(pdfB.status, 200, pdfB.body);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageB.id)).status, 404);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageA.id + '&document=..%2Fsecret.pdf')).status, 404);
  assert.equal((await request('/api/manage_driver_package.php', { json: { action: 'delete', id: packageB.id } })).status, 404);
  assert.equal((await request('/api/manage_driver_package.php', { json: { action: 'rename', id: packageB.id, driverName: 'X' } })).status, 404);
  assert.equal((await request('/api/create_driver_documents.php', { json: {
    mode: 'update', packageId: packageB.id, driverId: globalThis.driverA, items: [itemA]
  } })).status, 404);
  const legacy = await request('/api/list_driver_packages.php', { headers: { 'X-Api-Token': 'phase4c-token' } }, null);
  assert.equal(legacy.status, 200, legacy.body);
  assert.equal(legacy.json().packages.length, 1);
  for (const area of ['drivers', 'trainings', 'packages', 'documents']) {
    const location = path.join(privateRoot, 'companies', companyA.id, area);
    assert.ok(fs.existsSync(location));
    assert.equal((await request('/private/companies/' + companyA.id + '/' + area + '/')).status, 404);
  }
  const rename = await request('/api/manage_driver_package.php', { json: {
    action: 'rename', id: packageA.id, driverName: 'Anna Test'
  } });
  assert.equal(rename.status, 200, rename.body);
  const remove = await request('/api/manage_driver_package.php', { json: { action: 'delete', id: packageA.id } });
  assert.equal(remove.status, 200, remove.body);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageA.id)).status, 404);
});
