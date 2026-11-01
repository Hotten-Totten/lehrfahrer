const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const candidates = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean);
const php = candidates.find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt fuer Audit-Paralleltest.');
const auditModule = JSON.stringify(path.resolve(__dirname, '..', 'api', '_audit.php').replaceAll('\\', '/'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-audit-concurrency-'));
const webroot = path.join(base, 'webroot');
fs.mkdirSync(webroot);
const env = { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: base,
  LEHRFAHRER_DB_DRIVER: 'sqlite', LEHRFAHRER_ENV: 'dev' };
const setup = `$_SERVER['DOCUMENT_ROOT']=${JSON.stringify(webroot.replaceAll('\\', '/'))}; require ${auditModule}; $pdo=lehrfahrer_control_database();`;

function run(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(php, ['-r', setup + code], { env });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve(output) : reject(new Error(output)));
  });
}

test('parallele Writer serialisieren ohne verlorene oder doppelte Events', async () => {
  await run('');
  const worker = `$actor=LehrfahrerAuditActor::authorizedCli(); for($i=0;$i<5;$i++) lehrfahrer_audit_append($pdo,$actor,['action'=>'SYSTEM_CHANGE','objectType'=>'SYSTEM','result'=>'SUCCESS']);`;
  await Promise.all(Array.from({ length: 4 }, () => run(worker)));
  const result = await run(`echo json_encode(['count'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(), 'valid'=>lehrfahrer_audit_verify_chain($pdo)]);`);
  assert.deepEqual(JSON.parse(result), { count: 20, valid: true });
});

test.after(() => fs.rmSync(base, { recursive: true, force: true }));
