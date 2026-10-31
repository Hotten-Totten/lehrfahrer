const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const source = fs.readFileSync(path.join(root, 'tools/control-account-cutover-staging.php'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-strato-staging.yml'), 'utf8');
const q = value => JSON.stringify(String(value).replaceAll('\\', '/'));

test('Cutover-Phasen protokollieren START/PASS/FAIL ohne Geheimnisse', () => {
  const code = `putenv('LEHRFAHRER_APP_ROOT=' . ${q(root)});
    require ${q(path.join(root, 'tools/control-account-cutover-staging.php'))};
    lehrfahrer_cutover_start('CUTOVER-15 DRIVER_API_SMOKE','driver API reachable',true);
    lehrfahrer_cutover_fail(new RuntimeException('SECRET_PASSWORD_TOKEN'));
    lehrfahrer_cutover_start('CUTOVER-16 FINAL_STATE_VERIFY','PARALLEL/OPEN');
    lehrfahrer_cutover_pass('CUTOVER-16 FINAL_STATE_VERIFY',['actual'=>'PARALLEL/OPEN']);`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /CUTOVER-15 DRIVER_API_SMOKE: START/);
  assert.match(result.stderr, /CUTOVER-15 DRIVER_API_SMOKE: FAIL/);
  assert.match(result.stderr, /error_class":"RuntimeException"/);
  assert.match(result.stderr, /recovery_required":true/);
  assert.match(result.stderr, /CUTOVER-16 FINAL_STATE_VERIFY: START/);
  assert.match(result.stderr, /CUTOVER-16 FINAL_STATE_VERIFY: PASS/);
  assert.doesNotMatch(result.stderr + result.stdout, /SECRET_PASSWORD_TOKEN/);
});

test('Alle Cutover- und Recovery-Phasen sind eindeutig benannt', () => {
  for (let step = 1; step <= 16; step++) {
    const id = `CUTOVER-${String(step).padStart(2, '0')} `;
    assert.ok(source.includes(id) || workflow.includes(id), id);
  }
  for (let step = 1; step <= 6; step++) {
    assert.ok(source.includes(`RECOVERY-${String(step).padStart(2, '0')} `));
  }
});

test('Diagnose-Dry-Run hat getrennte Lock-/Unlock-Aktionen ohne Moduswechsel', () => {
  assert.match(source, /\$action === 'diagnostic-lock'/);
  assert.match(source, /\$action === 'diagnostic-unlock'/);
  assert.match(source, /if \(!\$dryRun\) lehrfahrer_cutover_revoke_sessions/);
  assert.match(workflow, /diagnose_account_cutover/);
  assert.match(workflow, /cutover diagnostic-lock/);
  assert.match(workflow, /cutover diagnostic-unlock/);
  assert.match(workflow, /test "\$\{\{ inputs\.perform_account_cutover \}\}" != true/);
});
