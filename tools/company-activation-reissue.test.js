const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-reissue-'));
const php = [process.env.PHP_BINARY, 'php', ...(process.platform === 'win32' ? ['C:\\xampp\\php\\php.exe'] : [])]
  .filter(Boolean).find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const bootstrap = `require ${quote(path.join(root, 'api', '_company_provisioning.php'))};`;
const env = { ...process.env, LEHRFAHRER_ENV: 'dev', LEHRFAHRER_DB_DRIVER: 'sqlite',
  LEHRFAHRER_PRIVATE_DATA_DIR: path.join(sandbox, 'private') };
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function run(code) {
  const result = spawnSync(php, ['-r', bootstrap + code], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function create(name) {
  return JSON.parse(run(`$r=lehrfahrer_create_company_from_template(lehrfahrer_control_database(),[
    'name'=>${quote(name)},'slug'=>${quote(name)},'license_status'=>'active',
    'admin_display_name'=>'Admin','admin_login'=>'first-admin']);
    echo json_encode(['company'=>$r['company']['id'],'user'=>$r['admin']['id'],
      'token'=>$r['activation']['token']]);`));
}
function reissue(fixture) {
  return JSON.parse(run(`echo json_encode(lehrfahrer_reissue_company_admin_activation(
    lehrfahrer_control_database(),${quote(fixture.company)},'first-admin'));`));
}
function tokenState(fixture) {
  return JSON.parse(run(`$s=lehrfahrer_control_database()->prepare(
    'SELECT token_hash,expires_at,used_at FROM user_activation_tokens WHERE company_id=:company AND user_id=:user');
    $s->execute([':company'=>${quote(fixture.company)},':user'=>${quote(fixture.user)}]);
    echo json_encode($s->fetchAll());`));
}
function rejected(code) {
  assert.equal(run(`try { ${code} echo 'accepted'; }
    catch (Throwable $error) { echo 'rejected'; }`), 'rejected');
}
function concurrent(fixture) {
  return new Promise((resolve, reject) => {
    const worker = spawn(php, ['-r', bootstrap + `try { $r=lehrfahrer_reissue_company_admin_activation(
      lehrfahrer_control_database(),${quote(fixture.company)},'first-admin'); echo json_encode($r); }
      catch (Throwable $error) { exit(1); }`], { cwd: root, env, windowsHide: true });
    let output = '';
    let error = '';
    worker.stdout.on('data', chunk => { output += chunk; });
    worker.stderr.on('data', chunk => { error += chunk; });
    worker.once('error', reject);
    worker.once('close', status => status === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  });
}

test('inaktiver Erstadmin: 48h-Reissue ersetzt einzigen Hash und macht alten Token ungueltig', () => {
  const fixture = create('reissue-basic');
  const first = reissue(fixture);
  const rows = tokenState(fixture);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, run(`echo lehrfahrer_company_activation_token_hash(${quote(first.token)});`));
  assert.notEqual(first.token, fixture.token);
  assert.equal(rows[0].used_at, null);
  assert.ok(Math.abs(Date.parse(first.expires_at) - Date.now() - 48 * 3600e3) < 5000);
  assert.equal(fs.readFileSync(path.join(env.LEHRFAHRER_PRIVATE_DATA_DIR, 'control', 'lehrfahrer.sqlite')).includes(Buffer.from(first.token)), false);
  assert.equal(fs.readFileSync(path.join(env.LEHRFAHRER_PRIVATE_DATA_DIR, 'control', 'lehrfahrer.sqlite')).includes(Buffer.from(fixture.token)), false);
  rejected(`lehrfahrer_activate_company_admin(lehrfahrer_control_database(),${quote(fixture.token)},'Valid-Testpasswort-123!');`);
});

test('aktive, unbekannte und nicht aktivierbare Benutzer werden neutral abgelehnt', () => {
  const fixture = create('reissue-active');
  run(`lehrfahrer_activate_company_admin(lehrfahrer_control_database(),${quote(fixture.token)},'Valid-Testpasswort-123!');`);
  rejected(`lehrfahrer_reissue_company_admin_activation(lehrfahrer_control_database(),${quote(fixture.company)},'first-admin');`);
  rejected(`lehrfahrer_reissue_company_admin_activation(lehrfahrer_control_database(),${quote(fixture.company)},'unknown');`);
  rejected(`lehrfahrer_reissue_company_admin_activation(lehrfahrer_control_database(),'cmp_${'a'.repeat(32)}','first-admin');`);
});

test('parallele Reissues: nur zuletzt gespeicherter Token gueltig', async () => {
  const fixture = create('reissue-race');
  const [one, two] = await Promise.all([concurrent(fixture), concurrent(fixture)]);
  assert.notEqual(one.token, two.token);
  const hash = tokenState(fixture)[0].token_hash;
  const valid = [one, two].filter(result => run(`echo lehrfahrer_company_activation_token_hash(${quote(result.token)});`) === hash);
  assert.equal(valid.length, 1);
});

test('Datenbankfehler rollt den Tokenaustausch vollstaendig zurueck', () => {
  const fixture = create('reissue-rollback');
  const before = tokenState(fixture);
  run(`lehrfahrer_control_database()->exec('CREATE TRIGGER fail_reissue BEFORE UPDATE ON user_activation_tokens
    BEGIN SELECT RAISE(ABORT, "test rollback"); END');`);
  rejected(`lehrfahrer_reissue_company_admin_activation(lehrfahrer_control_database(),${quote(fixture.company)},'first-admin');`);
  assert.deepEqual(tokenState(fixture), before);
});

test('Operator-Weg ist privat, nicht HTTP oder Workflow-Ausfuehrung; kein Klartext in statischen Ausgaben', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-strato-staging.yml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'tools/reissue-first-admin-activation.php'), 'utf8');
  assert.match(workflow, /tools\/reissue-first-admin-activation\.php/);
  assert.match(workflow, /\$private_root\/reissue-first-admin-activation\.php/);
  assert.doesNotMatch(workflow, /php[^\n]*-f[^\n]*reissue-first-admin-activation\.php/);
  assert.match(script, /fopen\('\/dev\/tty', 'w'\)/);
  assert.match(script, /getenv\('REQUEST_METHOD'\)/);
  assert.doesNotMatch(script, /echo\s+\$result|file_put_contents\([^)]*\$result/);
  const attempted = spawnSync(php, [path.join(root, 'tools/reissue-first-admin-activation.php')],
    { cwd: root, env, encoding: 'utf8' });
  assert.notEqual(attempted.status, 0);
  assert.equal(attempted.stdout, '');
});
