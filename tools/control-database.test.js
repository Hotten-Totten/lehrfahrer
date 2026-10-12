const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-control-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
fs.mkdirSync(webroot, { recursive: true });

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

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

const php = findPhp();
if (!php) throw new Error('PHP ist für den Control-Datenbank-Test erforderlich.');

const fixtureCode = `
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${phpString(privateRoot)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite');
putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${phpString(webroot)};
require ${phpString(path.join(projectRoot, 'api', '_control_repositories.php'))};

$pdo = lehrfahrer_control_database();
lehrfahrer_control_migrate($pdo);
lehrfahrer_control_migrate($pdo);
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo);
$roles = new LehrfahrerRoleRepository($pdo);

$companyA = $companies->create([
    'slug' => 'betrieb-a',
    'name' => 'Betrieb A',
    'status' => 'active',
    'license_id' => 'license-a',
    'license_status' => 'active',
]);
$companyB = $companies->create([
    'slug' => 'betrieb-b',
    'name' => 'Betrieb B',
    'status' => 'active',
    'license_id' => 'license-b',
    'license_status' => 'active',
]);
$userA = $users->create($companyA['id'], [
    'login' => 'Gleicher.Login',
    'display_name' => 'Benutzer A',
    'email' => 'a@example.invalid',
    'password' => 'Phase-1-Testpasswort-A',
]);
$duplicateRejected = false;
try {
    $users->create($companyA['id'], [
        'login' => 'gleicher.login',
        'display_name' => 'Dublette',
        'password' => 'Phase-1-Dublette',
    ]);
} catch (Throwable $error) {
    $duplicateRejected = true;
}
$userB = $users->create($companyB['id'], [
    'login' => 'gleicher.login',
    'display_name' => 'Benutzer B',
    'password' => 'Phase-1-Testpasswort-B',
    'must_change_password' => true,
]);
$roles->assignRole($companyA['id'], $userA['id'], 'EDITOR');
$roles->assignRole($companyB['id'], $userB['id'], 'FAHRER');

$crossTenantRoleRejected = false;
try {
    $roles->assignRole($companyA['id'], $userB['id'], 'ADMIN');
} catch (Throwable $error) {
    $crossTenantRoleRejected = true;
}

$hashStatement = $pdo->prepare('SELECT password_hash FROM users WHERE company_id = :company_id AND id = :user_id');
$hashStatement->execute([':company_id' => $companyA['id'], ':user_id' => $userA['id']]);
$passwordHash = (string)$hashStatement->fetchColumn();
$roleCapabilities = [];
foreach (array_keys(lehrfahrer_control_role_definitions()) as $roleCode) {
    $roleCapabilities[$roleCode] = $roles->roleCapabilities($roleCode);
}

echo json_encode([
    'databasePath' => lehrfahrer_control_database_path(),
    'migrationCount' => (int)$pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn(),
    'tableNames' => $pdo->query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN),
    'companyA' => $companies->findById($companyA['id']),
    'companyB' => $companies->findBySlug('betrieb-b'),
    'duplicateRejected' => $duplicateRejected,
    'sameLoginAcrossCompanies' => $userA['login_normalized'] === $userB['login_normalized'],
    'companyAUsers' => count($users->listForCompany($companyA['id'])),
    'companyBUsers' => count($users->listForCompany($companyB['id'])),
    'passwordHash' => $passwordHash,
    'passwordCorrect' => lehrfahrer_password_verify('Phase-1-Testpasswort-A', $passwordHash),
    'passwordWrong' => lehrfahrer_password_verify('falsch', $passwordHash),
    'passwordAlgorithm' => password_get_info($passwordHash)['algoName'] ?? '',
    'capabilityCount' => (int)$pdo->query('SELECT COUNT(*) FROM capabilities')->fetchColumn(),
    'roleCount' => (int)$pdo->query('SELECT COUNT(*) FROM roles')->fetchColumn(),
    'roleCapabilities' => $roleCapabilities,
    'crossTenantRead' => $users->findById($companyA['id'], $userB['id']),
    'crossTenantRoleRejected' => $crossTenantRoleRejected,
    'userACapabilities' => $roles->userCapabilities($companyA['id'], $userA['id']),
    'sqlite' => lehrfahrer_control_database_info($pdo),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;

const fixtureRun = spawnSync(php, ['-r', fixtureCode], { encoding: 'utf8' });
assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
const fixture = JSON.parse(fixtureRun.stdout);

test('Control-Datenbank liegt außerhalb des DocumentRoot', () => {
  const databasePath = path.resolve(fixture.databasePath);
  const relativeToWebroot = path.relative(path.resolve(webroot), databasePath);
  assert.ok(relativeToWebroot.startsWith('..') || path.isAbsolute(relativeToWebroot));
  assert.equal(databasePath, path.join(privateRoot, 'control', 'lehrfahrer.sqlite'));
  assert.ok(fs.existsSync(databasePath));
});

test('Schema-Migration ist wiederholt idempotent', () => {
  assert.equal(fixture.migrationCount, 4);
  for (const table of [
    'schema_migrations', 'companies', 'users', 'roles', 'capabilities',
    'role_capabilities', 'user_roles', 'control_metadata', 'sessions',
    'user_activation_tokens'
  ]) {
    assert.ok(fixture.tableNames.includes(table), table);
  }
  for (const deferredTable of ['company_write_locks', 'password_resets', 'audit_events']) {
    assert.ok(!fixture.tableNames.includes(deferredTable), deferredTable);
  }
});

test('Gesellschaften können angelegt und eindeutig gelesen werden', () => {
  assert.equal(fixture.companyA.slug, 'betrieb-a');
  assert.equal(fixture.companyA.name, 'Betrieb A');
  assert.equal(fixture.companyB.slug, 'betrieb-b');
});

test('Login ist innerhalb einer Gesellschaft eindeutig und gesellschaftsübergreifend zulässig', () => {
  assert.equal(fixture.duplicateRejected, true);
  assert.equal(fixture.sameLoginAcrossCompanies, true);
  assert.equal(fixture.companyAUsers, 1);
  assert.equal(fixture.companyBUsers, 1);
});

test('Passwort wird nur gehasht gespeichert und korrekt verifiziert', () => {
  assert.notEqual(fixture.passwordHash, 'Phase-1-Testpasswort-A');
  assert.match(fixture.passwordHash, /^\$/);
  assert.equal(fixture.passwordCorrect, true);
  assert.equal(fixture.passwordWrong, false);
  assert.ok(['argon2id', 'bcrypt'].includes(fixture.passwordAlgorithm), fixture.passwordAlgorithm);
});

test('Standardrollen besitzen ihre expliziten Capabilities', () => {
  const allCapabilities = [
    'app.access', 'audit.read', 'cities.manage', 'company.manage',
    'drivers.manage', 'drivers.read', 'locks.force_release',
    'operations.settings.read', 'operations.settings.write',
    'packages.create', 'packages.download', 'packages.manage', 'packages.read',
    'roles.manage', 'routes.delete', 'routes.import', 'routes.maintain',
    'routes.read', 'routes.write', 'stops.catalog.write', 'stops.fetch',
    'trainings.manage', 'trainings.read', 'users.manage'
  ];
  assert.equal(fixture.roleCount, 5);
  assert.equal(fixture.capabilityCount, 24);
  assert.deepEqual(fixture.roleCapabilities.FAHRER, [
    'app.access', 'routes.read'
  ]);
  assert.deepEqual(fixture.roleCapabilities.EINWEISER, [
    'app.access', 'drivers.read', 'packages.create', 'packages.download',
    'packages.read', 'routes.read', 'trainings.manage',
    'trainings.read'
  ]);
  assert.deepEqual(fixture.roleCapabilities.DISPONENT, [
    'app.access', 'drivers.manage', 'drivers.read', 'operations.settings.read',
    'operations.settings.write', 'packages.create', 'packages.download',
    'packages.manage', 'packages.read', 'routes.read', 'trainings.manage',
    'trainings.read'
  ]);
  assert.deepEqual(fixture.roleCapabilities.EDITOR, [
    'app.access', 'cities.manage', 'routes.delete', 'routes.import',
    'routes.maintain', 'routes.read', 'routes.write',
    'stops.catalog.write', 'stops.fetch'
  ]);
  assert.deepEqual(fixture.roleCapabilities.ADMIN, allCapabilities);
});

test('Repository verhindert Cross-Tenant-Lesen und Rollenzuweisung', () => {
  assert.equal(fixture.crossTenantRead, null);
  assert.equal(fixture.crossTenantRoleRejected, true);
  assert.ok(fixture.userACapabilities.includes('routes.write'));
});

test('SQLite aktiviert Foreign Keys und busy_timeout ohne WAL zu erzwingen', () => {
  assert.equal(fixture.sqlite.foreignKeys, true);
  assert.equal(fixture.sqlite.busyTimeoutMs, 5000);
  assert.ok(['delete', 'truncate', 'persist', 'memory', 'wal', 'off'].includes(fixture.sqlite.journalMode));
});

test('SQLite wird außerhalb der expliziten DEV-Umgebung hart abgewiesen', () => {
  const result = spawnSync(php, ['-r', `
    putenv('LEHRFAHRER_DB_DRIVER=sqlite');
    putenv('LEHRFAHRER_ENV=production');
    require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};
    lehrfahrer_control_database();
  `], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SQLite ist ausschliesslich als explizites DEV\/Test-Backend erlaubt/);
});

test('Fehlende MariaDB-Konfiguration fällt ohne SQLite-Fallback hart aus', () => {
  const environment = {
    ...process.env,
    LEHRFAHRER_DB_DRIVER: 'mysql',
    LEHRFAHRER_DB_DSN: '',
    LEHRFAHRER_DB_HOST: '',
    LEHRFAHRER_DB_NAME: '',
    LEHRFAHRER_DB_USER: '',
    LEHRFAHRER_DB_PASSWORD: '',
    LEHRFAHRER_ENV: 'production'
  };
  const result = spawnSync(php, ['-r', `
    require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};
    lehrfahrer_control_database();
  `], { env: environment, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MariaDB-Konfiguration fehlt/);
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
}

test('Control-Datenbank ist über den Webroot nicht per HTTP erreichbar', async () => {
  const port = await availablePort();
  const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', webroot], {
    stdio: 'ignore',
    windowsHide: true
  });
  try {
    let status = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        status = await requestStatus(`http://127.0.0.1:${port}/lehrfahrer-private/control/lehrfahrer.sqlite`);
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.equal(status, 404);
  } finally {
    server.kill();
  }
});
