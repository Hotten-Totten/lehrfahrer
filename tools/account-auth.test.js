const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-account-auth-'));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture(action, setup = '') {
  const folder = path.join(sandbox, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(folder)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${quote(path.join(folder, 'webroot'))};
require ${quote(path.join(root, 'api', '_account_auth.php'))};
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
foreach ([$userA,$userB] as $user) {
  $record = $users->findAuthenticationRecordByLogin($user['company_id'],$user['login_normalized']);
  $accountId = lehrfahrer_control_id('acc'); $membershipId = lehrfahrer_control_id('mem');
  $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')->execute([$accountId,$record['login_normalized'],$record['display_name'],$record['password_hash'],gmdate('c'),gmdate('c')]);
  $pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,\'active\',?,?,?)')->execute([$membershipId,$accountId,$record['company_id'],$record['id'],gmdate('c'),gmdate('c')]);
  $roleId = $pdo->query('SELECT role_id FROM user_roles WHERE user_id=' . $pdo->quote($record['id']))->fetchColumn();
  $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$roleId]);
  if ($record['login_normalized']==='alpha') { $accountA=$accountId; $membershipA=$membershipId; }
  else { $accountB=$accountId; $membershipB=$membershipId; }
}
${setup}
${action}
`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /test-password-12345|\$2y\$|password_hash|session_token_hash|csrf_token_hash/);
  return JSON.parse(result.stdout);
}

test('globaler Accountlogin aktiviert genau eine Membership mit getrennten Capabilities', () => {
  const data = fixture(String.raw`
$login = lehrfahrer_account_login($pdo,' ALPHA ','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $login['token'];
$session = lehrfahrer_account_current_session($pdo, false);
$public = lehrfahrer_account_public_session($pdo,$session);
$stored = $pdo->query('SELECT * FROM account_sessions')->fetch(PDO::FETCH_ASSOC);
$cookieOptions = lehrfahrer_auth_cookie_options($login['absoluteExpiresAt']);
echo json_encode(['context'=>$public['context'],'member'=>$public['membershipId']===$membershipA,
  'tenantRead'=>in_array('routes.read',$public['tenantCapabilities'],true),
  'platform'=>$public['platformCapabilities'],'oldCookie'=>isset($_COOKIE[LEHRFAHRER_SESSION_COOKIE]),
  'tokenHashed'=>$stored['session_token_hash']===lehrfahrer_auth_token_hash($login['token']) && $stored['session_token_hash']!==$login['token'],
  'csrfHashed'=>$stored['csrf_token_hash']===lehrfahrer_auth_token_hash($login['csrf']),
  'cookieSecure'=>$cookieOptions['secure'] && $cookieOptions['httponly']
    && $cookieOptions['samesite']==='Strict' && $cookieOptions['path']==='/',
  'idle'=>(strtotime($stored['idle_expires_at'])-strtotime($stored['created_at'])),
  'absolute'=>(strtotime($stored['absolute_expires_at'])-strtotime($stored['created_at']))], JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { context: 'TENANT', member: true, tenantRead: true, platform: [],
    oldCookie: false, tokenHashed: true, csrfHashed: true, cookieSecure: true,
    idle: 1800, absolute: 43200 });
});

test('falsches Passwort, unbekannter, inaktiver, gesperrter und wechselpflichtiger Account scheitern', () => {
  const data = fixture(String.raw`
$wrong=lehrfahrer_account_login($pdo,'alpha','wrong')===null;
$unknown=lehrfahrer_account_login($pdo,'unknown','test-password-12345')===null;
$pdo->prepare('UPDATE accounts SET active=0 WHERE id=?')->execute([$accountA]);
$inactive=lehrfahrer_account_login($pdo,'alpha','test-password-12345')===null;
$pdo->prepare('UPDATE accounts SET active=1, blocked_until=? WHERE id=?')->execute([gmdate('c',time()+3600),$accountA]);
$blocked=lehrfahrer_account_login($pdo,'alpha','test-password-12345')===null;
$pdo->prepare('UPDATE accounts SET blocked_until=NULL,must_change_password=1 WHERE id=?')->execute([$accountA]);
$mustChange=lehrfahrer_account_login($pdo,'alpha','test-password-12345')===null;
echo json_encode(compact('wrong','unknown','inactive','blocked','mustChange'), JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { wrong: true, unknown: true, inactive: true, blocked: true, mustChange: true });
});

test('keine zulässige Membership erzeugt keinen Mandantenkontext', () => {
  const data = fixture(String.raw`
$pdo->prepare("UPDATE account_memberships SET status='inactive' WHERE id=?")->execute([$membershipA]);
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$public=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode(['context'=>$public['context'],'members'=>$public['memberships'],
  'tenant'=>$public['tenantCapabilities']], JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { context: 'NO_MEMBERSHIP', members: [], tenant: [] });
});

test('mehrere Memberships bleiben pending; Auswahl rotiert Token und CSRF', () => {
  const data = fixture(String.raw`
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$pending=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
$foreign=lehrfahrer_account_rotate_to_membership($pdo,$membershipB,$login['csrf']);
$badCsrf=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,'wrong');
$selected=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$login['csrf']);
$old=$pdo->prepare('SELECT revoked_at FROM account_sessions WHERE session_token_hash=?');
$old->execute([lehrfahrer_auth_token_hash($login['token'])]);
$revoked=$old->fetchColumn()!==null;
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$selected['token'];
$active=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode(['pending'=>$pending['context'],'count'=>count($pending['memberships']),
  'pendingTenant'=>$pending['tenantCapabilities'],'foreign'=>$foreign===null,'csrf'=>$badCsrf===null,
  'rotated'=>$selected['token']!==$login['token'] && $selected['csrf']!==$login['csrf'],
  'revoked'=>$revoked,'active'=>$active['context'],'member'=>$active['membershipId']===$membershipA], JSON_THROW_ON_ERROR);`, String.raw`
$membershipExtra=lehrfahrer_control_id('mem');
$pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,\'active\',?,?)')->execute([$membershipExtra,$accountA,$companyB['id'],gmdate('c'),gmdate('c')]);`);
  assert.deepEqual(data, { pending: 'SELECTION_PENDING', count: 2, pendingTenant: [], foreign: true,
    csrf: true, rotated: true, revoked: true, active: 'TENANT', member: true });
});

test('inaktive Gesellschaft scheidet aus; Plattformrechte bleiben von Mandantenrechten getrennt', () => {
  const data = fixture(String.raw`
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$public=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode(['context'=>$public['context'],'tenant'=>$public['tenantCapabilities'],
  'platformCount'=>count($public['platformCapabilities']),
  'platformTenantLeak'=>array_intersect($public['platformCapabilities'],$public['tenantCapabilities'])!==[]], JSON_THROW_ON_ERROR);`, String.raw`
$pdo->prepare("UPDATE companies SET status='inactive' WHERE id=?")->execute([$companyA['id']]);
$pdo->prepare('INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,?,?)')->execute([$accountA,'COSYSOP',gmdate('c')]);`);
  assert.deepEqual(data, { context: 'PLATFORM', tenant: [], platformCount: 7, platformTenantLeak: false });
});

test('neuer Login widerruft vorhandene Account-Session, alte Auth bleibt unberührt', () => {
  const data = fixture(String.raw`
$first=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$first['token'];
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]='legacy-cookie-preserved';
$second=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$query=$pdo->prepare('SELECT revoked_at FROM account_sessions WHERE session_token_hash=?');
$query->execute([lehrfahrer_auth_token_hash($first['token'])]);
echo json_encode(['rotated'=>$first['token']!==$second['token'],
  'oldRevoked'=>$query->fetchColumn()!==null,
  'legacyCookie'=>$_COOKIE[LEHRFAHRER_SESSION_COOKIE]], JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { rotated: true, oldRevoked: true, legacyCookie: 'legacy-cookie-preserved' });
});

test('Idle-, Absolut- und Widerrufsgrenze sperren Account-Sessions', () => {
  const data = fixture(String.raw`
$first=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$first['token'];
$pdo->prepare('UPDATE account_sessions SET idle_expires_at=? WHERE session_token_hash=?')->execute([gmdate('c',time()-1),lehrfahrer_auth_token_hash($first['token'])]);
$idle=lehrfahrer_account_current_session($pdo,false)===null;
$second=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$second['token'];
$pdo->prepare('UPDATE account_sessions SET absolute_expires_at=? WHERE session_token_hash=?')->execute([gmdate('c',time()-1),lehrfahrer_auth_token_hash($second['token'])]);
$absolute=lehrfahrer_account_current_session($pdo,false)===null;
$third=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$third['token'];
$pdo->prepare('UPDATE account_sessions SET revoked_at=? WHERE session_token_hash=?')->execute([gmdate('c'),lehrfahrer_auth_token_hash($third['token'])]);
$revoked=lehrfahrer_account_current_session($pdo,false)===null;
echo json_encode(compact('idle','absolute','revoked'), JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { idle: true, absolute: true, revoked: true });
});
