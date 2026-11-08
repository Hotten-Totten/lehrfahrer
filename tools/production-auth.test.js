const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:/xampp/php/php.exe'].filter(Boolean)
  .find(binary => spawnSync(binary, ['-v']).status === 0);
assert.ok(php);
function configuration(changes) {
  const env = { ...process.env, LEHRFAHRER_ENV:'production', LEHRFAHRER_ACCOUNT_LOGIN_ENABLED:'',
    LEHRFAHRER_PUBLIC_ORIGIN:'', LEHRFAHRER_PASSKEY_RP_ID:'', ...changes };
  const file = JSON.stringify(path.join(root, 'api/_account_configuration.php').replaceAll('\\','/'));
  const result = spawnSync(php, ['-r', `require ${file}; try {echo json_encode(lehrfahrer_account_configuration(),JSON_THROW_ON_ERROR);} catch(Throwable $e) {echo 'REJECTED';}`], { encoding:'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === 'REJECTED' ? null : JSON.parse(result.stdout);
}
test('production login is disabled by default and requires explicit environment', () => {
  assert.equal(configuration({}).enabled, false);
  assert.equal(configuration({LEHRFAHRER_ENV:'',LEHRFAHRER_ACCOUNT_LOGIN_ENABLED:'1'}).enabled, false);
});
test('production configuration binds HTTPS origin and exact RP host', () => {
  assert.deepEqual(configuration({LEHRFAHRER_ACCOUNT_LOGIN_ENABLED:'1',LEHRFAHRER_PUBLIC_ORIGIN:'https://lehrfahrer.example',LEHRFAHRER_PASSKEY_RP_ID:'lehrfahrer.example'}),
    {enabled:true,origin:'https://lehrfahrer.example',rpId:'lehrfahrer.example',name:'Lehrfahrer'});
  for (const [origin,rp] of [['http://lehrfahrer.example','lehrfahrer.example'],['https://staging.lehrfahrer.de','staging.lehrfahrer.de'],
    ['https://lehrfahrer.example','example'],['https://LEHRFAHRER.example','lehrfahrer.example'],['https://lehrfahrer.example:443','lehrfahrer.example'],['https://127.0.0.1','127.0.0.1'],['https://localhost','localhost']]) {
    assert.equal(configuration({LEHRFAHRER_ACCOUNT_LOGIN_ENABLED:'1',LEHRFAHRER_PUBLIC_ORIGIN:origin,LEHRFAHRER_PASSKEY_RP_ID:rp}),null);
  }
});
test('staging configuration preserves its separate RP and ignores production opt-in', () => {
  assert.equal(configuration({LEHRFAHRER_ENV:'staging'}).rpId,'staging.lehrfahrer.de');
});
test('production signed MFA, maintenance recovery and single-use enrollment work in isolation', () => {
  const result=spawnSync(php,[path.join(root,'tools/sysop-mfa.test.php'),'--production'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || result.stdout);
  for (const message of ['production password alone cannot enroll','production enrollment grant is one use',
    'signed assertion creates full session','second credential authenticates','server-side recovery revokes active session',
    'server-side recovery allows controlled re-enrollment','A2 MFA ledger excludes password credential and tokens']) assert.ok(result.stdout.includes(`PASS ${message}`),message);
});
