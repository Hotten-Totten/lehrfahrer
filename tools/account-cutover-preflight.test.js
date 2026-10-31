const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-cutover-preflight-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  command => command && spawnSync(command, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const q = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture(mutation = '') {
  const folder = path.join(temp, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_ENV=dev'); putenv('LEHRFAHRER_DB_DRIVER=sqlite');
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${q(folder)});
$_SERVER['DOCUMENT_ROOT']=${q(path.join(folder, 'webroot'))};
require ${q(path.join(root, 'tools/control-account-cutover-preflight.php'))};
if (!function_exists('lehrfahrer_control_normalize_login')) throw new RuntimeException('Preflight-Abhängigkeit fehlt.');
require ${q(path.join(root, 'api/_account_auth.php'))};
$pdo=lehrfahrer_control_database();
$companies=new LehrfahrerCompanyRepository($pdo);
$users=new LehrfahrerUserRepository($pdo);
$roles=new LehrfahrerRoleRepository($pdo);
foreach (['alpha','beta'] as $i=>$login) {
  $company=$companies->create(['slug'=>'firm-'.$login,'name'=>$login,'status'=>'active','license_status'=>'active']);
  $user=$users->create($company['id'],['login'=>$login,'display_name'=>$login,'password'=>'test-password-12345']);
  $roles->assignRole($company['id'],$user['id'],$i===0?'ADMIN':'FAHRER');
  $legacy=$users->findAuthenticationRecordByLogin($company['id'],$login);
  $account=lehrfahrer_control_id('acc'); $membership=lehrfahrer_control_id('mem');
  $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
    VALUES (?,?,?,?,1,0,?,?)')->execute([$account,$login,$login,$legacy['password_hash'],gmdate('c'),gmdate('c')]);
  $pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at)
    VALUES (?,?,?,\'active\',?,?,?)')->execute([$membership,$account,$company['id'],$user['id'],gmdate('c'),gmdate('c')]);
  $role=$pdo->query('SELECT role_id FROM user_roles WHERE user_id='.$pdo->quote($user['id']))->fetchColumn();
  $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membership,$role]);
  $pdo->beginTransaction(); lehrfahrer_control_allocate_user_number($pdo,$account); $pdo->commit();
  if ($i===0) { $accountA=$account; $membershipA=$membership; $userA=$legacy; $companyA=$company; }
  else { $accountB=$account; $membershipB=$membership; $userB=$legacy; $companyB=$company; }
}
${mutation}
$before=[];
foreach (['users','accounts','account_memberships','membership_roles','account_user_numbers','sessions','account_sessions','control_metadata'] as $table)
  $before[$table]=$pdo->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);
$result=lehrfahrer_account_cutover_preflight($pdo);
$after=[];
foreach (array_keys($before) as $table) $after[$table]=$pdo->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);
echo json_encode(['status'=>$result['status'],'codes'=>array_column($result['findings'],'code'),
  'counts'=>$result['counts'],'next'=>$result['nextUserNumber'],'sessions'=>$result['sessions'],
  'unchanged'=>$before===$after,'duplicateRejected'=>$duplicateRejected ?? null],JSON_THROW_ON_ERROR);`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('migrierter Parallelbestand besteht lesenden Cutover-Preflight', () => {
  const result = fixture();
  assert.equal(result.status, 'PASS');
  assert.equal(result.unchanged, true);
  assert.equal(result.next, 103);
  assert.equal(result.counts.users, 2);
  assert.equal(result.counts.accounts, 2);
  assert.equal(result.counts.account_memberships, 2);
  assert.equal(result.counts.membership_roles, 2);
});

const smokeAccount = String.raw`
$cottbus=$companies->create(['slug'=>'cottbusverkehr','name'=>'Cottbusverkehr','status'=>'active','license_status'=>'active']);
$smoke=lehrfahrer_control_id('acc'); $smokeMembership=lehrfahrer_control_id('mem');
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
 VALUES (?,?,?,?,1,0,?,?)')->execute([$smoke,'staging-driver-smoke','Staging Driver Smoke',password_hash('test-secret-not-for-staging',PASSWORD_DEFAULT),gmdate('c'),gmdate('c')]);
$pdo->beginTransaction(); lehrfahrer_control_allocate_user_number($pdo,$smoke); $pdo->commit();
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at)
 VALUES (?,?,?,'active',NULL,?,?)")->execute([$smokeMembership,$smoke,$cottbus['id'],gmdate('c'),gmdate('c')]);
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$smokeMembership,'role_fahrer']);`;

test('dedizierter Staging-Account mit nur Fahrerrolle bleibt mit Migrationsbestand konsistent', () => {
  const result = fixture(smokeAccount);
  assert.equal(result.status, 'PASS', result.codes.join(', '));
  assert.equal(result.unchanged, true);
  assert.equal(result.counts.users, 2);
  assert.equal(result.counts.accounts, 3);
  assert.equal(result.counts.account_memberships, 3);
  assert.equal(result.next, 104);
});

test('zukuenftiger Cutover blockiert ohne autorisierte freigegebene Driver-Route', () => {
  for (const mutation of ['', smokeAccount]) {
    const result = fixture(mutation + " putenv('LEHRFAHRER_CUTOVER_PREFLIGHT_REQUIRE_DRIVER_SMOKE=1');");
    assert.equal(result.status, 'BLOCKER');
    assert.ok(result.codes.includes('NO_AUTHORIZED_RELEASED_DRIVER_ROUTE'));
    assert.equal(result.unchanged, true);
  }
});

test('zukuenftiger Cutover akzeptiert nur die exakte freigegebene GTFS-savedRoute', () => {
  const result = fixture(smokeAccount + String.raw`
require_once ${q(path.join(root, 'api/_tenant_route_storage.php'))};
require_once ${q(path.join(root, 'api/_gtfs_work_inventory.php'))};
$routeId='gtfs-route-10'; $variantId='gtfs-variant-1';
$routeFile=lehrfahrer_route_file($cottbus['id'],'cottbus','Route_01','json','Linie_10','Standard',true);
file_put_contents($routeFile,json_encode(['stops'=>[],
 'routePoints'=>[['lat'=>51.7,'lon'=>14.3],['lat'=>51.71,'lon'=>14.31]],
 'meta'=>['gtfsWork'=>['routeId'=>$routeId,'variantId'=>$variantId]]],JSON_THROW_ON_ERROR));
lehrfahrer_gtfs_work_write_json(lehrfahrer_gtfs_work_inventory_path($cottbus['id']),
 ['entries'=>[['routeId'=>$routeId,'variantId'=>$variantId,'status'=>'FREIGEGEBEN',
 'savedRoute'=>'cottbus/Linie_10/Standard/Route_01.json']]]);
putenv('LEHRFAHRER_CUTOVER_PREFLIGHT_REQUIRE_DRIVER_SMOKE=1');`);
  assert.equal(result.status, 'PASS', result.codes.join(', '));
  assert.equal(result.unchanged, true);
});

test('zusaetzliche Schreibrolle beim Smoke-Account blockiert Cutover', () => {
  const result = fixture(smokeAccount + String.raw`
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$smokeMembership,'role_editor']);`);
  assert.equal(result.status, 'BLOCKER');
  assert.ok(result.codes.includes('DRIVER_SMOKE_IDENTITY'));
});

test('ACCOUNT_PRIMARY besteht nur den explizit passenden read-only Postcheck', () => {
  const setMode = "$pdo->prepare('INSERT INTO control_metadata (\"key\",value,updated_at) VALUES (?,?,?)')->execute(['auth_mode','ACCOUNT_PRIMARY',gmdate('c')]);";
  const defaultResult = fixture(setMode);
  assert.equal(defaultResult.status, 'BLOCKER');
  assert.ok(defaultResult.codes.includes('AUTH_STATE'));
  const explicitResult = fixture(setMode + " putenv('LEHRFAHRER_CUTOVER_PREFLIGHT_EXPECT_MODE=ACCOUNT_PRIMARY');");
  assert.equal(explicitResult.status, 'PASS');
  assert.equal(explicitResult.unchanged, true);
});

for (const [name, mutation, code] of [
  ['fehlender Account', "$pdo->exec('PRAGMA foreign_keys=OFF'); $pdo->exec('DELETE FROM accounts WHERE id='.$pdo->quote($accountB));", 'ACCOUNTS_COUNT'],
  ['fehlende Membership', "$pdo->exec('DELETE FROM membership_roles WHERE membership_id='.$pdo->quote($membershipB)); $pdo->exec('DELETE FROM account_memberships WHERE id='.$pdo->quote($membershipB));", 'ACCOUNT_MEMBERSHIPS_COUNT'],
  ['falsche Company', "$pdo->prepare('UPDATE account_memberships SET company_id=? WHERE id=?')->execute([$companyA['id'],$membershipB]);", 'COMPANY_OR_MEMBERSHIP_STATUS'],
  ['Rollenabweichung', "$pdo->exec('DELETE FROM membership_roles WHERE membership_id='.$pdo->quote($membershipB));", 'ROLE_MISMATCH'],
  ['Login-Kollision', "$pdo->prepare('UPDATE users SET login_normalized=? WHERE id=?')->execute(['alpha',$userB['id']]);", 'LOGIN_COLLISION'],
  ['Nummernregistry inkonsistent', "$pdo->prepare('UPDATE account_user_numbers SET current_account_id=NULL WHERE current_account_id=?')->execute([$accountB]);", 'NUMBER_REGISTRY'],
  ['unerwarteter SysOp', "$pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')->execute([$accountA,gmdate('c')]);", 'SYSOP_POSTSTATE'],
  ['unerwartete Plattformrolle', "$pdo->prepare(\"INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,'COSYSOP',?)\")->execute([$accountA,gmdate('c')]);", 'ACCOUNT_PLATFORM_ROLES_COUNT'],
  ['aktiver Cutover-Lock', "lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED');", 'AUTH_STATE'],
  ['ungültiger Account-Passworthash', "$pdo->prepare('UPDATE accounts SET password_hash=? WHERE id=?')->execute(['plain',$accountA]);", 'ACCOUNT_PASSWORD_HASH']
]) {
  test(`${name} blockiert Cutover`, () => {
    const result = fixture(mutation);
    assert.equal(result.status, 'BLOCKER');
    assert.ok(result.codes.includes(code), result.codes.join(', '));
    assert.equal(result.unchanged, true);
  });
}

test('abgelaufene Session ist Warnung und keine Mutation', () => {
  const result = fixture(String.raw`
$created=lehrfahrer_auth_create_session($pdo,$userA,$companyA);
$pdo->exec("UPDATE sessions SET idle_expires_at='2000-01-01T00:00:00Z'");`);
  assert.equal(result.status, 'WARNING');
  assert.ok(result.codes.includes('LEGACY_OLD_SESSIONS'));
  assert.equal(result.sessions.legacy.expired, 1);
  assert.equal(result.unchanged, true);
});

test('doppelte Benutzernummer wird bereits durch Registry-Constraints abgelehnt', () => {
  const result = fixture(String.raw`
$duplicateRejected=false;
try {
  $pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at)
    VALUES (101,?,?,?)')->execute([$accountB,$accountB,gmdate('c')]);
} catch (PDOException $error) { $duplicateRejected=true; }`);
  assert.equal(result.duplicateRejected, true);
  assert.equal(result.status, 'PASS');
});

test('CLI-Preflight verlangt expliziten Ausführungsmarker und staging-Kontext', () => {
  const script = path.join(root, 'tools/control-account-cutover-preflight.php');
  const environment = { ...process.env, LEHRFAHRER_ENV: 'dev',
    LEHRFAHRER_CUTOVER_PREFLIGHT_RUN: '' };
  const passive = spawnSync(php, ['-f', script], { encoding: 'utf8', env: environment });
  assert.equal(passive.status, 0);
  assert.equal(passive.stdout, '');
  const guarded = spawnSync(php, ['-f', script], { encoding: 'utf8',
    env: { ...environment, LEHRFAHRER_CUTOVER_PREFLIGHT_RUN: '1' } });
  assert.equal(guarded.status, 2);
});
