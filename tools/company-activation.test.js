const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-activation-'));
const privateRoot = path.join(sandbox, 'private');
const php = [process.env.PHP_BINARY, 'php', ...(process.platform === 'win32' ? ['C:\\xampp\\php\\php.exe'] : [])]
  .filter(Boolean).find(candidate => {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    return !result.error && result.status === 0;
  });
if (!php) throw new Error('PHP ist fuer den Activation-Test erforderlich.');

const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let origin;
let server;
let logs = '';
let cases;

function environment() {
  return {
    ...process.env,
    LEHRFAHRER_ENV: 'dev',
    LEHRFAHRER_DB_DRIVER: 'sqlite',
    LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
    LEHRFAHRER_PUBLIC_ORIGIN: origin || 'http://127.0.0.1'
  };
}

function runPhp(code) {
  const result = spawnSync(php, ['-r', code], {
    cwd: projectRoot, env: environment(), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function request(endpoint, body, options = {}) {
  const response = await fetch(origin + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {
      'Content-Type': 'application/json',
      ...(options.origin === false ? {} : { Origin: origin })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await response.text();
  return { response, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

function activation(name, overrides = {}) {
  return {
    token: cases[name].token,
    password: 'Aktivierung-Testpasswort-2!',
    passwordConfirmation: 'Aktivierung-Testpasswort-2!',
    ...overrides
  };
}

function state(name) {
  const code = `require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};`
    + `$pdo=lehrfahrer_control_database();`
    + `$user=$pdo->prepare('SELECT active,password_hash FROM users WHERE id=:id');`
    + `$user->execute([':id'=>${phpString(cases[name].user)}]);`
    + `$token=$pdo->prepare('SELECT COUNT(*) FROM user_activation_tokens WHERE user_id=:id');`
    + `$token->execute([':id'=>${phpString(cases[name].user)}]);`
    + `echo json_encode(['user'=>$user->fetch(),'tokens'=>(int)$token->fetchColumn()]);`;
  return JSON.parse(runPhp(code));
}

function concurrentActivation(token) {
  const code = `require ${phpString(path.join(projectRoot, 'api', '_company_provisioning.php'))};`
    + `try { lehrfahrer_activate_company_admin(lehrfahrer_control_database(),`
    + `${phpString(token)},'Parallel-Testpasswort-2!'); echo 'success'; }`
    + `catch (Throwable $error) { echo 'rejected'; }`;
  return new Promise((resolve, reject) => {
    const worker = spawn(php, ['-r', code], {
      cwd: projectRoot, env: environment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let error = '';
    worker.stdout.on('data', chunk => { output += chunk; });
    worker.stderr.on('data', chunk => { error += chunk; });
    worker.once('error', reject);
    worker.once('close', status => status === 0 ? resolve(output) : reject(new Error(error)));
  });
}

before(async () => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  const seed = `
require ${phpString(path.join(projectRoot, 'api', '_company_provisioning.php'))};
$pdo=lehrfahrer_control_database();
$cases=[];
foreach (['success','expired','active','mismatch','short','race','rollback','reissue'] as $name) {
    $result=lehrfahrer_create_company_from_template($pdo,[
        'name'=>'Test '.$name, 'slug'=>'activation-'.$name,
        'license_status'=>'active', 'admin_display_name'=>'Test Admin',
        'admin_login'=>'test-admin'
    ]);
    $cases[$name]=['company'=>$result['company']['slug'],
        'companyId'=>$result['company']['id'],
        'user'=>$result['admin']['id'], 'token'=>$result['activation']['token']];
}
$expired=$pdo->prepare('UPDATE user_activation_tokens SET expires_at=:expiry WHERE user_id=:id');
$expired->execute([':expiry'=>'2000-01-01T00:00:00Z',':id'=>$cases['expired']['user']]);
$active=$pdo->prepare('UPDATE users SET active=1 WHERE id=:id');
$active->execute([':id'=>$cases['active']['user']]);
echo json_encode($cases);`;
  cases = JSON.parse(runPhp(seed));
  server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', projectRoot], {
    cwd: projectRoot, env: environment(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
  });
  server.stderr.on('data', chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await request('/activate.php')).response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('PHP-Testserver konnte nicht gestartet werden.');
});

after(() => {
  if (server) server.kill();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('Aktivierungsseite: no-store, restriktiver Referrer/CSP und kein Token in HTML', async () => {
  const { response, body } = await request('/activate.php');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(body, /Neues Passwort/);
  assert.doesNotMatch(body, /activation-success|token=/);
  const script = fs.readFileSync(path.join(projectRoot, 'js', 'activate.js'), 'utf8');
  assert.match(script, /history\.replaceState/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
});

test('Login vor Aktivierung abgelehnt; gültiger Token aktiviert ohne Session; danach Login möglich', async () => {
  const login = () => request('/api/auth/login.php', {
    company: 'activation-success', login: 'test-admin', password: 'Aktivierung-Testpasswort-2!'
  });
  assert.equal((await login()).response.status, 401);
  const result = await request('/api/auth/activate.php', activation('success'));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.response.headers.get('cache-control'), /no-store/);
  assert.equal(result.response.headers.get('set-cookie'), null);
  assert.equal(state('success').user.active, 1);
  assert.equal(state('success').tokens, 0);
  assert.equal((await login()).response.status, 200);
  assert.equal((await request('/api/auth/activate.php', activation('success'))).response.status, 400);
});

test('falscher und abgelaufener Token sowie aktiver Benutzer werden abgelehnt', async () => {
  assert.equal((await request('/api/auth/activate.php', activation('mismatch', { token: 'A'.repeat(43) }))).response.status, 400);
  assert.equal((await request('/api/auth/activate.php', activation('expired'))).response.status, 400);
  assert.equal((await request('/api/auth/activate.php', activation('active'))).response.status, 400);
  assert.equal(state('expired').user.active, 0);
  assert.equal(state('expired').tokens, 1);
  assert.equal(state('active').tokens, 1);
});

test('Reissue: alter Token wird vom bestehenden HTTP-Endpunkt abgelehnt, neuer aktiviert', async () => {
  const oldToken = cases.reissue.token;
  const output = runPhp(`require ${phpString(path.join(projectRoot, 'api', '_company_provisioning.php'))};`
    + `$result=lehrfahrer_reissue_company_admin_activation(lehrfahrer_control_database(),`
    + `${phpString(cases.reissue.companyId)},'test-admin'); echo json_encode($result);`);
  const replacement = JSON.parse(output);
  assert.equal((await request('/api/auth/activate.php', activation('reissue'))).response.status, 400);
  assert.equal((await request('/api/auth/activate.php', activation('reissue', { token: replacement.token }))).response.status, 200);
  assert.equal(state('reissue').user.active, 1);
  assert.equal(state('reissue').tokens, 0);
  assert.equal(logs.includes(oldToken), false);
  assert.equal(logs.includes(replacement.token), false);
});

test('Passwortbestätigung und Mindestlänge werden geprüft; ohne Origin kein POST', async () => {
  assert.equal((await request('/api/auth/activate.php', activation('mismatch', {
    passwordConfirmation: 'Anderes-Testpasswort-2!'
  }))).response.status, 400);
  assert.equal((await request('/api/auth/activate.php', activation('short', {
    password: 'kurz', passwordConfirmation: 'kurz'
  }))).response.status, 400);
  assert.equal((await request('/api/auth/activate.php', activation('mismatch'), { origin: false })).response.status, 403);
  assert.equal(state('mismatch').user.active, 0);
  assert.equal(state('short').user.active, 0);
});

test('parallele Aktivierungsversuche: genau einer erfolgreich', async () => {
  const results = await Promise.all([
    concurrentActivation(cases.race.token), concurrentActivation(cases.race.token)
  ]);
  assert.deepEqual(results.sort(), ['rejected', 'success']);
  assert.equal(state('race').user.active, 1);
  assert.equal(state('race').tokens, 0);
});

test('DB-Fehler beim Tokenverbrauch rollt Benutzeraktivierung vollständig zurück', () => {
  runPhp(`require ${phpString(path.join(projectRoot, 'api', '_control_database.php'))};`
    + `$pdo=lehrfahrer_control_database();`
    + `$pdo->exec('CREATE TRIGGER fail_activation_delete BEFORE DELETE ON user_activation_tokens BEGIN SELECT RAISE(ABORT, "test rollback"); END');`);
  const result = concurrentActivation(cases.rollback.token);
  return result.then(output => {
    assert.equal(output, 'rejected');
    assert.equal(state('rollback').user.active, 0);
    assert.equal(state('rollback').tokens, 1);
  });
});

test('Rate-Limit begrenzt Versuche und setzt nach Zeitfenster zurück', () => {
  const code = `require ${phpString(path.join(projectRoot, 'api', '_activation_rate_limit.php'))};`
    + `$results=[]; for($i=0;$i<11;$i++) $results[]=lehrfahrer_activation_allow_attempt('test-address',1000);`
    + `$results[]=lehrfahrer_activation_allow_attempt('test-address',1901); echo json_encode($results);`;
  const results = JSON.parse(runPhp(code));
  assert.deepEqual(results, [...Array(10).fill(true), false, true]);
});

test('Serverlogs enthalten weder Test-Token noch Klartextpasswort', () => {
  for (const { token } of Object.values(cases)) assert.equal(logs.includes(token), false);
  assert.doesNotMatch(logs, /Aktivierung-Testpasswort-2!|Parallel-Testpasswort-2!/);
});

test('Staging-Push prüft migriertes Cottbus lesend und startet keinen Apply', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'deploy-strato-staging.yml'), 'utf8');
  const postcheck = fs.readFileSync(path.join(projectRoot, 'tools', 'cottbus-current-postcheck-staging.php'), 'utf8');
  assert.match(workflow, /cottbus_zip=.*imports\/gtfs\/latest\.zip/);
  assert.match(workflow, /-f "\$private_root\/cottbus-current-postcheck-staging\.php"/);
  assert.match(postcheck, /COTTBUS_CURRENT_POSTCHECK=OK/);
  assert.match(postcheck, /indexMatchesZip/);
  assert.doesNotMatch(postcheck, /cottbusApply\(|cottbusRun\(|rename\(/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && \(inputs\.preflight_cottbus \|\| inputs\.apply_cottbus\)/);
});
