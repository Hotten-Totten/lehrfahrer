const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-account-preflight-'));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;
function fixture(extra = '') {
  const folder = path.join(sandbox, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(folder)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${quote(path.join(folder, 'webroot'))};
require ${quote(path.join(root, 'tools', 'control-account-preflight.php'))};
$pdo = lehrfahrer_control_database();
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo);
$roles = new LehrfahrerRoleRepository($pdo);
$companyA = $companies->create(['slug'=>'phase-a','name'=>'A','status'=>'active','license_status'=>'active']);
$userA = $users->create($companyA['id'],['login'=>'alpha','display_name'=>'A','password'=>'test-password-12345']);
$roles->assignRole($companyA['id'],$userA['id'],'FAHRER');
${extra}
$databasePath = lehrfahrer_control_database_path();
$before = hash_file('sha256', $databasePath);
$reader = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$report = lehrfahrer_control_account_preflight($reader);
$writeBlocked = false;
try { $reader->exec("INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES ('forbidden','forbidden','X','hash',1,0,'now','now')"); }
catch (PDOException $error) { $writeBlocked = true; }
unset($reader);
$after = hash_file('sha256', $databasePath);
echo json_encode(['report'=>$report,'unchanged'=>$before===$after,'writeBlocked'=>$writeBlocked], JSON_THROW_ON_ERROR);
`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /test-password-12345|\$2y\$|\$argon2|token_hash|password_hash|session_token_hash/);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.unchanged, true);
  assert.equal(payload.writeBlocked, true);
  return payload.report;
}
const finding = (report, code) => report.findings.some(item => item.code === code);

test('konfliktfreier Bestand ergibt exakte 1:1-Zielmengen ohne Schreibzugriff', () => {
  const report = fixture();
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.counts, {
    legacyUsers: 1, plannedAccounts: 1, plannedMemberships: 1,
    plannedMembershipRoles: 1, plannedPlatformAssignments: 0,
    plannedSysopAssignments: 0, plannedAccountSessions: 0
  });
  assert.equal(report.password.present, 1);
  assert.equal(report.cutoverSessions, 'REVOKE_AND_REAUTHENTICATE');
});

test('gleicher Login in zwei Gesellschaften blockiert globale Übernahme ohne Verschmelzung', () => {
  const report = fixture(String.raw`
$companyB = $companies->create(['slug'=>'phase-b','name'=>'B','status'=>'active','license_status'=>'active']);
$users->create($companyB['id'],['login'=>'alpha','display_name'=>'B','password'=>'test-password-12345']);`);
  assert.equal(report.status, 'BLOCKIERT');
  assert.equal(report.counts.plannedAccounts, 2);
  assert.equal(report.loginConflicts, 1);
  assert.ok(finding(report, 'GLOBAL_LOGIN_COLLISION_EXACT'));
});

test('abweichende Großschreibung und Rand-Leerzeichen werden normalisiert erkannt', () => {
  const report = fixture(String.raw`
$companyB = $companies->create(['slug'=>'phase-b','name'=>'B','status'=>'active','license_status'=>'active']);
$userB = $users->create($companyB['id'],['login'=>'beta','display_name'=>'B','password'=>'test-password-12345']);
$pdo->prepare('UPDATE users SET login_normalized=? WHERE id=?')->execute(['  ALPHA  ',$userB['id']]);`);
  assert.ok(finding(report, 'GLOBAL_LOGIN_COLLISION_NORMALIZED'));
  assert.ok(finding(report, 'LOGIN_NOT_CANONICAL'));
});

test('ungültige Gesellschaft und verwaiste Rollenzuordnung blockieren', () => {
  const report = fixture(String.raw`
$pdo->exec('PRAGMA foreign_keys=OFF');
$pdo->prepare('UPDATE users SET company_id=? WHERE id=?')->execute(['cmp_missing',$userA['id']]);
$pdo->prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)')->execute(['usr_missing','role_missing']);`);
  assert.ok(finding(report, 'USER_COMPANY_MISSING'));
  assert.ok(finding(report, 'USER_ROLE_USER_MISSING'));
  assert.ok(finding(report, 'USER_ROLE_ROLE_MISSING'));
});

test('fehlende Rolle bei vorhandenem Benutzer wird gesondert gemeldet', () => {
  const report = fixture(String.raw`
$pdo->exec('PRAGMA foreign_keys=OFF');
$pdo->prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)')->execute([$userA['id'],'role_missing']);`);
  assert.ok(finding(report, 'USER_ROLE_ROLE_MISSING'));
  assert.equal(report.roles.orphanRole, 1);
});

test('offene Aktivierung ist Warnung und wird für Neuausstellung gezählt', () => {
  const report = fixture(String.raw`
$pdo->prepare('INSERT INTO user_activation_tokens (id,user_id,company_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')->execute(['tok_1',$userA['id'],$companyA['id'],str_repeat('a',64),gmdate('c'),gmdate('c',time()+86400)]);`);
  assert.equal(report.status, 'PASS');
  assert.equal(report.activation.open, 1);
  assert.equal(report.activation.reissueAtCutover, 1);
});

test('verwaiste Aktivierung blockiert ohne Tokenwerte auszugeben', () => {
  const report = fixture(String.raw`
$pdo->exec('PRAGMA foreign_keys=OFF');
$pdo->prepare('INSERT INTO user_activation_tokens (id,user_id,company_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')->execute(['tok_1','usr_missing',$companyA['id'],str_repeat('b',64),gmdate('c'),gmdate('c',time()+86400)]);`);
  assert.ok(finding(report, 'ACTIVATION_TARGET_INVALID'));
});

test('verwaiste Session blockiert; Session-IDs und Token bleiben verborgen', () => {
  const report = fixture(String.raw`
$pdo->exec('PRAGMA foreign_keys=OFF');
$pdo->prepare('INSERT INTO sessions (id,session_token_hash,user_id,company_id,csrf_token_hash,environment,created_at,last_activity_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,?,\'dev\',?,?,?,?)')->execute(['sess_secret',str_repeat('d',64),'usr_missing',$companyA['id'],str_repeat('e',64),gmdate('c'),gmdate('c'),gmdate('c',time()+60),gmdate('c',time()+3600)]);`);
  assert.ok(finding(report, 'SESSION_TARGET_INVALID'));
  assert.equal(report.sessions.orphan, 1);
  assert.doesNotMatch(JSON.stringify(report), /sess_secret/);
});

test('unerwartete Zieltabellendaten stoppen die weitere Bestandsprüfung', () => {
  const report = fixture(String.raw`
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')->execute(['acc_test','account','A','hash',gmdate('c'),gmdate('c')]);`);
  assert.equal(report.scanned, false);
  assert.ok(finding(report, 'TARGET_TABLE_NOT_EMPTY'));
  assert.equal(report.counts, undefined);
});

test('CLI verweigert Production-Kontext vor jedem Datenbankzugriff', () => {
  const result = spawnSync(php, [path.join(root, 'tools', 'control-account-preflight.php')], {
    encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'production', LEHRFAHRER_DB_DRIVER: 'mysql',
      LEHRFAHRER_DB_DSN: '', LEHRFAHRER_DB_HOST: '', LEHRFAHRER_DB_NAME: '' }
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ausschließlich für die Staging-MariaDB/);
  assert.equal(result.stdout, '');
});
