const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-capabilities-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
const legacyToken = 'phase3-legacy-token';
const password = 'Phase-3-Testpasswort!';
let php;
let server;
let origin;
let companyA;
let companyB;
const sessions = {};

const apiCases = [
  { name: 'list_cities', file: 'list_cities.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/list_cities.php' },
  { name: 'list_lines', file: 'list_lines.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/list_lines.php' },
  { name: 'load_line', file: 'load_line.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/load_line.php?line=phase3-missing' },
  { name: 'download_line_json', file: '_tenant_route_download.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/download_line_json.php?city=phase4b-missing&line=missing' },
  { name: 'download_line_gpx', file: '_tenant_route_download.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/download_line_gpx.php?city=phase4b-missing&line=missing' },
  { name: 'download_line_pdf', file: 'download_line_pdf.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/download_line_pdf.php?line=phase3-missing' },
  { name: 'city_settings GET', file: 'city_settings.php', capability: 'operations.settings.read', role: 'DISPONENT', method: 'GET', path: '/api/city_settings.php?city=phase3' },
  { name: 'drivers GET', file: 'drivers.php', capability: 'drivers.read', role: 'EINWEISER', method: 'GET', path: '/api/drivers.php' },
  { name: 'trainings GET', file: 'trainings.php', capability: 'trainings.read', role: 'EINWEISER', method: 'GET', path: '/api/trainings.php' },
  { name: 'list_driver_packages', file: 'list_driver_packages.php', capability: 'packages.read', role: 'EINWEISER', method: 'GET', path: '/api/list_driver_packages.php' },
  { name: 'download_driver_package', file: 'download_driver_package.php', capability: 'packages.download', role: 'EINWEISER', method: 'GET', path: '/api/download_driver_package.php?id=phase3-missing' },
  { name: 'pdf/preview_v2', file: 'pdf/preview_v2.php', capability: 'routes.read', role: 'FAHRER', method: 'GET', path: '/api/pdf/preview_v2.php' },
  { name: 'city_settings POST', file: 'city_settings.php', capability: 'operations.settings.write', role: 'DISPONENT', method: 'POST', path: '/api/city_settings.php', json: {} },
  { name: 'drivers mutate', file: 'drivers.php', capability: 'drivers.manage', role: 'DISPONENT', method: 'POST', path: '/api/drivers.php', json: {} },
  { name: 'trainings mutate', file: 'trainings.php', capability: 'trainings.manage', role: 'EINWEISER', method: 'POST', path: '/api/trainings.php', json: {} },
  { name: 'create_driver_documents', file: 'create_driver_documents.php', capability: 'packages.create', role: 'EINWEISER', method: 'POST', path: '/api/create_driver_documents.php', json: {} },
  { name: 'manage_driver_package', file: 'manage_driver_package.php', capability: 'packages.manage', role: 'DISPONENT', method: 'POST', path: '/api/manage_driver_package.php', json: {} },
  { name: 'save_line', file: 'save_line.php', capability: 'routes.write', role: 'EDITOR', method: 'POST', path: '/api/save_line.php', json: {} },
  { name: 'save_gpx', file: 'save_gpx.php', capability: 'routes.write', role: 'EDITOR', method: 'POST', path: '/api/save_gpx.php', json: {} },
  { name: 'delete_line', file: 'delete_line.php', capability: 'routes.delete', role: 'EDITOR', method: 'POST', path: '/api/delete_line.php', json: {} },
  { name: 'regenerate_pdfs', file: 'regenerate_pdfs.php', capability: 'routes.maintain', role: 'EDITOR', method: 'POST', path: '/api/regenerate_pdfs.php', json: { city: 'phase3-missing' } },
  { name: 'normalize_ghost_points', file: 'normalize_ghost_points.php', capability: 'routes.maintain', role: 'EDITOR', method: 'POST', path: '/api/normalize_ghost_points.php', json: { city: 'phase3-missing' } },
  { name: 'import_vbb_line', file: 'import_vbb_line.php', capability: 'routes.import', role: 'EDITOR', method: 'POST', path: '/api/import_vbb_line.php', json: {} },
  { name: 'import_gtfs', file: 'import_gtfs.php', capability: 'routes.import', role: 'EDITOR', method: 'POST', path: '/api/import_gtfs.php', form: { action: 'phase3-invalid' } },
  { name: 'create_city', file: 'create_city.php', capability: 'cities.manage', role: 'EDITOR', method: 'POST', path: '/api/create_city.php', json: {} },
  { name: 'manage_city analyze', file: 'manage_city.php', capability: 'cities.manage', role: 'EDITOR', method: 'POST', mutation: false, path: '/api/manage_city.php', json: { action: 'analyze' } },
  { name: 'manage_city mutate', file: 'manage_city.php', capability: 'cities.manage', role: 'EDITOR', method: 'POST', path: '/api/manage_city.php', json: { action: 'rename' } },
  { name: 'fetch_stops', file: 'fetch_stops.php', capability: 'stops.fetch', role: 'EDITOR', method: 'POST', mutation: false, path: '/api/fetch_stops.php', form: {} },
  { name: 'fetch_stops save', file: 'fetch_stops.php', capability: 'stops.catalog.write', role: 'EDITOR', method: 'POST', path: '/api/fetch_stops.php', form: { save: '1' } },
  { name: 'save_catalog', file: 'save_catalog.php', capability: 'stops.catalog.write', role: 'EDITOR', method: 'POST', path: '/api/save_catalog.php', form: {} }
];

function findPhp() {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function phpString(value) {
  return JSON.stringify(String(value).replaceAll('\\', '/'));
}

function environment() {
  return {
    ...process.env,
    LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
    LEHRFAHRER_ENV: 'dev',
    LEHRFAHRER_PUBLIC_ORIGIN: origin,
    LEHRFAHRER_API_TOKEN: legacyToken
  };
}

function mutateDatabase(sql) {
  const code = `require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};$pdo=lehrfahrer_control_database();$pdo->exec(${phpString(sql)});`;
  const result = spawnSync(php, ['-r', code], {
    cwd: projectRoot, env: environment(), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function request(apiCase, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (apiCase.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(apiCase.json);
  } else if (apiCase.form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(apiCase.form).toString();
  }
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
  if (options.legacy) headers['X-Api-Token'] = legacyToken;
  if (options.origin) headers.Origin = origin;
  const response = await fetch(origin + apiCase.path, {
    method: apiCase.method,
    headers,
    body,
    redirect: 'manual'
  });
  const text = await response.text();
  return { response, text };
}

async function login(role) {
  const response = await fetch(origin + '/api/auth/login.php', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: 'betrieb-a', login: role.toLowerCase(), password })
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const body = JSON.parse(text);
  return {
    cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0],
    csrf: body.csrfToken,
    capabilities: body.user.capabilities
  };
}

before(async () => {
  php = findPhp();
  if (!php) throw new Error('PHP ist für den Capability-Test erforderlich.');
  fs.mkdirSync(webroot, { recursive: true });
  fs.cpSync(path.join(projectRoot, 'api'), path.join(webroot, 'api'), { recursive: true });
  fs.mkdirSync(path.join(webroot, 'linien'), { recursive: true });
  fs.mkdirSync(path.join(webroot, 'data'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'VERSION'), path.join(webroot, 'VERSION'));
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;

  const seed = `
require ${phpString(path.join(projectRoot, 'api', '_control_repositories.php'))};
$pdo=lehrfahrer_control_database();$companies=new LehrfahrerCompanyRepository($pdo);$users=new LehrfahrerUserRepository($pdo);$roles=new LehrfahrerRoleRepository($pdo);
$a=$companies->create(['slug'=>'betrieb-a','name'=>'Betrieb A','status'=>'active','license_status'=>'active']);
$b=$companies->create(['slug'=>'betrieb-b','name'=>'Betrieb B','status'=>'active','license_status'=>'active']);
foreach(['FAHRER','EINWEISER','DISPONENT','EDITOR','ADMIN'] as $role){$u=$users->create($a['id'],['login'=>strtolower($role),'display_name'=>$role,'password'=>${phpString(password)}]);$roles->assignRole($a['id'],$u['id'],$role);}
$users->create($a['id'],['login'=>'keine','display_name'=>'Keine Rolle','password'=>${phpString(password)}]);
$users->create($b['id'],['login'=>'fremd','display_name'=>'Fremder Mandant','password'=>${phpString(password)}]);
echo json_encode(['a'=>$a,'b'=>$b]);`;
  const seeded = spawnSync(php, ['-r', seed], { cwd: projectRoot, env: environment(), encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  ({ a: companyA, b: companyB } = JSON.parse(seeded.stdout));

  server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', webroot], {
    cwd: webroot, env: environment(), stdio: 'ignore', windowsHide: true
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const ready = await fetch(origin + '/api/auth/runtime.php');
      if (ready.status === 200) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  for (const role of ['FAHRER', 'EINWEISER', 'DISPONENT', 'EDITOR', 'ADMIN', 'KEINE']) {
    sessions[role] = await login(role);
  }
});

after(() => {
  if (server) server.kill();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('alle geforderten APIs besitzen eine explizite Capability-Zuordnung', () => {
  for (const apiCase of apiCases) {
    const source = fs.readFileSync(path.join(projectRoot, 'api', apiCase.file), 'utf8');
    assert.ok(source.includes(apiCase.capability), `${apiCase.name}: ${apiCase.capability}`);
  }
});

for (const apiCase of apiCases) {
  test(`${apiCase.name}: 401/403, Capability, CSRF und Legacy-Token`, async () => {
    const mutation = apiCase.mutation ?? (apiCase.method !== 'GET');
    const unauthenticated = await request(apiCase);
    assert.equal(unauthenticated.response.status, 401, unauthenticated.text);

    const denied = await request(apiCase, {
      cookie: sessions.KEINE.cookie,
      csrf: sessions.KEINE.csrf,
      origin: mutation
    });
    assert.equal(denied.response.status, 403, denied.text);

    if (mutation) {
      const wrongCsrf = await request(apiCase, {
        cookie: sessions[apiCase.role].cookie,
        csrf: 'falsch',
        origin: true
      });
      assert.equal(wrongCsrf.response.status, 403, wrongCsrf.text);
    }

    const allowed = await request(apiCase, {
      cookie: sessions[apiCase.role].cookie,
      csrf: mutation ? sessions[apiCase.role].csrf : '',
      origin: mutation
    });
    assert.notEqual(allowed.response.status, 401, allowed.text);
    assert.notEqual(allowed.response.status, 403, allowed.text);
    assert.equal(allowed.response.headers.get('x-lehrfahrer-auth-mode'), 'session');

    const legacy = await request(apiCase, { legacy: true });
    assert.notEqual(legacy.response.status, 401, legacy.text);
    assert.notEqual(legacy.response.status, 403, legacy.text);
    assert.equal(legacy.response.headers.get('x-lehrfahrer-auth-mode'), 'legacy-token');
  });
}

test('Rollenmatrix enthält die erwarteten positiven und negativen Rechte', () => {
  assert.ok(sessions.FAHRER.capabilities.includes('routes.read'));
  assert.ok(!sessions.FAHRER.capabilities.includes('drivers.manage'));
  assert.ok(sessions.EINWEISER.capabilities.includes('trainings.manage'));
  assert.ok(!sessions.EINWEISER.capabilities.includes('routes.write'));
  assert.ok(sessions.DISPONENT.capabilities.includes('drivers.manage'));
  assert.ok(!sessions.DISPONENT.capabilities.includes('routes.delete'));
  assert.ok(sessions.EDITOR.capabilities.includes('routes.write'));
  assert.ok(sessions.EDITOR.capabilities.includes('routes.delete'));
  assert.ok(!sessions.EDITOR.capabilities.includes('users.manage'));
  assert.equal(sessions.ADMIN.capabilities.length, 24);
});

test('company_id aus einem Request überschreibt den Session-Mandanten nicht', async () => {
  const apiCase = { method: 'GET', path: `/api/list_lines.php?company_id=${encodeURIComponent(companyB.id)}` };
  const result = await request(apiCase, { cookie: sessions.FAHRER.cookie });
  assert.notEqual(result.response.status, 401, result.text);
  assert.notEqual(result.response.status, 403, result.text);
  assert.equal(companyA.slug, 'betrieb-a');
});

test('GET und HEAD können keinen Mutationsendpunkt auslösen', async () => {
  for (const endpoint of ['/api/save_line.php', '/api/delete_line.php', '/api/create_city.php']) {
    const response = await fetch(origin + endpoint, {
      method: 'HEAD', headers: { Cookie: sessions.ADMIN.cookie }
    });
    assert.equal(response.status, 405, endpoint);
  }
});

test('deaktivierte Benutzer, abgelaufene und manipulierte Sessions erhalten an Fach-APIs 401', async () => {
  const fresh = await login('FAHRER');
  const token = fresh.cookie.split('=', 2)[1];
  const tokenHash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  mutateDatabase(`UPDATE sessions SET idle_expires_at='2000-01-01T00:00:00Z' WHERE session_token_hash='${tokenHash}'`);
  assert.equal((await request(apiCases[0], { cookie: fresh.cookie })).response.status, 401);

  const manipulated = await request(apiCases[0], {
    cookie: '__Host-lehrfahrer_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  });
  assert.equal(manipulated.response.status, 401);

  const active = await login('FAHRER');
  mutateDatabase(`UPDATE users SET active=0 WHERE company_id='${companyA.id}' AND login_normalized='fahrer'`);
  assert.equal((await request(apiCases[0], { cookie: active.cookie })).response.status, 401);
  mutateDatabase(`UPDATE users SET active=1 WHERE company_id='${companyA.id}' AND login_normalized='fahrer'`);
});

test('Sessionmutation mit fremder Origin wird trotz richtigem CSRF abgelehnt', async () => {
  const apiCase = apiCases.find(item => item.name === 'drivers mutate');
  const headers = {
    Cookie: sessions.DISPONENT.cookie,
    Origin: 'https://fremd.example',
    'X-CSRF-Token': sessions.DISPONENT.csrf,
    'Content-Type': 'application/json'
  };
  const response = await fetch(origin + apiCase.path, {
    method: 'POST', headers, body: JSON.stringify({})
  });
  assert.equal(response.status, 403);
});

test('GET-/POST-apiToken-Fallback wird nicht auf neu geschützte Lese-APIs ausgeweitet', async () => {
  const newRead = await fetch(`${origin}/api/list_lines.php?apiToken=${encodeURIComponent(legacyToken)}`);
  assert.equal(newRead.status, 401);

  const existingProtectedRead = await fetch(`${origin}/api/drivers.php?apiToken=${encodeURIComponent(legacyToken)}`);
  assert.notEqual(existingProtectedRead.status, 401);
  assert.notEqual(existingProtectedRead.status, 403);
  assert.equal(existingProtectedRead.headers.get('x-lehrfahrer-auth-mode'), 'legacy-token');
});
