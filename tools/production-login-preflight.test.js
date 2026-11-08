const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:/xampp/php/php.exe'].filter(Boolean)
  .find(binary => spawnSync(binary, ['-v']).status === 0);
assert.ok(php, 'PHP required');
const q = value => JSON.stringify(value.replaceAll('\\', '/'));
function fixture(extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-production-readonly-'));
  const result = spawnSync(php, ['-r', `
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${q(dir)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${q(path.join(dir, 'web'))};
require ${q(path.join(root, 'tools/production-login-preflight.php'))};
$pdo = lehrfahrer_control_database();
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo); $roles = new LehrfahrerRoleRepository($pdo);
for ($i=0; $i<4; $i++) {
 $c=$companies->create(['slug'=>'private-company-'.$i,'name'=>'Private Name','status'=>'active','license_status'=>'active']);
 $u=$users->create($c['id'],['login'=>'private-user-'.$i,'display_name'=>'Private Person','password'=>'secret-password-12345']);
 $roles->assignRole($c['id'],$u['id'],'FAHRER');
}
$pdo->exec("UPDATE control_metadata SET value='production' WHERE key='environment'");
$pdo->exec("INSERT OR REPLACE INTO control_metadata (key,value,updated_at) VALUES ('auth_mode','PARALLEL','2026-11-08'),('auth_cutover_lock','OPEN','2026-11-08')");
${extra}
$db=lehrfahrer_control_database_path(); $before=hash_file('sha256',$db);
$reader=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$report=lehrfahrer_production_login_preflight($reader);
$blocked=false; try {$reader->exec("UPDATE control_metadata SET value='changed'");} catch(Throwable $e) {$blocked=true;}
echo json_encode(['report'=>$report,'unchanged'=>$before===hash_file('sha256',$db),'writeBlocked'=>$blocked],JSON_THROW_ON_ERROR);
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-user|Private Person|private-company|secret-password|subjects|\$2y\$|password_hash/);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.unchanged, true); assert.equal(payload.writeBlocked, true);
  assert.equal(payload.report.releaseReady, false);
  return payload.report;
}
test('production inventory accepts arbitrary counts without claiming release readiness', () => {
  const report = fixture();
  assert.equal(report.inventoryStatus, 'PASS'); assert.equal(report.counts.legacyUsers, 4);
  assert.ok(report.pendingChecks.includes('ORIGIN_AND_MFA_SETUP'));
});
test('wrong database environment is rejected before scanning identities', () => {
  const report = fixture("$pdo->exec(\"UPDATE control_metadata SET value='staging' WHERE key='environment'\");");
  assert.equal(report.findings[0].code, 'DATABASE_ENVIRONMENT_MISMATCH'); assert.equal(report.counts, undefined);
});
test('cutover or existing account mode is not mistaken for initial migration state', () => {
  const report = fixture("$pdo->exec(\"UPDATE control_metadata SET value='ACCOUNT_PRIMARY' WHERE key='auth_mode'\");");
  assert.equal(report.findings[0].code, 'AUTH_STATE_NOT_INITIAL_PARALLEL_OPEN');
});
test('duplicate normalized logins block migration without exposing identities', () => {
  const report = fixture("$users->create($c['id'],['login'=>'private-user-0','display_name'=>'Private Person','password'=>'secret-password-12345']);");
  assert.equal(report.inventoryStatus, 'BLOCKIERT');
  assert.ok(report.findings.some(f => f.code === 'GLOBAL_LOGIN_COLLISION_EXACT'));
});
test('unknown schema yields a closed aggregate report', () => {
  const report = fixture('$pdo->exec("DELETE FROM schema_migrations");');
  assert.equal(report.inventoryStatus, 'BLOCKIERT');
  assert.ok(report.findings.some(f => f.code === 'UNEXPECTED_SCHEMA_VERSION'));
});
test('partially populated account tables block initial migration', () => {
  const report = fixture(`$pdo->exec("INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES ('partial','private-user-partial','Private Person','not-a-password',1,0,'now','now')");`);
  assert.equal(report.inventoryStatus, 'BLOCKIERT');
  assert.equal(report.newTables.accounts, 1);
  assert.ok(report.findings.some(f => f.code === 'TARGET_TABLE_NOT_EMPTY'));
});
test('CLI refuses accidental execution without explicit read-only context', () => {
  const result = spawnSync(php, [path.join(root, 'tools/production-login-preflight.php')], {
    encoding: 'utf8', env: { ...process.env, LEHRFAHRER_PRODUCTION_PREFLIGHT: '' }
  });
  assert.equal(result.status, 2); assert.equal(result.stdout, '');
  assert.match(result.stderr, /^PRODUCTION_PREFLIGHT_CONTEXT_REJECTED\s*$/);
});
