const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  command => command && spawnSync(command, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');

const tool = path.join(root, 'tools', 'control-db-recovery-drill.php');
const liveTool = path.join(root, 'tools', 'control-db-live-recovery.php');

test('Recovery-Drill ist ausserhalb Staging hart blockiert', () => {
  const code = `putenv('LEHRFAHRER_ENV=production');putenv('LEHRFAHRER_RECOVERY_DRILL_RUN=1');require ${JSON.stringify(tool.replaceAll('\\', '/'))};`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nur in Staging erlaubt/);
});

test('Recovery-Drill enthaelt isolierten Restore, Fehlerzustand und Cleanup', () => {
  const source = require('node:fs').readFileSync(tool, 'utf8');
  assert.match(source, /CREATE DATABASE/);
  assert.match(source, /cottbusRestoreControlDbIsolated/);
  assert.match(source, /auth_cutover_lock/);
  assert.match(source, /DROP DATABASE IF EXISTS/);
  assert.match(source, /source_unchanged/);
});

test('isolierter Drill setzt auch bei fehlender Lock-Zeile den Lock ueber das Auth-Gate', () => {
  const source = require('node:fs').readFileSync(tool, 'utf8');
  assert.match(source, /lehrfahrer_auth_cutover_set_lock\(\$testPdo, 'LOCKED'\)/);
  assert.doesNotMatch(source, /UPDATE control_metadata SET value = \?, updated_at = \? WHERE `key` = \?/);
});

test('Live-Recovery ist ohne Staging-Kontext gesperrt', () => {
  const code = `putenv('LEHRFAHRER_ENV=production');putenv('LEHRFAHRER_APP_ROOT=${root.replaceAll('\\', '/')}');putenv('LEHRFAHRER_RECOVERY_RUN=1');require ${JSON.stringify(liveTool.replaceAll('\\', '/'))};`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ausschliesslich auf Staging/);
});

test('Live-Recovery verlangt einen gebundenen Marker und gibt nur PARALLEL frei', () => {
  const source = require('node:fs').readFileSync(liveTool, 'utf8');
  assert.match(source, /lehrfahrer_live_recovery_marker\(\$marker, \$run, \$point\)/);
  assert.match(source, /\$state !== \['mode' => 'PARALLEL', 'lock' => 'LOCKED'\]/);
  assert.match(source, /lehrfahrer_auth_cutover_set_lock\(\$pdo, 'OPEN'\)/);
});
