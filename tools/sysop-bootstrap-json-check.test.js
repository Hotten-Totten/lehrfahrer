const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const checker = path.join(__dirname, 'control-sysop-bootstrap-json-check.php');

function check(action, input) {
  const result = spawnSync(php, ['-q', '-f', checker], {
    env: { ...process.env, LEHRFAHRER_SYSOP_JSON_EXPECT: action,
      LEHRFAHRER_SYSOP_JSON_RESPONSE: typeof input === 'string' ? input : JSON.stringify(input) },
    encoding: 'utf8',
  });
  assert.equal(result.stdout, '');
  return result.status;
}

const preflight = { ok: true, targetNumber: 102, sysopAssignments: 0,
  company: 'cottbusverkehr', auth: { mode: 'ACCOUNT_PRIMARY', lock: 'OPEN' } };
const apply = { ok: true, userNumber: 1, retiredNumber: 102,
  platformCapabilities: 9, revokedSessions: 2 };
const verify = { ok: true, userNumber: 1, retiredNumber: 102,
  platformCapabilities: 9, auth: { mode: 'ACCOUNT_PRIMARY', lock: 'OPEN' } };

for (const [action, valid, missing] of [
  ['preflight', preflight, 'sysopAssignments'],
  ['apply', apply, 'revokedSessions'],
  ['verify', verify, 'auth'],
]) {
  test(action + ': erwartete Antwort besteht; ungueltiges JSON und fehlende oder falsche Felder scheitern', () => {
    assert.equal(check(action, valid), 0);
    assert.notEqual(check(action, '{invalid'), 0);
    const incomplete = { ...valid };
    delete incomplete[missing];
    assert.notEqual(check(action, incomplete), 0);
    assert.notEqual(check(action, { ...valid, ok: 'true' }), 0);
  });
}

test('unbekannte Pruefaktion scheitert geschlossen', () => {
  assert.notEqual(check('unknown', verify), 0);
});
