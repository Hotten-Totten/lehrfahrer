const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-sysop-bootstrap-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const q = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture(mutation = '', action = '') {
  const folder = path.join(temp, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${q(folder)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT']=${q(path.join(folder, 'webroot'))};
require ${q(path.join(root, 'tools/control-account-cutover-preflight.php'))};
require_once ${q(path.join(root, 'api/_account_auth.php'))};
$pdo=lehrfahrer_control_database();
$companies=new LehrfahrerCompanyRepository($pdo);
$users=new LehrfahrerUserRepository($pdo);
$roles=new LehrfahrerRoleRepository($pdo);
foreach (['first-admin','cottbus-admin'] as $i=>$login) {
  $company=$companies->create(['slug'=>$i===0?'first':'cottbusverkehr','name'=>$login,
    'status'=>'active','license_status'=>'active']);
  $user=$users->create($company['id'],['login'=>$login,'display_name'=>$login,'password'=>'test-password-12345']);
  $roles->assignRole($company['id'],$user['id'],'ADMIN');
  $legacy=$users->findAuthenticationRecordByLogin($company['id'],$login);
  $account=lehrfahrer_control_id('acc'); $membership=lehrfahrer_control_id('mem');
  $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
    VALUES (?,?,?,?,1,0,?,?)')->execute([$account,$login,$login,$legacy['password_hash'],gmdate('c'),gmdate('c')]);
  $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at)
    VALUES (?,?,?,'active',?,?,?)")->execute([$membership,$account,$company['id'],$user['id'],gmdate('c'),gmdate('c')]);
  $role=$pdo->query('SELECT role_id FROM user_roles WHERE user_id='.$pdo->quote($user['id']))->fetchColumn();
  $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membership,$role]);
  $pdo->beginTransaction(); lehrfahrer_control_allocate_user_number($pdo,$account); $pdo->commit();
  if ($i===0) $other=$account;
  else { $target=$account; $targetMembership=$membership; $cottbus=$company; }
}
$smoke=lehrfahrer_control_id('acc'); $smokeMembership=lehrfahrer_control_id('mem');
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
  VALUES (?,?,?,?,1,0,?,?)')->execute([$smoke,'staging-driver-smoke','Smoke',password_hash('smoke-test-password',PASSWORD_DEFAULT),gmdate('c'),gmdate('c')]);
$pdo->beginTransaction(); lehrfahrer_control_allocate_user_number($pdo,$smoke); $pdo->commit();
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at)
  VALUES (?,?,?,'active',NULL,?,?)")->execute([$smokeMembership,$smoke,$cottbus['id'],gmdate('c'),gmdate('c')]);
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$smokeMembership,'role_fahrer']);
$pdo->prepare('UPDATE control_metadata SET value=? WHERE "key"=?')->execute(['staging','environment']);
$pdo->prepare('INSERT INTO control_metadata ("key",value,updated_at) VALUES (?,?,?)')
  ->execute(['auth_mode','ACCOUNT_PRIMARY',gmdate('c')]);
$targetSession=lehrfahrer_account_create_session($pdo,$target,'TENANT',$targetMembership);
$otherSession=lehrfahrer_account_create_session($pdo,$other,'TENANT',
  (string)$pdo->query('SELECT id FROM account_memberships WHERE account_id='.$pdo->quote($other))->fetchColumn());
$pdo->exec("UPDATE account_sessions SET environment='staging'");
${mutation}
${action}
`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const snapshot = String.raw`
$tables=['accounts','account_memberships','membership_roles','account_user_numbers',
  'account_user_number_allocator','sysop_assignment','account_platform_roles','account_sessions'];
$before=[]; foreach ($tables as $table) $before[$table]=$pdo->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);`;

test('einmaliger Bootstrap ist atomar, widerruft nur Ziel-Sessions und bewahrt Mandantenrollen', () => {
  const data = fixture('', String.raw`
$pre=lehrfahrer_sysop_bootstrap_preflight($pdo);
$result=lehrfahrer_sysop_bootstrap_apply($pdo);
$post=lehrfahrer_sysop_bootstrap_postcheck($pdo,$target);
putenv('LEHRFAHRER_CUTOVER_PREFLIGHT_EXPECT_MODE=ACCOUNT_PRIMARY');
$cutover=lehrfahrer_account_cutover_preflight($pdo);
$numbers=$pdo->query('SELECT user_number,issued_to_account_id,current_account_id FROM account_user_numbers ORDER BY user_number')->fetchAll(PDO::FETCH_ASSOC);
$sessions=$pdo->query('SELECT account_id,revoked_at FROM account_sessions')->fetchAll(PDO::FETCH_ASSOC);
$tenant=lehrfahrer_account_tenant_capabilities($pdo,$target,$targetMembership);
$foreign=lehrfahrer_account_tenant_capabilities($pdo,$target,$smokeMembership);
$second=false; try { lehrfahrer_sysop_bootstrap_apply($pdo); } catch (RuntimeException $e) { $second=true; }
$reuse=false; try { $pdo->prepare('UPDATE account_user_numbers SET current_account_id=? WHERE user_number=102')->execute([$smoke]); }
  catch (PDOException $e) { $reuse=true; }
$fresh=lehrfahrer_account_login($pdo,'cottbus-admin','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$fresh['token'];
$public=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode(['pre'=>$pre['oldNumber'],'number'=>$post['userNumber'],'retired'=>$post['retiredNumber'],
  'capabilities'=>count($post['platformCapabilities']),'cutover'=>$cutover['status'],
  'cutoverCodes'=>array_column($cutover['findings'],'code'),
  'numbers'=>array_map(static fn($r)=>[(int)$r['user_number'],$r['current_account_id']],$numbers),
  'target'=>$target,'smoke'=>$smoke,'other'=>$other,
  'sessions'=>$sessions,'tenantAdmin'=>in_array('users.manage',$tenant,true),
  'foreign'=>$foreign,'second'=>$second,'reuse'=>$reuse,
  'freshNumber'=>$public['userNumber'],'freshPlatform'=>$public['platformRoles'],
  'freshTenant'=>$public['companyId']??null],JSON_THROW_ON_ERROR);`);
  assert.equal(data.pre, 102);
  assert.equal(data.number, 1);
  assert.equal(data.retired, 102);
  assert.equal(data.capabilities, 9);
  assert.ok(['PASS', 'WARNING'].includes(data.cutover), data.cutoverCodes.join(', '));
  assert.deepEqual(data.numbers.map(row => row[0]), [1, 101, 102, 103]);
  assert.equal(data.numbers[0][1], data.target);
  assert.equal(data.numbers[2][1], null);
  assert.equal(data.numbers[3][1], data.smoke);
  assert.ok(data.sessions.find(row => row.account_id === data.target).revoked_at);
  assert.equal(data.sessions.find(row => row.account_id === data.other).revoked_at, null);
  assert.equal(data.tenantAdmin, true);
  assert.deepEqual(data.foreign, []);
  assert.equal(data.second, true);
  assert.equal(data.reuse, true);
  assert.equal(data.freshNumber, '00001');
  assert.deepEqual(data.freshPlatform, ['SYSOP']);
  assert.ok(data.freshTenant);
});

for (const [name, mutation, expected] of [
  ['00001 belegt', "$pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at) VALUES (1,?,?,?)')->execute([$other,NULL,gmdate('c')]);", 'NUMBER_REGISTRY'],
  ['falscher Zielaccount', "$pdo->prepare('UPDATE accounts SET login_normalized=? WHERE id=?')->execute(['other',$target]);", 'TARGET_ACCOUNT'],
  ['Zielaccount ohne 00102', "$pdo->prepare('UPDATE account_user_numbers SET current_account_id=NULL WHERE user_number=102')->execute();", 'NUMBER_REGISTRY'],
  ['inkonsistente Registry', "$pdo->prepare('UPDATE account_user_number_allocator SET next_number=105')->execute();", 'NUMBER_ALLOCATOR'],
  ['fehlende Membership', "$pdo->prepare('UPDATE account_memberships SET status=? WHERE id=?')->execute(['inactive',$targetMembership]);", 'TARGET_MEMBERSHIP'],
  ['fehlende ADMIN-Rolle', "$pdo->prepare('DELETE FROM membership_roles WHERE membership_id=?')->execute([$targetMembership]);", 'TARGET_TENANT_ROLE'],
  ['zweiter SysOp', "$pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')->execute([$other,gmdate('c')]);", 'SYSOP_ALREADY_ASSIGNED'],
  ['widersprechende Plattformrolle', "$pdo->prepare(\"INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,'COSYSOP',?)\")->execute([$other,gmdate('c')]);", 'PLATFORM_ROLE_ALREADY_ASSIGNED'],
]) {
  test(name + ' wird ohne Teilmutation abgelehnt', () => {
    const data = fixture(mutation, snapshot + String.raw`
$code=null; try { lehrfahrer_sysop_bootstrap_apply($pdo); } catch (Throwable $e) { $code=$e->getMessage(); }
$after=[]; foreach ($tables as $table) $after[$table]=$pdo->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);
echo json_encode(['code'=>$code,'unchanged'=>$before===$after],JSON_THROW_ON_ERROR);`);
    assert.equal(data.code, expected);
    assert.equal(data.unchanged, true);
  });
}

test('Fehler nach Retirement von 00102 rollt die ganze Mutation zurueck', () => {
  const data = fixture(String.raw`
$pdo->exec("CREATE TRIGGER reject_sysop_number BEFORE INSERT ON account_user_numbers
  WHEN NEW.user_number = 1 BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");`,
  snapshot + String.raw`
$failed=false; try { lehrfahrer_sysop_bootstrap_apply($pdo); } catch (PDOException $e) { $failed=true; }
$after=[]; foreach ($tables as $table) $after[$table]=$pdo->query('SELECT * FROM '.$table)->fetchAll(PDO::FETCH_ASSOC);
echo json_encode(['failed'=>$failed,'unchanged'=>$before===$after],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { failed: true, unchanged: true });
});
