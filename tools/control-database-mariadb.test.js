const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

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
if (!php) throw new Error('PHP ist fuer den MariaDB-Control-Datenbank-Test erforderlich.');

const mariaConfiguration = {
  dsn: process.env.LEHRFAHRER_MARIADB_TEST_DSN || '',
  user: process.env.LEHRFAHRER_MARIADB_TEST_USER || '',
  password: process.env.LEHRFAHRER_MARIADB_TEST_PASSWORD || ''
};
const configured = Object.values(mariaConfiguration).every(Boolean);
const mariaTest = configured ? test : test.skip;

let fixture = null;
let mariaEnvironment = null;
if (configured) {
  const fixtureCode = `
require ${phpString(path.join(projectRoot, 'api', '_session_auth.php'))};

$pdo = lehrfahrer_control_database();
lehrfahrer_control_migrate($pdo);
lehrfahrer_control_migrate($pdo);
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo);
$roles = new LehrfahrerRoleRepository($pdo);
$suffix = strtolower(bin2hex(random_bytes(6)));

$company = $companies->create([
    'slug' => 'maria-' . $suffix,
    'name' => 'MariaDB Integration',
    'status' => 'active',
    'license_status' => 'active',
]);
$user = $users->create($company['id'], [
    'login' => 'Admin.' . $suffix,
    'display_name' => 'MariaDB Admin',
    'password' => 'MariaDB-Testpasswort-2!',
]);
$roles->assignRole($company['id'], $user['id'], 'ADMIN');
$authRecord = $users->findAuthenticationRecordByLogin($company['id'], 'admin.' . $suffix);

$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'Lehrfahrer-MariaDB-Test';
$createdSession = lehrfahrer_auth_create_session($pdo, $user, $company, 'Integrationstest');
$secondSession = lehrfahrer_auth_create_session($pdo, $user, $company, 'Paralleltest');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE] = $createdSession['sessionToken'];
$currentSession = lehrfahrer_auth_current_session($pdo, false);
$csrfValid = is_array($currentSession)
    && hash_equals((string)$currentSession['csrf_token_hash'], lehrfahrer_auth_token_hash($createdSession['csrfToken']));
$publicSession = lehrfahrer_auth_public_session($currentSession, $pdo);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE] = $secondSession['sessionToken'];
$parallelSession = lehrfahrer_auth_current_session($pdo, false);
lehrfahrer_auth_revoke_session_by_token($pdo, $createdSession['sessionToken']);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE] = $createdSession['sessionToken'];
$revokedSession = lehrfahrer_auth_current_session($pdo, false);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE] = $secondSession['sessionToken'];
$survivingParallelSession = lehrfahrer_auth_current_session($pdo, false);
lehrfahrer_auth_revoke_session_by_token($pdo, $secondSession['sessionToken']);

$rollbackId = lehrfahrer_control_id('cmp');
$pdo->beginTransaction();
$insertRollback = $pdo->prepare(
    'INSERT INTO companies (id, slug, name, status, license_id, license_status, created_at, updated_at)
     VALUES (:id, :slug, :name, :status, NULL, :license_status, :created_at, :updated_at)'
);
$insertRollback->execute([
    ':id' => $rollbackId,
    ':slug' => 'rollback-' . $suffix,
    ':name' => 'Rollback Test',
    ':status' => 'active',
    ':license_status' => 'active',
    ':created_at' => gmdate('c'),
    ':updated_at' => gmdate('c'),
]);
$pdo->rollBack();
$rollbackPersisted = $companies->findById($rollbackId) !== null;

$foreignKeyRejected = false;
try {
    $invalidRole = $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)');
    $invalidRole->execute([':user_id' => 'missing-user', ':role_id' => 'role_admin']);
} catch (PDOException $error) {
    $foreignKeyRejected = $error->getCode() === '23000';
}

$configuration = lehrfahrer_control_mysql_configuration();
$pdo2 = new PDO(
    $configuration['dsn'],
    $configuration['user'],
    $configuration['password'],
    $configuration['options']
);
$connectionOne = (int)$pdo->query('SELECT CONNECTION_ID()')->fetchColumn();
$connectionTwo = (int)$pdo2->query('SELECT CONNECTION_ID()')->fetchColumn();
$environmentMismatchRejected = false;
try {
    lehrfahrer_control_bind_environment($pdo2, 'staging');
} catch (RuntimeException $error) {
    $environmentMismatchRejected = str_contains($error->getMessage(), 'anderen Umgebung');
}
$lockName = 'lehrfahrer_test_' . $suffix;
$lockOne = $pdo->prepare('SELECT GET_LOCK(:lock_name, 0)');
$lockOne->execute([':lock_name' => $lockName]);
$lockTwo = $pdo2->prepare('SELECT GET_LOCK(:lock_name, 0)');
$lockTwo->execute([':lock_name' => $lockName]);
$lockResults = [(int)$lockOne->fetchColumn(), (int)$lockTwo->fetchColumn()];
$release = $pdo->prepare('SELECT RELEASE_LOCK(:lock_name)');
$release->execute([':lock_name' => $lockName]);

$tables = $pdo->query(
    "SELECT table_name, engine, table_collation
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
     ORDER BY table_name"
)->fetchAll();

echo json_encode([
    'info' => lehrfahrer_control_database_info($pdo),
    'migrationCount' => (int)$pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn(),
    'tables' => $tables,
    'companySlug' => $company['slug'],
    'loginFound' => is_array($authRecord),
    'passwordValid' => is_array($authRecord)
        && lehrfahrer_password_verify('MariaDB-Testpasswort-2!', (string)$authRecord['password_hash']),
    'adminCapabilities' => $roles->userCapabilities($company['id'], $user['id']),
    'sessionFound' => is_array($currentSession),
    'csrfValid' => $csrfValid,
    'publicRoles' => $publicSession['user']['roles'] ?? [],
    'revokedSessionIsNull' => $revokedSession === null,
    'parallelSessionsIndependent' => is_array($parallelSession) && is_array($survivingParallelSession),
    'rollbackPersisted' => $rollbackPersisted,
    'foreignKeyRejected' => $foreignKeyRejected,
    'connectionIdsDiffer' => $connectionOne !== $connectionTwo,
    'environmentMismatchRejected' => $environmentMismatchRejected,
    'lockResults' => $lockResults,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;

  mariaEnvironment = {
    ...process.env,
    LEHRFAHRER_DB_DRIVER: 'mysql',
    LEHRFAHRER_DB_DSN: mariaConfiguration.dsn,
    LEHRFAHRER_DB_USER: mariaConfiguration.user,
    LEHRFAHRER_DB_PASSWORD: mariaConfiguration.password,
    LEHRFAHRER_ENV: 'dev'
  };
  const fixtureRun = spawnSync(php, ['-r', fixtureCode], {
    cwd: projectRoot,
    env: mariaEnvironment,
    encoding: 'utf8'
  });
  assert.equal(fixtureRun.status, 0, fixtureRun.stderr);
  fixture = JSON.parse(fixtureRun.stdout);
}

mariaTest('MariaDB-Schema ist idempotent, vollstaendig und InnoDB/utf8mb4', () => {
  assert.equal(fixture.info.driver, 'mysql');
  assert.match(fixture.info.serverVersion, /MariaDB/i);
  assert.equal(fixture.migrationCount, 3);
  const requiredTables = [
    'capabilities', 'companies', 'control_metadata', 'role_capabilities', 'roles',
    'schema_migrations', 'sessions', 'user_roles', 'users'
  ];
  assert.deepEqual(fixture.tables.map(table => table.table_name).sort(), requiredTables.sort());
  for (const table of fixture.tables) {
    assert.equal(table.engine, 'InnoDB', table.table_name);
    assert.match(table.table_collation, /^utf8mb4_/i, table.table_name);
  }
});

mariaTest('MariaDB-Repositories erhalten Gesellschaften, Benutzer, Rollen und Capabilities', () => {
  assert.match(fixture.companySlug, /^maria-/);
  assert.equal(fixture.loginFound, true);
  assert.equal(fixture.passwordValid, true);
  assert.ok(fixture.adminCapabilities.includes('users.manage'));
  assert.ok(fixture.adminCapabilities.includes('routes.write'));
});

mariaTest('MariaDB traegt Login-Session, CSRF und Logout korrekt', () => {
  assert.equal(fixture.sessionFound, true);
  assert.equal(fixture.csrfValid, true);
  assert.deepEqual(fixture.publicRoles, ['ADMIN']);
  assert.equal(fixture.revokedSessionIsNull, true);
  assert.equal(fixture.parallelSessionsIndependent, true);
});

mariaTest('MariaDB erzwingt Transaktions-Rollback und Foreign Keys', () => {
  assert.equal(fixture.rollbackPersisted, false);
  assert.equal(fixture.foreignKeyRejected, true);
});

mariaTest('MariaDB erlaubt parallele Verbindungen und serialisierbare Named Locks', () => {
  assert.equal(fixture.connectionIdsDiffer, true);
  assert.equal(fixture.environmentMismatchRejected, true);
  assert.deepEqual(fixture.lockResults, [1, 0]);
});

mariaTest('Parallele MariaDB-Migrationsaufrufe werden sicher abgeschlossen', async () => {
  const migrationCode = `
    require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};
    lehrfahrer_control_database();
    echo 'OK';
  `;
  const runMigration = () => new Promise((resolve, reject) => {
    const child = spawn(php, ['-r', migrationCode], {
      cwd: projectRoot,
      env: mariaEnvironment,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([runMigration(), runMigration()]);
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'OK');
  }
});
