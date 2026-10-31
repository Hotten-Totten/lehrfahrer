const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-auth-cutover-race-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  command => command && spawnSync(command, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const q = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const common = (folder, direct = false) => `
putenv('LEHRFAHRER_ENV=dev'); putenv('LEHRFAHRER_DB_DRIVER=sqlite');
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${q(folder)});
$_SERVER['DOCUMENT_ROOT']=${q(path.join(folder, 'webroot'))};
require ${q(path.join(root, 'api/_account_auth.php'))};
$pdo=${direct ? `new PDO('sqlite:' . ${q(path.join(folder, 'control', 'lehrfahrer.sqlite'))},null,null,
  [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_TIMEOUT=>5])` : 'lehrfahrer_control_database()'};`;
const run = (folder, code) => {
  const result = spawnSync(php, ['-r', common(folder) + code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
};
const start = (folder, code) => {
  const child = spawn(php, ['-r', common(folder, true) + code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return { child, done: new Promise((resolve, reject) => child.on('exit', exit =>
    exit === 0 ? resolve(stdout ? JSON.parse(stdout) : null) : reject(new Error(stderr)))) };
};
async function untilExists(file) {
  for (let i = 0; i < 300; i++) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Synchronisationsdatei fehlt: ${file}`);
}

for (const action of ['login', 'switch']) {
  test(`SQLite: ${action} kreuzt die Cutover-Sperrgrenze nicht`, async () => {
    const folder = fs.mkdtempSync(path.join(temp, `${action}-`));
    const session = run(folder, `
$companies=new LehrfahrerCompanyRepository($pdo); $users=new LehrfahrerUserRepository($pdo);
$a=$companies->create(['slug'=>'firm-alpha','name'=>'A','status'=>'active','license_status'=>'active']);
$b=$companies->create(['slug'=>'firm-beta','name'=>'B','status'=>'active','license_status'=>'active']);
$user=$users->create($a['id'],['login'=>'alpha','display_name'=>'A','password'=>'test-password-12345']);
$legacy=$users->findAuthenticationRecordByLogin($a['id'],'alpha');
$account=lehrfahrer_control_id('acc'); $memberA=lehrfahrer_control_id('mem'); $memberB=lehrfahrer_control_id('mem');
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
  ->execute([$account,'alpha','A',$legacy['password_hash'],gmdate('c'),gmdate('c')]);
foreach ([[$memberA,$a['id']],[$memberB,$b['id']]] as [$member,$company])
  $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
    ->execute([$member,$account,$company,gmdate('c'),gmdate('c')]);
$login=lehrfahrer_account_login($pdo,'alpha','test-password-12345');
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$login['token'];
$selected=lehrfahrer_account_rotate_to_membership($pdo,$memberA,$login['csrf'],'select');
echo json_encode(['token'=>$selected['token'],'csrf'=>$selected['csrf'],'memberB'=>$memberB],JSON_THROW_ON_ERROR);`);
    const ready = path.join(folder, 'ready');
    const started = path.join(folder, 'started');
    const release = path.join(folder, 'release');
    const holder = start(folder, `
$pdo->exec('BEGIN IMMEDIATE');
file_put_contents(${q(ready)},'ready');
while (!is_file(${q(release)})) usleep(10000);
$pdo->prepare('INSERT INTO control_metadata (\`key\`,value,updated_at) VALUES (?,?,?)')
  ->execute(['auth_cutover_lock','LOCKED',gmdate('c')]);
$pdo->exec('COMMIT');`);
    try {
      await untilExists(ready);
      const contender = start(folder, `
file_put_contents(${q(started)},'started');
$blocked=false;
try {
  ${action === 'login'
    ? "lehrfahrer_account_login($pdo,'alpha','test-password-12345');"
    : `$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=${q(session.token)};
       lehrfahrer_account_rotate_to_membership($pdo,${q(session.memberB)},${q(session.csrf)},'switch');`}
} catch (LehrfahrerAuthCutoverBusy $error) { $blocked=true; }
echo json_encode(['blocked'=>$blocked,'sessions'=>(int)$pdo->query('SELECT COUNT(*) FROM account_sessions')->fetchColumn()],JSON_THROW_ON_ERROR);`);
      await untilExists(started);
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.writeFileSync(release, 'release');
      await holder.done;
      const result = await contender.done;
      assert.equal(result.blocked, true);
      assert.equal(result.sessions, 2);
      const state = run(folder, `echo json_encode(lehrfahrer_auth_cutover_state($pdo),JSON_THROW_ON_ERROR);`);
      assert.deepEqual(state, { mode: 'PARALLEL', lock: 'LOCKED' });
    } finally {
      if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
      await holder.done;
    }
  });
}
