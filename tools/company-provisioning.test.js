const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandboxes = [];

after(() => {
  for (const sandbox of sandboxes) fs.rmSync(sandbox, { recursive: true, force: true });
});

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
if (!php) throw new Error('PHP ist fuer den Company-Provisioning-Test erforderlich.');

function fixtureCode() {
  return `
require ${phpString(path.join(projectRoot, 'api', '_company_provisioning.php'))};

$pdo = lehrfahrer_control_database();
$suffix = strtolower(bin2hex(random_bytes(5)));
$templateBefore = lehrfahrer_master_tenant_template();
$templateHashBefore = hash('sha256', json_encode($templateBefore));

$companyA = lehrfahrer_create_company_from_template($pdo, [
    'name' => 'Template Gesellschaft A',
    'slug' => 'template-a-' . $suffix,
    'license_status' => 'trial',
    'license_id' => 'license-a-' . $suffix,
    'admin_display_name' => 'Admin A',
    'admin_login' => 'admin-a-' . $suffix,
    'admin_email' => 'admin-a-' . $suffix . '@example.invalid',
]);

$duplicateRejected = false;
try {
    lehrfahrer_create_company_from_template($pdo, [
        'name' => 'Slug-Dublette',
        'slug' => $companyA['company']['slug'],
        'license_status' => 'active',
        'admin_display_name' => 'Dublette',
        'admin_login' => 'duplicate-' . $suffix,
    ]);
} catch (DomainException $error) {
    $duplicateRejected = true;
}

$companyB = lehrfahrer_create_company_from_template($pdo, [
    'name' => 'Template Gesellschaft B',
    'slug' => 'template-b-' . $suffix,
    'license_status' => 'active',
    'admin_display_name' => 'Admin B',
    'admin_login' => 'admin-b-' . $suffix,
]);

$countFiles = static function (string $directory): int {
    $count = 0;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($iterator as $item) if ($item->isFile()) $count++;
    return $count;
};
$areaCounts = [];
foreach ([$companyA, $companyB] as $index => $result) {
    $companyId = $result['company']['id'];
    foreach (LEHRFAHRER_TENANT_AREAS as $area) {
        $areaCounts[$index][$area] = $countFiles(lehrfahrer_tenant_area($companyId, $area));
    }
}

$configAPath = lehrfahrer_tenant_path($companyA['company']['id'], 'settings', 'company.json');
$configBPath = lehrfahrer_tenant_path($companyB['company']['id'], 'settings', 'company.json');
$configA = json_decode(file_get_contents($configAPath), true, 512, JSON_THROW_ON_ERROR);
$configB = json_decode(file_get_contents($configBPath), true, 512, JSON_THROW_ON_ERROR);

$customAPath = lehrfahrer_tenant_path(
    $companyA['company']['id'],
    'settings',
    'customer-overrides.json',
    true
);
file_put_contents($customAPath, "{}\n", LOCK_EX);
@chmod($customAPath, 0600);
$customBPath = lehrfahrer_tenant_path($companyB['company']['id'], 'settings', 'customer-overrides.json');

$activationStatement = $pdo->prepare(
    'SELECT token_hash, expires_at, used_at FROM user_activation_tokens
     WHERE company_id = :company_id AND user_id = :user_id'
);
$activationStatement->execute([
    ':company_id' => $companyA['company']['id'],
    ':user_id' => $companyA['admin']['id'],
]);
$storedActivation = $activationStatement->fetch();

$adminStatement = $pdo->prepare(
    'SELECT active, must_change_password, password_hash FROM users
     WHERE company_id = :company_id AND id = :user_id'
);
$adminStatement->execute([
    ':company_id' => $companyA['company']['id'],
    ':user_id' => $companyA['admin']['id'],
]);
$storedAdmin = $adminStatement->fetch();

$sessionStatement = $pdo->prepare('SELECT COUNT(*) FROM sessions WHERE company_id = :company_id');
$sessionStatement->execute([':company_id' => $companyA['company']['id']]);
$sessionCountA = (int)$sessionStatement->fetchColumn();
$templateHashAfter = hash('sha256', json_encode(lehrfahrer_master_tenant_template()));

echo json_encode([
    'driver' => lehrfahrer_control_driver($pdo),
    'template' => $templateBefore,
    'templateUnchanged' => hash_equals($templateHashBefore, $templateHashAfter),
    'companyA' => $companyA,
    'companyB' => $companyB,
    'duplicateRejected' => $duplicateRejected,
    'areaCounts' => $areaCounts,
    'configA' => $configA,
    'configB' => $configB,
    'rootsDiffer' => lehrfahrer_tenant_root($companyA['company']['id'])
        !== lehrfahrer_tenant_root($companyB['company']['id']),
    'customAExists' => is_file($customAPath),
    'customBExists' => is_file($customBPath),
    'roleCodes' => $pdo->query('SELECT code FROM roles ORDER BY code')->fetchAll(PDO::FETCH_COLUMN),
    'adminRoleA' => (new LehrfahrerRoleRepository($pdo))->userCapabilities(
        $companyA['company']['id'],
        $companyA['admin']['id']
    ),
    'storedActivation' => $storedActivation,
    'storedAdmin' => $storedAdmin,
    'sessionCountA' => $sessionCountA,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function runFixture(driver) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `lehrfahrer-provision-${driver}-`));
  sandboxes.push(sandbox);
  const privateRoot = path.join(sandbox, 'private');
  const webroot = path.join(sandbox, 'webroot');
  fs.mkdirSync(webroot, { recursive: true });
  const environment = {
    ...process.env,
    LEHRFAHRER_ENV: 'dev',
    LEHRFAHRER_DB_DRIVER: driver,
    LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot
  };
  if (driver === 'mysql') {
    environment.LEHRFAHRER_DB_DSN = process.env.LEHRFAHRER_MARIADB_TEST_DSN;
    environment.LEHRFAHRER_DB_USER = process.env.LEHRFAHRER_MARIADB_TEST_USER;
    environment.LEHRFAHRER_DB_PASSWORD = process.env.LEHRFAHRER_MARIADB_TEST_PASSWORD;
  }
  const result = spawnSync(php, ['-r', fixtureCode()], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const sqlite = runFixture('sqlite');
const mariaConfigured = [
  process.env.LEHRFAHRER_MARIADB_TEST_DSN,
  process.env.LEHRFAHRER_MARIADB_TEST_USER,
  process.env.LEHRFAHRER_MARIADB_TEST_PASSWORD
].every(Boolean);
const maria = mariaConfigured ? runFixture('mysql') : null;
const mariaTest = mariaConfigured ? test : test.skip;

function assertNoSecretKeys(value, location = 'template') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /password|token|secret|credential/i, `${location}.${key}`);
    assertNoSecretKeys(child, `${location}.${key}`);
  }
}

function verifyProvisioning(fixture, expectedDriver) {
  assert.equal(fixture.driver, expectedDriver);
  assert.match(fixture.companyA.company.id, /^cmp_[0-9a-f]{32}$/);
  assert.match(fixture.companyB.company.id, /^cmp_[0-9a-f]{32}$/);
  assert.notEqual(fixture.companyA.company.id, fixture.companyB.company.id);
  assert.equal(fixture.duplicateRejected, true);
  assert.equal(fixture.template.template_version, 1);
  assert.equal(fixture.templateUnchanged, true);
  assertNoSecretKeys(fixture.template);
  assert.doesNotMatch(JSON.stringify(fixture.template), /password|token|secret|credential/i);
  assert.deepEqual(Object.keys(fixture.template.roles).sort(), [
    'ADMIN', 'DISPONENT', 'EDITOR', 'EINWEISER', 'FAHRER'
  ]);
  assert.deepEqual(fixture.roleCodes, ['ADMIN', 'DISPONENT', 'EDITOR', 'EINWEISER', 'FAHRER']);

  for (const counts of fixture.areaCounts) {
    for (const [area, count] of Object.entries(counts)) {
      assert.equal(count, area === 'settings' ? 1 : 0, `${expectedDriver}:${area}`);
    }
  }
  assert.equal(fixture.sessionCountA, 0);
  assert.equal(fixture.rootsDiffer, true);
  assert.equal(fixture.customAExists, true);
  assert.equal(fixture.customBExists, false);

  assert.equal(fixture.companyA.company.template_version_created, 1);
  assert.equal(fixture.companyA.company.template_version_current, 1);
  assert.equal(fixture.configA.template.version_created, 1);
  assert.equal(fixture.configA.template.version_current, 1);
  assert.deepEqual(fixture.configA.overrides, { feature_flags: [], system_settings: [] });
  assert.equal(fixture.configA.company.company_id, fixture.companyA.company.id);
  assert.equal(fixture.configB.company.company_id, fixture.companyB.company.id);
  assert.doesNotMatch(JSON.stringify(fixture.configA), /password|token|secret|credential/i);

  assert.equal(fixture.companyA.admin.company_id, fixture.companyA.company.id);
  assert.equal(fixture.storedAdmin.active, 0);
  assert.equal(fixture.storedAdmin.must_change_password, 1);
  assert.ok(fixture.adminRoleA.includes('users.manage'));
  assert.match(fixture.companyA.activation.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(fixture.storedActivation.token_hash, fixture.companyA.activation.token);
  assert.equal(fixture.storedActivation.token_hash.length, 64);
  assert.equal(fixture.storedActivation.used_at, null);
  assert.ok(Date.parse(fixture.storedActivation.expires_at) > Date.now());
  assert.notEqual(fixture.storedAdmin.password_hash, fixture.companyA.activation.token);
}

test('DEV-Template-Provisioning erzeugt Nullbestand, Config und sicheren Erstadmin', () => {
  verifyProvisioning(sqlite, 'sqlite');
});

mariaTest('MariaDB-Template-Provisioning entspricht dem DEV-Verhalten', () => {
  verifyProvisioning(maria, 'mysql');
});
