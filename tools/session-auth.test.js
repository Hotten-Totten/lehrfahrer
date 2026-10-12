const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-session-'));
const privateRoot = path.join(sandbox, 'dev-private');
let phpServer;
let php;
let origin;
let companyA;
let companyB;
let activeUser;
let inactiveUser;
let unprivilegedUser;

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

function phpEnvironment(root = privateRoot, environment = 'dev') {
  return {
    ...process.env,
    LEHRFAHRER_PRIVATE_DATA_DIR: root,
    LEHRFAHRER_DB_DRIVER: 'sqlite',
    LEHRFAHRER_ENV: environment,
    LEHRFAHRER_PUBLIC_ORIGIN: origin || 'http://127.0.0.1',
    LEHRFAHRER_BUILD_COMMIT: 'phase2-test-commit',
    LEHRFAHRER_BUILD_ID: 'phase2-test-build',
    LEHRFAHRER_DEPLOYED_AT: '2026-10-09T10:00:00Z'
  };
}

function runPhp(code, { root = privateRoot, environment = 'dev', extraEnv = {} } = {}) {
  return spawnSync(php, ['-r', code], {
    cwd: projectRoot,
    env: { ...phpEnvironment(root, environment), ...extraEnv },
    encoding: 'utf8'
  });
}

function mutateDatabase(sql) {
  const code = `require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};`
    + `$pdo=lehrfahrer_control_database();$pdo->exec(${phpString(sql)});`;
  const result = runPhp(code);
  assert.equal(result.status, 0, result.stderr);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function request(endpoint, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.origin !== false && options.method && options.method !== 'GET') headers.Origin = origin;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    redirect: 'manual'
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}

function sessionCookie(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return { setCookie, cookie: setCookie.split(';', 1)[0] };
}

async function login(overrides = {}, cookie = '') {
  return request('/api/auth/login.php', {
    method: 'POST',
    cookie,
    json: {
      company: 'betrieb-a',
      login: 'admin',
      password: 'Richtiges-Testpasswort-2!',
      deviceLabel: 'Phase-2-Test',
      ...overrides
    }
  });
}

before(async () => {
  php = findPhp();
  if (!php) throw new Error('PHP ist für den Session-Test erforderlich.');
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;

  const seedCode = `
require ${phpString(path.join(projectRoot, 'api', '_control_repositories.php'))};
$pdo=lehrfahrer_control_database();
$companies=new LehrfahrerCompanyRepository($pdo);
$users=new LehrfahrerUserRepository($pdo);
$roles=new LehrfahrerRoleRepository($pdo);
$companyA=$companies->create(['slug'=>'betrieb-a','name'=>'Betrieb A','status'=>'active','license_status'=>'active']);
$companyB=$companies->create(['slug'=>'betrieb-b','name'=>'Betrieb B','status'=>'active','license_status'=>'active']);
$active=$users->create($companyA['id'],['login'=>'admin','display_name'=>'Admin A','password'=>'Richtiges-Testpasswort-2!']);
$inactive=$users->create($companyA['id'],['login'=>'inaktiv','display_name'=>'Inaktiv','password'=>'Richtiges-Testpasswort-2!','active'=>false]);
$unprivileged=$users->create($companyA['id'],['login'=>'ohne-rolle','display_name'=>'Ohne Rolle','password'=>'Richtiges-Testpasswort-2!']);
$other=$users->create($companyB['id'],['login'=>'admin','display_name'=>'Admin B','password'=>'Anderes-Testpasswort-2!']);
$roles->assignRole($companyA['id'],$active['id'],'ADMIN');
$roles->assignRole($companyB['id'],$other['id'],'FAHRER');
echo json_encode(['companyA'=>$companyA,'companyB'=>$companyB,'active'=>$active,'inactive'=>$inactive,'unprivileged'=>$unprivileged]);`;
  const seeded = runPhp(seedCode);
  assert.equal(seeded.status, 0, seeded.stderr);
  ({ companyA, companyB, active: activeUser, inactive: inactiveUser, unprivileged: unprivilegedUser } = JSON.parse(seeded.stdout));

  phpServer = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', projectRoot], {
    cwd: projectRoot,
    env: phpEnvironment(),
    stdio: 'ignore',
    windowsHide: true
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const ready = await request('/api/auth/runtime.php');
      if (ready.response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('PHP-Testserver konnte nicht gestartet werden.');
});

after(() => {
  if (phpServer) phpServer.kill();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('A/E: korrekter Login setzt ausschließlich den gehärteten Host-Cookie', async () => {
  const result = await login();
  assert.equal(result.response.status, 200, result.text);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.company.id, companyA.id);
  assert.equal(result.body.user.id, activeUser.id);
  assert.ok(result.body.csrfToken);
  const { setCookie } = sessionCookie(result.response);
  assert.match(setCookie, /^__Host-lehrfahrer_session=/);
  assert.match(setCookie, /; path=\//i);
  assert.match(setCookie, /; secure/i);
  assert.match(setCookie, /; httponly/i);
  assert.match(setCookie, /; samesite=Strict/i);
  assert.doesNotMatch(setCookie, /; domain=/i);
});

test('B/C/D: falsche Zugangsdaten und inaktiver Benutzer werden neutral abgelehnt', async () => {
  const attempts = [
    await login({ password: 'falsch' }),
    await login({ company: 'unbekannt' }),
    await login({ login: 'inaktiv' })
  ];
  for (const result of attempts) {
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'Anmeldung nicht möglich.');
  }
});

test('Login akzeptiert keine schreibende Anfrage ohne konfigurierte Same-Origin-Herkunft', async () => {
  const result = await request('/api/auth/login.php', {
    method: 'POST',
    origin: false,
    json: { company: 'betrieb-a', login: 'admin', password: 'Richtiges-Testpasswort-2!' }
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'Anfrage wurde abgelehnt.');
});

test('F/G: me liefert nur die serverseitig gebundene Session und verlangt einen Cookie', async () => {
  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  const valid = await request('/api/auth/me.php', { cookie });
  assert.equal(valid.response.status, 200, valid.text);
  assert.equal(valid.body.company.id, companyA.id);
  assert.deepEqual(valid.body.user.roles, ['ADMIN']);
  assert.equal(Object.hasOwn(valid.body.user, 'password_hash'), false);
  const missing = await request('/api/auth/me.php');
  assert.equal(missing.response.status, 401);
});

test('Root-Einstieg liefert den Editor nur mit gültiger Session und routes.read aus', async () => {
  const anonymous = await request('/index.php');
  assert.equal(anonymous.response.status, 302);
  assert.equal(anonymous.response.headers.get('location'), 'login.html');
  assert.doesNotMatch(anonymous.text, /Linien-Editor/);

  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  const editor = await request('/index.php', { cookie });
  assert.equal(editor.response.status, 200, editor.text);
  assert.match(editor.response.headers.get('content-type') || '', /^text\/html/);
  assert.match(editor.text, /<title>Linien-Editor<\/title>/);

  const withoutRole = await login({ login: unprivilegedUser.login_normalized });
  const denied = await request('/index.php', { cookie: sessionCookie(withoutRole.response).cookie });
  assert.equal(denied.response.status, 403);
  assert.doesNotMatch(denied.text, /Linien-Editor/);
});

test('H/CSRF: Logout verlangt Origin und CSRF und widerruft die Session', async () => {
  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  const rejected = await request('/api/auth/logout.php', { method: 'POST', cookie });
  assert.equal(rejected.response.status, 403);
  const loggedOut = await request('/api/auth/logout.php', {
    method: 'POST', cookie, headers: { 'X-CSRF-Token': loggedIn.body.csrfToken }
  });
  assert.equal(loggedOut.response.status, 200, loggedOut.text);
  assert.equal((await request('/api/auth/me.php', { cookie })).response.status, 401);
});

test('I: abgelaufene Session wird abgelehnt', async () => {
  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  const token = cookie.split('=', 2)[1];
  const hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  mutateDatabase(`UPDATE sessions SET idle_expires_at='2000-01-01T00:00:00Z' WHERE session_token_hash='${hash}'`);
  assert.equal((await request('/api/auth/me.php', { cookie })).response.status, 401);
});

test('J: manipuliertes Sessioncookie wird abgelehnt', async () => {
  const result = await request('/api/auth/me.php', {
    cookie: '__Host-lehrfahrer_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  });
  assert.equal(result.response.status, 401);
});

test('K/L: Request-IDs können Gesellschaft und Benutzer der Session nicht überschreiben', async () => {
  const loggedIn = await login({ company_id: companyB.id, user_id: inactiveUser.id });
  const { cookie } = sessionCookie(loggedIn.response);
  const me = await request(`/api/auth/me.php?company_id=${encodeURIComponent(companyB.id)}&user_id=${encodeURIComponent(inactiveUser.id)}`, { cookie });
  assert.equal(me.response.status, 200, me.text);
  assert.equal(me.body.company.id, companyA.id);
  assert.equal(me.body.user.id, activeUser.id);
});

test('M: mehrere parallele Sessions lesen unabhängig denselben Mandantenkontext', async () => {
  const [first, second] = await Promise.all([login({ deviceLabel: 'A' }), login({ deviceLabel: 'B' })]);
  const [firstMe, secondMe] = await Promise.all([
    request('/api/auth/me.php', { cookie: sessionCookie(first.response).cookie }),
    request('/api/auth/me.php', { cookie: sessionCookie(second.response).cookie })
  ]);
  assert.equal(firstMe.response.status, 200);
  assert.equal(secondMe.response.status, 200);
  assert.equal(firstMe.body.company.id, companyA.id);
  assert.equal(secondMe.body.company.id, companyA.id);
});

test('Sessionrotation widerruft beim Login den mitgesendeten alten Cookie', async () => {
  const first = await login();
  const firstCookie = sessionCookie(first.response).cookie;
  const second = await login({}, firstCookie);
  const secondCookie = sessionCookie(second.response).cookie;
  assert.notEqual(firstCookie, secondCookie);
  assert.equal((await request('/api/auth/me.php', { cookie: firstCookie })).response.status, 401);
  assert.equal((await request('/api/auth/me.php', { cookie: secondCookie })).response.status, 200);
});

test('Deaktivierung eines Benutzers macht bestehende Sessions sofort ungültig', async () => {
  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  mutateDatabase(`UPDATE users SET active=0 WHERE id='${activeUser.id}' AND company_id='${companyA.id}'`);
  assert.equal((await request('/api/auth/me.php', { cookie })).response.status, 401);
  mutateDatabase(`UPDATE users SET active=1 WHERE id='${activeUser.id}' AND company_id='${companyA.id}'`);
});

test('Aktivität verlängert den Idle-Ablauf gedrosselt, aber nie über die absolute Laufzeit', async () => {
  const loggedIn = await login();
  const { cookie } = sessionCookie(loggedIn.response);
  const token = cookie.split('=', 2)[1];
  const hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  const oldActivity = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const absolute = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  mutateDatabase(`UPDATE sessions SET last_activity_at='${oldActivity}', idle_expires_at='${absolute}', absolute_expires_at='${absolute}' WHERE session_token_hash='${hash}'`);
  const me = await request('/api/auth/me.php', { cookie });
  assert.equal(me.response.status, 200, me.text);
  assert.equal(me.body.session.idleExpiresAt, absolute);
  assert.ok(Date.parse(me.body.session.lastActivityAt) > Date.parse(oldActivity));
});

test('N: Runtime-Info ist serverseitig und SQLite bleibt auf DEV begrenzt', async () => {
  const runtime = await request('/api/auth/runtime.php');
  assert.equal(runtime.response.status, 200, runtime.text);
  assert.equal(runtime.body.runtime.environment, 'dev');
  assert.equal(runtime.body.runtime.environmentLabel, 'DEV');
  assert.equal(runtime.body.runtime.commit, 'phase2-test-commit');
  assert.equal(runtime.body.runtime.buildId, 'phase2-test-build');
  assert.equal(runtime.body.runtime.databaseSchemaVersion, 4);

  const openCode = `require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};lehrfahrer_control_database();`;
  const crossEnvironment = runPhp(openCode, { environment: 'staging' });
  assert.notEqual(crossEnvironment.status, 0);
  assert.match(crossEnvironment.stderr, /SQLite ist ausschliesslich als explizites DEV\/Test-Backend erlaubt/);
  const stagingRoot = path.join(sandbox, 'staging-private');
  const isolated = runPhp(openCode, { root: stagingRoot, environment: 'staging' });
  assert.notEqual(isolated.status, 0);
  assert.match(isolated.stderr, /SQLite ist ausschliesslich als explizites DEV\/Test-Backend erlaubt/);
  assert.equal(fs.existsSync(path.join(stagingRoot, 'control', 'lehrfahrer.sqlite')), false);
  const invalid = runPhp(openCode, { root: path.join(sandbox, 'invalid-private'), environment: 'preview' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /LEHRFAHRER_ENV ist ungültig/);
});

test('O: bestehende API-Token-Authentifizierung bleibt funktional und unverändert', () => {
  const authPath = path.join(projectRoot, 'api', '_auth.php');
  const diff = spawnSync('git', ['diff', '--', authPath], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout, '');
  const code = `putenv('LEHRFAHRER_API_TOKEN=phase2-token');$_SERVER['REMOTE_ADDR']='203.0.113.1';$_SERVER['SERVER_ADDR']='203.0.113.2';$_SERVER['HTTP_HOST']='example.invalid';$_SERVER['SERVER_NAME']='example.invalid';$_SERVER['HTTP_X_API_TOKEN']='phase2-token';require ${phpString(authPath)};lehrfahrer_require_write_auth();echo 'OK';`;
  const result = runPhp(code);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK');
});

test('Bootstrap legt einmalig einen ADMIN an und verlangt das Passwort aus der Umgebung', () => {
  const bootstrapRoot = path.join(sandbox, 'bootstrap-private');
  const args = [path.join(projectRoot, 'tools', 'bootstrap-admin.php'),
    '--company-slug=bootstrap', '--company-name=Bootstrap Betrieb', '--login=erster-admin',
    '--display-name=Erster Admin'];
  const env = {
    ...phpEnvironment(bootstrapRoot),
    LEHRFAHRER_BOOTSTRAP_PASSWORD: 'Bootstrap-Testpasswort-2!'
  };
  const first = spawnSync(php, args, { cwd: projectRoot, env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const second = spawnSync(php, args, { cwd: projectRoot, env, encoding: 'utf8' });
  assert.equal(second.status, 3);
  assert.match(second.stderr, /bereits abgeschlossen/);

  const inspectCode = `require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};$pdo=lehrfahrer_control_database();echo json_encode(['admins'=>(int)$pdo->query("SELECT COUNT(*) FROM users JOIN user_roles ON user_roles.user_id=users.id JOIN roles ON roles.id=user_roles.role_id WHERE roles.code='ADMIN'")->fetchColumn(),'marker'=>$pdo->query("SELECT value FROM control_metadata WHERE key='bootstrap_admin_completed'")->fetchColumn()]);`;
  const inspected = runPhp(inspectCode, { root: bootstrapRoot });
  assert.equal(inspected.status, 0, inspected.stderr);
  const result = JSON.parse(inspected.stdout);
  assert.equal(result.admins, 1);
  assert.ok(result.marker);
});

test('Minimale Login-UI enthält neutrale Eingaben und speichert CSRF nicht persistent', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'login.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'js', 'login.js'), 'utf8');
  assert.match(html, /id="company"/);
  assert.match(html, /id="login"/);
  assert.match(html, /id="password"/);
  assert.match(html, /id="environment"/);
  assert.match(script, /Anmeldung nicht möglich\./);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/i);
  assert.match(script, /let csrfToken = ''/);
  assert.match(script, /api\/auth\/me\.php/);
  assert.match(script, /window\.location\.replace\('\.\/'\)/);
});

test('Apache-Root und direkter Legacy-Einstieg verwenden den serverseitigen Session-Gate', () => {
  const apache = fs.readFileSync(path.join(projectRoot, '.htaccess'), 'utf8');
  const gate = fs.readFileSync(path.join(projectRoot, 'index.php'), 'utf8');
  assert.match(apache, /^DirectoryIndex index\.php$/m);
  assert.match(apache, /RewriteRule \^index\\\.html\$ index\.php \[L,NC\]/);
  assert.match(gate, /lehrfahrer_auth_current_session/);
  assert.match(gate, /userCapabilities/);
  assert.match(gate, /routes\.read/);
  assert.match(gate, /Location: login\.html/);
});
