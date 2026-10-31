const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-legacy-observation-'));
const apiRoot = path.join(projectRoot, 'api');
const token = 'synthetic-legacy-observation-token';
const phpCandidates = [process.env.PHP_BINARY, 'php'];
if (process.platform === 'win32') phpCandidates.push('C:\\xampp\\php\\php.exe');
const php = phpCandidates.find(candidate => candidate && spawnSync(candidate, ['-v']).status === 0);
if (!php) throw new Error('PHP is required for the legacy observation tests.');

after(() => fs.rmSync(privateRoot, { recursive: true, force: true }));

function phpString(value) {
  return JSON.stringify(String(value).replaceAll('\\', '/'));
}

function authCode({ transport = 'HEADER', valid = true, cookie = false, method = 'GET' } = {}) {
  const provided = valid ? token : 'invalid-synthetic-token';
  const credential = transport === 'HEADER'
    ? `$_SERVER['HTTP_X_API_TOKEN']=${phpString(provided)};`
    : method === 'POST'
      ? `$_POST['apiToken']=${phpString(provided)};`
      : `$_GET['apiToken']=${phpString(provided)};`;
  return `
    http_response_code(200);
    $_SERVER['SCRIPT_FILENAME']=${phpString(path.join(apiRoot, 'drivers.php'))};
    $_SERVER['REQUEST_METHOD']=${phpString(method)};
    $_SERVER['REQUEST_URI']='/api/drivers.php?apiToken=QUERY-SENTINEL';
    $_SERVER['REMOTE_ADDR']='203.0.113.54';
    $_SERVER['HTTP_USER_AGENT']='USER-AGENT-SENTINEL';
    $_SERVER['HTTP_REFERER']='https://example.invalid/REFERRER-SENTINEL';
    ${credential}
    ${cookie ? "$_COOKIE['__Host-lehrfahrer_session']='invalid-session';" : ''}
    register_shutdown_function(static function (): void { echo "\\nSTATUS=" . http_response_code(); });
    require ${phpString(path.join(apiRoot, '_api_authorization.php'))};
    lehrfahrer_api_authorize('drivers.read', false, true);
    echo 'AUTH_OK';`;
}

function environment(root = privateRoot) {
  return {
    ...process.env,
    LEHRFAHRER_ENV: 'staging',
    LEHRFAHRER_PRIVATE_DATA_DIR: root,
    LEHRFAHRER_API_TOKEN: token,
  };
}

function invoke(options, root = privateRoot) {
  const result = spawnSync(php, ['-r', authCode(options)], {
    env: environment(root), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function invokeParallel(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(php, ['-r', authCode(options)], { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

function logRows() {
  const directory = path.join(privateRoot, 'legacy-auth-observation');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .flatMap(name => fs.readFileSync(path.join(directory, name), 'utf8').trim().split('\n').filter(Boolean))
    .map(line => JSON.parse(line));
}

test('valid and invalid header/parameter attempts retain only neutral metadata', () => {
  const cases = [
    [{ transport: 'HEADER', valid: true }, 'ACCEPTED', 'HEADER', 200],
    [{ transport: 'HEADER', valid: false }, 'REJECTED', 'HEADER', 403],
    [{ transport: 'REQUEST_PARAMETER', valid: true }, 'ACCEPTED', 'REQUEST_PARAMETER', 200],
    [{ transport: 'REQUEST_PARAMETER', valid: true, method: 'POST' }, 'ACCEPTED', 'REQUEST_PARAMETER', 200],
    [{ transport: 'REQUEST_PARAMETER', valid: false, method: 'POST' }, 'REJECTED', 'REQUEST_PARAMETER', 403],
  ];
  for (const [input, result, transport, status] of cases) {
    assert.match(invoke(input), new RegExp(`STATUS=${status}`));
    const row = logRows().at(-1);
    assert.deepEqual(Object.keys(row), ['at', 'method', 'endpoint', 'transport', 'result']);
    assert.equal(row.method, input.method || 'GET');
    assert.equal(row.endpoint, '/api/drivers.php');
    assert.equal(row.transport, transport);
    assert.equal(row.result, result);
    assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
  const raw = JSON.stringify(logRows());
  for (const secret of [token, crypto.createHash('sha256').update(token).digest('hex'),
    'QUERY-SENTINEL', '203.0.113.54', 'USER-AGENT-SENTINEL', 'REFERRER-SENTINEL']) {
    assert.equal(raw.includes(secret), false, secret);
  }
});

test('anonymous and session-cookie requests do not enter the legacy log path', () => {
  const count = logRows().length;
  const anonymousCode = authCode().replace(`$_SERVER['HTTP_X_API_TOKEN']=${phpString(token)};`, '');
  const anonymous = spawnSync(php, ['-r', anonymousCode], { env: environment(), encoding: 'utf8' });
  assert.equal(anonymous.status, 0, anonymous.stderr);
  assert.match(anonymous.stdout, /STATUS=401/);
  assert.equal(logRows().length, count);

  // The cookie is deliberately invalid: this checks that session precedence
  // never enters observation, even if the session check itself fails.
  const session = spawnSync(php, ['-r', authCode({ cookie: true })], {
    env: environment(), encoding: 'utf8',
  });
  // No test MariaDB is configured; the session branch fails before it can
  // authenticate. Its precedence over the supplied legacy header is observable.
  assert.notEqual(session.status, 0);
  assert.doesNotMatch(session.stdout, /AUTH_OK/);
  assert.equal(logRows().length, count);
});

test('parallel writes keep complete JSON lines', async () => {
  const before = logRows().length;
  const results = await Promise.all(Array.from({ length: 24 }, () => invokeParallel({ valid: true })));
  for (const result of results) assert.match(result, /STATUS=200/);
  assert.equal(logRows().length, before + 24);
});

test('UTC-day cleanup removes old logs and retains current observations', () => {
  const directory = path.join(privateRoot, 'legacy-auth-observation');
  const oldDay = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10);
  const oldFile = path.join(directory, `events-${oldDay}.jsonl`);
  fs.writeFileSync(oldFile, '{"old":true}\n');
  const recentDay = new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10);
  const recentFile = path.join(directory, `events-${recentDay}.jsonl`);
  fs.writeFileSync(recentFile, '{"recent":true}\n');
  fs.writeFileSync(path.join(directory, '.pruned-day'), oldDay);
  const count = logRows().filter(row => row.result === 'ACCEPTED').length;
  assert.match(invoke({ valid: true }), /STATUS=200/);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(recentFile), true);
  assert.equal(logRows().filter(row => row.result === 'ACCEPTED').length, count + 1);
});

test('logging storage failure does not change authentication', () => {
  const forbiddenRoot = path.join(projectRoot, 'api', 'not-a-private-root');
  assert.match(invoke({ valid: true }, forbiddenRoot), /STATUS=200/);
  assert.match(invoke({ valid: false }, forbiddenRoot), /STATUS=403/);
  assert.equal(fs.existsSync(forbiddenRoot), false);
});

test('untrusted method/path input is reduced to fixed neutral labels', () => {
  const before = logRows().length;
  const code = `
    $_SERVER['SCRIPT_FILENAME']='/outside/api/drivers.php?apiToken=PATH-SENTINEL';
    $_SERVER['REQUEST_METHOD']='GET-SECRET-SENTINEL';
    $_SERVER['REQUEST_URI']='/api/drivers.php?apiToken=QUERY-SENTINEL';
    require ${phpString(path.join(apiRoot, '_legacy_auth_observation.php'))};
    lehrfahrer_observe_legacy_auth('HEADER', true);`;
  const result = spawnSync(php, ['-r', code], { env: environment(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const rows = logRows();
  assert.equal(rows.length, before + 1);
  assert.equal(rows.at(-1).endpoint, '/api/unknown');
  assert.equal(rows.at(-1).method, 'OTHER');
  assert.doesNotMatch(JSON.stringify(rows), /PATH-SENTINEL|QUERY-SENTINEL|SECRET-SENTINEL/);
});

test('observation remains inactive outside staging', () => {
  const before = logRows().length;
  const code = `require ${phpString(path.join(apiRoot, '_legacy_auth_observation.php'))};
    lehrfahrer_observe_legacy_auth('HEADER', true);`;
  const result = spawnSync(php, ['-r', code], {
    env: { ...environment(), LEHRFAHRER_ENV: 'production' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(logRows().length, before);
});
