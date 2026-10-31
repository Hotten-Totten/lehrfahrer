const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-phase2-'));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP ist für den Phase-2-Schematest erforderlich.');
const quoted = value => JSON.stringify(value.replaceAll('\\', '/'));
const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quoted(sandbox)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${quoted(path.join(sandbox, 'webroot'))};
require ${quoted(path.join(root, 'api', '_control_repositories.php'))};
$pdo = lehrfahrer_control_database();
$initial = (int)$pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
lehrfahrer_control_migrate($pdo); lehrfahrer_control_apply_phase2_schema($pdo);
$again = (int)$pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
$counts = [];
foreach (['accounts','account_memberships','membership_roles','account_platform_roles','sysop_assignment','account_sessions','account_activation_tokens','users','user_roles','sessions','user_activation_tokens'] as $table)
    $counts[$table] = (int)$pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
$roles = $pdo->query('SELECT code FROM platform_roles ORDER BY code')->fetchAll(PDO::FETCH_COLUMN);
$caps = $pdo->query('SELECT code FROM platform_capabilities ORDER BY code')->fetchAll(PDO::FETCH_COLUMN);
$bindings = $pdo->query('SELECT r.code role, c.code capability FROM platform_role_capabilities rc JOIN platform_roles r ON r.id=rc.role_id JOIN platform_capabilities c ON c.id=rc.capability_id ORDER BY r.code,c.code')->fetchAll();
$rejected = function (string $sql, array $args = []) use ($pdo): bool {
    try { $statement = $pdo->prepare($sql); $statement->execute($args); return false; }
    catch (PDOException $error) { return true; }
};
$timestamp = '2026-01-01T00:00:00+00:00';
$account = function (string $id, string $login) use ($pdo, $timestamp): void {
    $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?, ?,1,0,?,?)')->execute([$id,$login,$id,'hash',$timestamp,$timestamp]);
};
$account('acc_a','unique.a'); $account('acc_b','unique.b');
$loginUnique = $rejected('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)', ['acc_c','unique.a','C','hash',$timestamp,$timestamp]);
$companies = new LehrfahrerCompanyRepository($pdo);
$companyA = $companies->create(['slug'=>'phase2-a','name'=>'Phase 2 A','status'=>'active','license_status'=>'active']);
$companyB = $companies->create(['slug'=>'phase2-b','name'=>'Phase 2 B','status'=>'active','license_status'=>'active']);
$membership = function (string $id, string $accountId, string $companyId, ?string $legacy) use ($pdo,$timestamp): void {
    $pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,\'active\',?,?,?)')->execute([$id,$accountId,$companyId,$legacy,$timestamp,$timestamp]);
};
$membership('mem_a','acc_a',$companyA['id'],'usr_old_a');
$membership('mem_b','acc_b',$companyA['id'],'usr_old_b');
$membershipUnique = $rejected('INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,\'active\',?,?)', ['mem_dup','acc_a',$companyA['id'],$timestamp,$timestamp]);
$legacyUnique = $rejected('INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,\'active\',?,?,?)', ['mem_dup','acc_a',$companyB['id'],'usr_old_a',$timestamp,$timestamp]);
$membershipFk = $rejected('INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,\'active\',?,?)', ['mem_bad','missing',$companyB['id'],$timestamp,$timestamp]);
$roleFk = $rejected('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)', ['mem_a','missing']);
$platformFk = $rejected('INSERT INTO platform_role_capabilities (role_id,capability_id) VALUES (?,?)', ['prole_sysop','missing']);
$sysopInitiallyEmpty = (int)$pdo->query('SELECT COUNT(*) FROM sysop_assignment')->fetchColumn() === 0;
$pdo->prepare('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (1,?,?)')->execute(['acc_a',$timestamp]);
$secondSysop = $rejected('INSERT INTO sysop_assignment (singleton_key,account_id,assigned_at) VALUES (2,?,?)', ['acc_b',$timestamp]);
$pdo->prepare('INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,\'COSYSOP\',?)')->execute(['acc_a',$timestamp]);
$pdo->prepare('INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,\'COSYSOP\',?)')->execute(['acc_b',$timestamp]);
$multipleCosysop = (int)$pdo->query('SELECT COUNT(*) FROM account_platform_roles')->fetchColumn() === 2;
$sysopRoleRejected = $rejected('INSERT INTO account_platform_roles (account_id,role_code,assigned_at) VALUES (?,?,?)', ['acc_b','SYSOP',$timestamp]);
$session = function (string $id,string $accountId,string $context,?string $member,?string $company) use ($pdo,$timestamp): void {
    $pdo->prepare('INSERT INTO account_sessions (id,account_id,session_token_hash,csrf_token_hash,context_type,membership_id,technical_company_id,environment,created_at,last_activity_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,?,?,?,\'dev\',?,?,?,?)')->execute([$id,$accountId,str_repeat($id,10),str_repeat('c',64),$context,$member,$company,$timestamp,$timestamp,$timestamp,$timestamp]);
};
$session('pending','acc_a','PENDING',null,null);
$session('tenant','acc_a','TENANT','mem_a',null);
$session('platform','acc_a','PLATFORM',null,null);
$session('technical','acc_a','PLATFORM_COMPANY',null,$companyA['id']);
$invalidContext = $rejected('INSERT INTO account_sessions (id,account_id,session_token_hash,csrf_token_hash,context_type,environment,created_at,last_activity_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,\'TENANT\',\'dev\',?,?,?,?)', ['bad','acc_a','badtoken',str_repeat('c',64),$timestamp,$timestamp,$timestamp,$timestamp]);
$foreignMembership = $rejected('INSERT INTO account_sessions (id,account_id,session_token_hash,csrf_token_hash,context_type,membership_id,environment,created_at,last_activity_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,\'TENANT\',?,\'dev\',?,?,?,?)', ['foreign','acc_b','foreigntoken',str_repeat('c',64),'mem_a',$timestamp,$timestamp,$timestamp,$timestamp]);
echo json_encode(compact('initial','again','counts','roles','caps','bindings','loginUnique','membershipUnique','legacyUnique','membershipFk','roleFk','platformFk','sysopInitiallyEmpty','secondSysop','multipleCosysop','sysopRoleRejected','invalidContext','foreignMembership'), JSON_THROW_ON_ERROR);
`;
const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const fixture = JSON.parse(result.stdout);

test('additive Migration und wiederholter Lauf lassen Altbestand unverändert', () => {
  assert.equal(fixture.initial, 5);
  assert.equal(fixture.again, 5);
  for (const count of Object.values(fixture.counts)) assert.equal(count, 0);
});

test('nur Plattformdefinitionen V1 werden ohne Account-Zuweisung angelegt', () => {
  assert.deepEqual(fixture.roles, ['COSYSOP', 'SYSOP']);
  assert.equal(fixture.caps.length, 9);
  assert.ok(!fixture.caps.includes('platform.communications.moderate'));
  assert.equal(fixture.bindings.filter(binding => binding.role === 'SYSOP').length, 9);
  const co = fixture.bindings.filter(binding => binding.role === 'COSYSOP').map(binding => binding.capability);
  assert.equal(co.length, 7);
  assert.ok(!co.includes('platform.system.manage'));
  assert.ok(!co.includes('platform.roles.manage'));
});

test('Identität, Mitgliedschaft und Plattformrechte sind durch DB-Constraints getrennt', () => {
  for (const key of ['loginUnique','membershipUnique','legacyUnique','membershipFk','roleFk','platformFk','sysopInitiallyEmpty','secondSysop','multipleCosysop','sysopRoleRejected'])
    assert.equal(fixture[key], true, key);
});

test('zukünftige Session-Kontexte erlauben nur passende Account-/Mitgliedschaftsbezüge', () => {
  assert.equal(fixture.invalidContext, true);
  assert.equal(fixture.foreignMembership, true);
});
