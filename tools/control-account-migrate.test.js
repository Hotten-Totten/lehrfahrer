const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-account-migrate-'));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture(extra = '', action = '') {
  const folder = path.join(sandbox, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(folder)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${quote(path.join(folder, 'webroot'))};
require ${quote(path.join(root, 'tools', 'control-account-migrate.php'))};
$pdo = lehrfahrer_control_database();
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo);
$roles = new LehrfahrerRoleRepository($pdo);
$companyA = $companies->create(['slug'=>'phase-a','name'=>'A','status'=>'active','license_status'=>'active']);
$companyB = $companies->create(['slug'=>'phase-b','name'=>'B','status'=>'active','license_status'=>'active']);
$userA = $users->create($companyA['id'],['login'=>'alpha','display_name'=>'A','password'=>'test-password-12345']);
$userB = $users->create($companyB['id'],['login'=>'beta','display_name'=>'B','password'=>'test-password-12345']);
$roles->assignRole($companyA['id'],$userA['id'],'FAHRER');
$roles->assignRole($companyB['id'],$userB['id'],'ADMIN');
${extra}
$before = [];
foreach (['users','user_roles','sessions','user_activation_tokens'] as $table) $before[$table] = $pdo->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
$error = false; $result = null;
try { ${action || '$result = lehrfahrer_control_migrate_accounts($pdo);'} }
catch (Throwable $exception) { $error = true; }
$after = [];
foreach (['users','user_roles','sessions','user_activation_tokens'] as $table) $after[$table] = $pdo->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
$counts = [];
foreach (['accounts','account_memberships','membership_roles','account_platform_roles','sysop_assignment','account_sessions','account_activation_tokens'] as $table)
  $counts[$table] = (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
echo json_encode(['error'=>$error,'result'=>$result,'counts'=>$counts,
  'oldUnchanged'=>$before===$after,'valid'=>lehrfahrer_control_validate_account_copy($pdo)['valid']], JSON_THROW_ON_ERROR);
`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /test-password-12345|\$2y\$|\$argon2|password_hash|token_hash|session_token_hash/);
  return JSON.parse(result.stdout);
}

test('1:1-Kopie mit Rollen und intern identischen Hashes, Altmodell unverändert', () => {
  const data = fixture();
  assert.equal(data.error, false);
  assert.equal(data.result.status, 'MIGRIERT');
  assert.equal(data.result.validated, true);
  assert.equal(data.valid, true);
  assert.equal(data.oldUnchanged, true);
  assert.deepEqual([data.counts.accounts, data.counts.account_memberships, data.counts.membership_roles], [2, 2, 2]);
  assert.deepEqual([data.counts.account_platform_roles, data.counts.sysop_assignment,
    data.counts.account_sessions, data.counts.account_activation_tokens], [0, 0, 0, 0]);
});

test('Fehler nach Account-Insert rollt alle neuen Tabellen zurück', () => {
  const data = fixture('', `lehrfahrer_control_migrate_accounts($pdo, function () { throw new RuntimeException('inject'); });`);
  assert.equal(data.error, true);
  assert.equal(data.oldUnchanged, true);
  assert.equal(data.counts.accounts, 0);
  assert.equal(data.counts.account_memberships, 0);
});

test('Rollenfehler rollt Accounts und Memberships zurück', () => {
  const data = fixture(`$pdo->exec("CREATE TRIGGER fail_role BEFORE INSERT ON membership_roles BEGIN SELECT RAISE(ABORT, 'inject'); END");`);
  assert.equal(data.error, true);
  assert.equal(data.counts.accounts, 0);
  assert.equal(data.counts.account_memberships, 0);
  assert.equal(data.counts.membership_roles, 0);
});

test('globale Login-Kollision blockiert vor dem ersten Insert', () => {
  const data = fixture(`$pdo->prepare('UPDATE users SET login_normalized=? WHERE id=?')->execute(['alpha',$userB['id']]);`);
  assert.equal(data.error, true);
  assert.equal(data.counts.accounts, 0);
});

test('befüllte Zieltabellen blockieren Migration', () => {
  const data = fixture(`$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')->execute(['acc_existing','existing','X','hash',gmdate('c'),gmdate('c')]);`);
  assert.equal(data.error, true);
  assert.equal(data.counts.accounts, 1);
  assert.equal(data.counts.account_memberships, 0);
});

test('offene Aktivierung blockiert die Bestandsübernahme', () => {
  const data = fixture(`$pdo->prepare('INSERT INTO user_activation_tokens (id,user_id,company_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')->execute(['tok_open',$userA['id'],$companyA['id'],str_repeat('a',64),gmdate('c'),gmdate('c',time()+86400)]);`);
  assert.equal(data.error, true);
  assert.equal(data.counts.accounts, 0);
});

test('gültige Alt-Session blockiert die Bestandsübernahme', () => {
  const data = fixture(`$pdo->prepare('INSERT INTO sessions (id,session_token_hash,user_id,company_id,csrf_token_hash,environment,created_at,last_activity_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')->execute(['sess_1',str_repeat('d',64),$userA['id'],$companyA['id'],str_repeat('e',64),'dev',gmdate('c'),gmdate('c'),gmdate('c',time()+60),gmdate('c',time()+3600)]);`);
  assert.equal(data.error, true);
  assert.equal(data.counts.accounts, 0);
});

test('zweiter Lauf erzeugt keine Dubletten', () => {
  const data = fixture('', `$result = lehrfahrer_control_migrate_accounts($pdo); lehrfahrer_control_migrate_accounts($pdo);`);
  assert.equal(data.error, true);
  assert.deepEqual([data.counts.accounts, data.counts.account_memberships, data.counts.membership_roles], [2, 2, 2]);
  assert.equal(data.valid, true);
});
