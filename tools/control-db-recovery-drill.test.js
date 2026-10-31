const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].find(
  command => command && spawnSync(command, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');

const tool = path.join(root, 'tools', 'control-db-recovery-drill.php');

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
