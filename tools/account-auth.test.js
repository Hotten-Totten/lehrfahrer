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
  'accountContext'=>$public['accountId']===$accountA && $public['companyId']===$companyA['id'],
  'tenantRead'=>in_array('routes.read',$public['tenantCapabilities'],true),
  'platform'=>$public['platformCapabilities'],'oldCookie'=>isset($_COOKIE[LEHRFAHRER_SESSION_COOKIE]),
  'tokenHashed'=>$stored['session_token_hash']===lehrfahrer_auth_token_hash($login['token']) && $stored['session_token_hash']!==$login['token'],
  'csrfHashed'=>$stored['csrf_token_hash']===lehrfahrer_auth_token_hash($login['csrf']),
  'cookieSecure'=>$cookieOptions['secure'] && $cookieOptions['httponly']
    && $cookieOptions['samesite']==='Strict' && $cookieOptions['path']==='/',
  'idle'=>(strtotime($stored['idle_expires_at'])-strtotime($stored['created_at'])),
  'absolute'=>(strtotime($stored['absolute_expires_at'])-strtotime($stored['created_at']))], JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { context: 'TENANT', member: true, accountContext: true, tenantRead: true, platform: [],
    oldCookie: false, tokenHashed: true, csrfHashed: true, cookieSecure: true,
    idle: 1800, absolute: 43200 });
});

test('Benutzernummer 00001 allein erzeugt keine Plattformrolle; nur echte Zuweisung wird angezeigt', () => {
  const data = fixture(String.raw`
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$session=lehrfahrer_account_current_session($pdo,false);
$before=lehrfahrer_account_public_session($pdo,$session);
$pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')
  ->execute([$accountA,gmdate('c')]);
$after=lehrfahrer_account_public_session($pdo,$session);
echo json_encode(['number'=>$before['userNumber'],'before'=>$before['platformRoles'],
  'after'=>$after['platformRoles']], JSON_THROW_ON_ERROR);`, String.raw`
$pdo->prepare('INSERT INTO account_user_numbers (user_number,issued_to_account_id,current_account_id,issued_at)
  VALUES (1,?,?,?)')->execute([$accountA,$accountA,gmdate('c')]);`);
  assert.deepEqual(data, { number: '00001', before: [], after: ['SYSOP'] });
});

test('Cutover-Sperre blockiert Account-, Legacy- und direkte Session-Erzeugung und ist bewusst reversibel', () => {
  const data = fixture(String.raw`
lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED');
$blocked=[];
foreach (['accountLogin','accountCreate','legacyCreate'] as $action) {
  try {
    if ($action==='accountLogin') lehrfahrer_account_login($pdo,'alpha','test-password-12345');
    elseif ($action==='accountCreate') lehrfahrer_account_create_session($pdo,$accountA,'TENANT',$membershipA);
    else lehrfahrer_auth_create_session($pdo,$userA,$companyA);
    $blocked[$action]=false;
  } catch (LehrfahrerAuthCutoverBusy $error) { $blocked[$action]=true; }
}
$during=lehrfahrer_auth_cutover_state($pdo);
lehrfahrer_auth_cutover_set_lock($pdo,'OPEN');
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
echo json_encode(['blocked'=>$blocked,'during'=>$during,
  'recovered'=>$login!==null && lehrfahrer_auth_cutover_state($pdo)['lock']==='OPEN'],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { blocked: { accountLogin: true, accountCreate: true, legacyCreate: true },
    during: { mode: 'PARALLEL', lock: 'LOCKED' }, recovered: true });
});

test('Cutover-Sperre blockiert Membership-Auswahl und Gesellschaftswechsel ohne neue Tenant-Session', () => {
  const data = fixture(String.raw`
$pending=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$pending['token'];
lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED');
$selectBlocked=false;
try { lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$pending['csrf'],'select'); }
catch (LehrfahrerAuthCutoverBusy $error) { $selectBlocked=true; }
lehrfahrer_auth_cutover_set_lock($pdo,'OPEN');
$selected=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$pending['csrf'],'select');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$selected['token'];
lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED');
$switchBlocked=false;
try { lehrfahrer_account_rotate_to_membership($pdo,$membershipB,$selected['csrf'],'switch'); }
catch (LehrfahrerAuthCutoverBusy $error) { $switchBlocked=true; }
$sessions=(int)$pdo->query("SELECT COUNT(*) FROM account_sessions WHERE revoked_at IS NULL")->fetchColumn();
echo json_encode(['selectBlocked'=>$selectBlocked,'switchBlocked'=>$switchBlocked,
  'sessions'=>$sessions,'mode'=>lehrfahrer_auth_cutover_state($pdo)['mode']],JSON_THROW_ON_ERROR);`, String.raw`
$membershipExtra=lehrfahrer_control_id('mem');
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at)
  VALUES (?,?,?,'active',?,?)")->execute([$membershipExtra,$accountA,$companyB['id'],gmdate('c'),gmdate('c')]);
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')
  ->execute([$membershipExtra,$pdo->query("SELECT id FROM roles WHERE code='FAHRER'")->fetchColumn()]);`);
  assert.deepEqual(data, { selectBlocked: true, switchBlocked: true, sessions: 1, mode: 'PARALLEL' });
});

test('Mehrere Tenantrollen werden ohne Prioritätsauswahl aus der aktiven Membership geliefert', () => {
  const data = fixture(String.raw`
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$public=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode($public['tenantRoles'], JSON_THROW_ON_ERROR);`, String.raw`
$admin=$pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')
  ->execute([$membershipA,$admin]);`);
  assert.deepEqual(data, ['ADMIN', 'FAHRER']);
});

test('Authorization-Brücke nutzt Legacy allein und Account allein aus derselben Identität', () => {
  const legacy = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$created=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$created['sessionToken'];
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'company'=>$auth['company_id']===$companyB['id'],
  'admin'=>in_array('ADMIN',$auth['roles'],true),'read'=>lehrfahrer_auth_has_capability($auth,'routes.read')],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(legacy, { source: 'LEGACY', company: true, admin: true, read: true });
  const account = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$created=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$created['token'];
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'company'=>$auth['company_id']===$companyA['id'],
  'driver'=>in_array('FAHRER',$auth['roles'],true),'read'=>lehrfahrer_auth_has_capability($auth,'routes.read'),
  'write'=>lehrfahrer_auth_has_capability($auth,'routes.write')],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(account, { source: 'ACCOUNT', company: true, driver: true, read: true, write: false });
});

test('Bei zwei Cookies hat Account Vorrang ohne Rollen- oder Tenant-Rechteunion', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$_GET['company_id']=$companyB['id'];
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'companyA'=>$auth['company_id']===$companyA['id'],
  'admin'=>in_array('ADMIN',$auth['roles'],true),'write'=>lehrfahrer_auth_has_capability($auth,'routes.write'),
  'personal'=>lehrfahrer_auth_has_capability($auth,'drivers.manage')],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { source: 'ACCOUNT', companyA: true, admin: false, write: false, personal: false });
  const reverse = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userA,$companyA);
$new=lehrfahrer_account_login($pdo,'beta','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'companyB'=>$auth['company_id']===$companyB['id'],
  'admin'=>in_array('ADMIN',$auth['roles'],true),'write'=>lehrfahrer_auth_has_capability($auth,'routes.write')],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(reverse, { source: 'ACCOUNT', companyB: true, admin: true, write: true });
});

test('Ungültige Account-Session fällt nur auf eine gültige Legacy-Session zurück', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]='invalid';
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'company'=>$auth['company_id']===$companyB['id']],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { source: 'LEGACY', company: true });
});

test('Während Cutover-Lock gibt es keinen Legacy-Fallback nach ungültiger Account-Session', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]='invalid';
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['blocked'=>$auth===null],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { blocked: true });
});

test('Production ignoriert parallelen Account-Cookie vollständig', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=production');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$auth=lehrfahrer_api_resolve_session($pdo);
echo json_encode(['source'=>$auth['auth_source'],'companyB'=>$auth['company_id']===$companyB['id']],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { source: 'LEGACY', companyB: true });
});

test('Pending-Account darf Legacy-Rechte nicht übernehmen', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_create_session($pdo,$accountA,'PENDING',null);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
lehrfahrer_api_resolve_session($pdo);`);
  assert.equal(data.ok, false);
  assert.match(data.error, /Aktive Gesellschaft/);
});

test('Deaktivierte Membership oder Gesellschaft entzieht Account-Tenantzugriff', () => {
  for (const change of [
    "$pdo->prepare('UPDATE account_memberships SET status=? WHERE id=?')->execute(['inactive',$membershipA]);",
    "$pdo->prepare('UPDATE companies SET status=? WHERE id=?')->execute(['inactive',$companyA['id']]);"
  ]) {
    const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
${change}
echo json_encode(['resolved'=>lehrfahrer_api_resolve_session($pdo) !== null],JSON_THROW_ON_ERROR);`);
    assert.deepEqual(data, { resolved: false });
  }
});

test('CSRF-Prüfung verwendet den Hash der ausgewählten Session', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$_SERVER['HTTP_X_CSRF_TOKEN']=$new['csrf'];
$auth=lehrfahrer_api_resolve_session($pdo);
lehrfahrer_auth_require_csrf($auth['session']);
echo json_encode(['source'=>$auth['auth_source'],'accepted'=>true],JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { source: 'ACCOUNT', accepted: true });
  const rejected = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$_SERVER['HTTP_X_CSRF_TOKEN']=$old['csrfToken'];
$auth=lehrfahrer_api_resolve_session($pdo);
lehrfahrer_auth_require_csrf($auth['session']);
echo json_encode(['accepted'=>true],JSON_THROW_ON_ERROR);`);
  assert.equal(rejected.ok, false);
  const reverse = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
$_SERVER['HTTP_X_CSRF_TOKEN']=$new['csrf'];
$auth=lehrfahrer_api_resolve_session($pdo);
lehrfahrer_auth_require_csrf($auth['session']);
echo json_encode(['accepted'=>true],JSON_THROW_ON_ERROR);`);
  assert.equal(reverse.ok, false);
});

test('Platform-Rechte allein erlauben keinen Tenantzugang', () => {
  const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$old=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$old['sessionToken'];
lehrfahrer_api_resolve_session($pdo);`, String.raw`
$pdo->prepare("UPDATE account_memberships SET status='inactive' WHERE id=?")->execute([$membershipA]);
$pdo->prepare('INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,?,?)')->execute([$accountA,'COSYSOP',gmdate('c')]);`);
  assert.equal(data.ok, false);
  assert.match(data.error, /Aktive Gesellschaft/);
});

test('Abgelaufene und widerrufene Account-Sessions liefern keine Tenantrechte', () => {
  for (const update of [
    "UPDATE account_sessions SET idle_expires_at='2000-01-01T00:00:00Z'",
    "UPDATE account_sessions SET absolute_expires_at='2000-01-01T00:00:00Z'",
    "UPDATE account_sessions SET revoked_at='2000-01-01T00:00:00Z'"
  ]) {
    const data = fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
require ${quote(path.join(root, 'api', '_api_authorization.php'))};
$new=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$new['token'];
$pdo->exec(${quote(update)});
echo json_encode(['resolved'=>lehrfahrer_api_resolve_session($pdo) !== null],JSON_THROW_ON_ERROR);`);
    assert.deepEqual(data, { resolved: false });
  }
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

test('Gesellschaftswechsel A → B → A rotiert Sessions und verwirft alte Tenant-Rechte', () => {
  const data = fixture(String.raw`
$pending=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$pending['token'];
$selected=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$pending['csrf']);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$selected['token'];
$before=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
$switched=lehrfahrer_account_rotate_to_membership($pdo,$membershipExtra,$selected['csrf'],'switch');
$oldTokenHash=lehrfahrer_auth_token_hash($selected['token']);
$query=$pdo->prepare('SELECT revoked_at FROM account_sessions WHERE session_token_hash=?');
$query->execute([$oldTokenHash]);
$oldRevoked=$query->fetchColumn()!==null;
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$selected['token'];
$oldRejected=lehrfahrer_account_current_session($pdo,false)===null;
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$switched['token'];
$atB=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
$back=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$switched['csrf'],'switch');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$back['token'];
$atA=lehrfahrer_account_public_session($pdo,lehrfahrer_account_current_session($pdo,false));
echo json_encode(['beforeAdmin'=>in_array('users.manage',$before['tenantCapabilities'],true),
  'atBAdmin'=>in_array('users.manage',$atB['tenantCapabilities'],true),
  'backAdmin'=>in_array('users.manage',$atA['tenantCapabilities'],true),
  'memberB'=>$atB['membershipId']===$membershipExtra,'memberA'=>$atA['membershipId']===$membershipA,
  'roleBefore'=>$before['tenantRoles']===['FAHRER'],
  'roleB'=>$atB['tenantRoles']===['ADMIN'],
  'numberStable'=>$before['userNumber']==='00101' && $atB['userNumber']===$before['userNumber']
    && $atA['userNumber']===$before['userNumber'],
  'companies'=>$before['companyName']==='A' && $atB['companyName']==='B' && $atA['companyName']==='A',
  'oldRevoked'=>$oldRevoked,'oldRejected'=>$oldRejected,'newCsrf'=>$switched['csrf']!==$selected['csrf'],
  'newToken'=>$switched['token']!==$selected['token'],
  'platformUnchanged'=>$before['platformCapabilities']===$atB['platformCapabilities']
    && $atB['platformCapabilities']===$atA['platformCapabilities'],
  'switchEvent'=>$switched['contextEvent']['action']==='switch'
    && $switched['contextEvent']['fromMembershipId']===$membershipA
    && $switched['contextEvent']['toMembershipId']===$membershipExtra], JSON_THROW_ON_ERROR);`, String.raw`
$membershipExtra=lehrfahrer_control_id('mem');
$pdo->beginTransaction(); lehrfahrer_control_allocate_user_number($pdo,$accountA); $pdo->commit();
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")->execute([$membershipExtra,$accountA,$companyB['id'],gmdate('c'),gmdate('c')]);
$roleB=$pdo->query('SELECT role_id FROM membership_roles WHERE membership_id=' . $pdo->quote($membershipB))->fetchColumn();
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipExtra,$roleB]);`);
  assert.deepEqual(data, { beforeAdmin: false, atBAdmin: true, backAdmin: false,
    roleBefore: true, roleB: true, numberStable: true, companies: true,
    memberB: true, memberA: true, oldRevoked: true, oldRejected: true, newCsrf: true, newToken: true,
    platformUnchanged: true, switchEvent: true });
});

test('Wechsel verlangt zwei aktive eigene Memberships und korrektes CSRF', () => {
  const data = fixture(String.raw`
$single=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$single['token'];
$foreign=lehrfahrer_account_rotate_to_membership($pdo,$membershipB,$single['csrf'],'switch')===null;
$same=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$single['csrf'],'switch')===null;
$missingCsrf=lehrfahrer_account_rotate_to_membership($pdo,$membershipB,'','switch')===null;
$wrongCsrf=lehrfahrer_account_rotate_to_membership($pdo,$membershipB,'wrong','switch')===null;
$sessionStillValid=lehrfahrer_account_current_session($pdo,false)!==null;
echo json_encode(compact('foreign','same','missingCsrf','wrongCsrf','sessionStillValid'), JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { foreign: true, same: true, missingCsrf: true,
    wrongCsrf: true, sessionStillValid: true });
});

test('Mitgliedschafts- und Gesellschaftsdeaktivierung entziehen laufender Session sofort den Kontext', () => {
  const data = fixture(String.raw`
$first=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$first['token'];
$pdo->prepare("UPDATE account_memberships SET status='inactive' WHERE id=?")->execute([$membershipA]);
$membershipRevoked=lehrfahrer_account_current_session($pdo,false)===null;
$pdo->prepare("UPDATE account_memberships SET status='active' WHERE id=?")->execute([$membershipA]);
$second=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$second['token'];
$pdo->prepare("UPDATE companies SET status='inactive' WHERE id=?")->execute([$companyA['id']]);
$companyRevoked=lehrfahrer_account_current_session($pdo,false)===null;
echo json_encode(compact('membershipRevoked','companyRevoked'), JSON_THROW_ON_ERROR);`);
  assert.deepEqual(data, { membershipRevoked: true, companyRevoked: true });
});

test('Angebotsliste enthält nur eigene aktive Memberships aktiver Gesellschaften', () => {
  const data = fixture(String.raw`
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$session=lehrfahrer_account_current_session($pdo,false);
$list=lehrfahrer_account_available_memberships($pdo,$session);
echo json_encode(['pending'=>$session['context_type'],'count'=>count($list),
  'own'=>count(array_filter($list,fn($m)=>$m['id']===$membershipA || $m['id']===$membershipExtra))===2,
  'foreignMissing'=>count(array_filter($list,fn($m)=>$m['id']===$membershipB))===0,
  'inactiveMissing'=>count(array_filter($list,fn($m)=>$m['id']===$membershipInactive))===0,
  'companyInactiveMissing'=>count(array_filter($list,fn($m)=>$m['id']===$membershipCompanyInactive))===0,
  'minimalFields'=>array_keys($list[0])===['id','company_id','slug','name']], JSON_THROW_ON_ERROR);`, String.raw`
$companyC=$companies->create(['slug'=>'phase-c','name'=>'C','status'=>'active','license_status'=>'active']);
$companyD=$companies->create(['slug'=>'phase-d','name'=>'D','status'=>'inactive','license_status'=>'active']);
$membershipExtra=lehrfahrer_control_id('mem');
$membershipInactive=lehrfahrer_control_id('mem');
$membershipCompanyInactive=lehrfahrer_control_id('mem');
$insert=$pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)');
$insert->execute([$membershipExtra,$accountA,$companyB['id'],'active',gmdate('c'),gmdate('c')]);
$insert->execute([$membershipInactive,$accountA,$companyC['id'],'inactive',gmdate('c'),gmdate('c')]);
$insert->execute([$membershipCompanyInactive,$accountA,$companyD['id'],'active',gmdate('c'),gmdate('c')]);`);
  assert.deepEqual(data, { pending: 'PENDING', count: 2, own: true, foreignMissing: true,
    inactiveMissing: true, companyInactiveMissing: true, minimalFields: true });
});

test('Kontextwechsel lehnt fremde, inaktive und Gesellschafts-inaktive Ziele ab', () => {
  const data = fixture(String.raw`
$pending=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$pending['token'];
$selected=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$pending['csrf']);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$selected['token'];
$foreign=lehrfahrer_account_rotate_to_membership($pdo,$membershipB,$selected['csrf'],'switch')===null;
$inactive=lehrfahrer_account_rotate_to_membership($pdo,$membershipInactive,$selected['csrf'],'switch')===null;
$inactiveCompany=lehrfahrer_account_rotate_to_membership($pdo,$membershipCompanyInactive,$selected['csrf'],'switch')===null;
$sameSession=lehrfahrer_account_current_session($pdo,false)['membership_id']===$membershipA;
echo json_encode(compact('foreign','inactive','inactiveCompany','sameSession'), JSON_THROW_ON_ERROR);`, String.raw`
$companyC=$companies->create(['slug'=>'phase-c','name'=>'C','status'=>'active','license_status'=>'active']);
$companyD=$companies->create(['slug'=>'phase-d','name'=>'D','status'=>'inactive','license_status'=>'active']);
$membershipExtra=lehrfahrer_control_id('mem');
$membershipInactive=lehrfahrer_control_id('mem');
$membershipCompanyInactive=lehrfahrer_control_id('mem');
$insert=$pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)');
$insert->execute([$membershipExtra,$accountA,$companyB['id'],'active',gmdate('c'),gmdate('c')]);
$insert->execute([$membershipInactive,$accountA,$companyC['id'],'inactive',gmdate('c'),gmdate('c')]);
$insert->execute([$membershipCompanyInactive,$accountA,$companyD['id'],'active',gmdate('c'),gmdate('c')]);`);
  assert.deepEqual(data, { foreign: true, inactive: true, inactiveCompany: true, sameSession: true });
});

test('abgelaufene und widerrufene Auswahl-Sessions können keinen Kontext mehr erzeugen', () => {
  const data = fixture(String.raw`
$first=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$first['token'];
$pdo->prepare('UPDATE account_sessions SET idle_expires_at=? WHERE session_token_hash=?')->execute([gmdate('c',time()-1),lehrfahrer_auth_token_hash($first['token'])]);
$expired=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$first['csrf'])===null;
$second=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$second['token'];
$pdo->prepare('UPDATE account_sessions SET revoked_at=? WHERE session_token_hash=?')->execute([gmdate('c'),lehrfahrer_auth_token_hash($second['token'])]);
$revoked=lehrfahrer_account_rotate_to_membership($pdo,$membershipA,$second['csrf'])===null;
$tenantSessions=(int)$pdo->query("SELECT COUNT(*) FROM account_sessions WHERE context_type='TENANT'")->fetchColumn();
echo json_encode(compact('expired','revoked','tenantSessions'), JSON_THROW_ON_ERROR);`, String.raw`
$membershipExtra=lehrfahrer_control_id('mem');
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")->execute([$membershipExtra,$accountA,$companyB['id'],gmdate('c'),gmdate('c')]);`);
  assert.deepEqual(data, { expired: true, revoked: true, tenantSessions: 0 });
});
