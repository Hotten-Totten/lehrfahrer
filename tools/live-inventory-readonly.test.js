const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const root=path.resolve(__dirname,'..');
const php=[process.env.PHP_BINARY,'php','C:/xampp/php/php.exe'].filter(Boolean).find(p=>spawnSync(p,['-v']).status===0);
assert.ok(php);
const q=v=>JSON.stringify(v.replaceAll('\\','/'));
function fixture(mode) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'lf-live-readonly-'));
  const web=path.join(base,'public'); const priv=path.join(base,'lehrfahrer-private');
  fs.mkdirSync(web); fs.mkdirSync(priv); fs.writeFileSync(path.join(web,'VERSION'),'V1.2.3\n');
  const marker=path.join(base,'MUTATED'); const config=path.join(priv,'runtime.php');
  const text=`<?php file_put_contents(${q(marker)},'MUTATION');\n// putenv('LEHRFAHRER_ENV=production');\nputenv('LEHRFAHRER_ENV=${mode==='missing-db'?'production':'staging'}');\n`+
    `putenv('LEHRFAHRER_PRIVATE_DATA_DIR=${(mode==='inside-web'?web:priv).replaceAll('\\','/')}');\n`;
  fs.writeFileSync(config,text); fs.writeFileSync(path.join(web,'.user.ini'),`auto_prepend_file="${config.replaceAll('\\','/')}"\n`);
  const before=[fs.readFileSync(config,'utf8'),fs.readFileSync(path.join(web,'.user.ini'),'utf8')];
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('LEHRFAHRER_')));
  const result=spawnSync(php,['-r',`require ${q(path.join(root,'tools/live-inventory-readonly.php'))}; echo json_encode(live_inventory(${q(web)}),JSON_THROW_ON_ERROR);`],{encoding:'utf8',env});
  assert.equal(result.status,0,result.stderr); assert.equal(fs.existsSync(marker),false);
  assert.deepEqual([fs.readFileSync(config,'utf8'),fs.readFileSync(path.join(web,'.user.ini'),'utf8')],before);
  assert.doesNotMatch(result.stdout,/file_put_contents|MUTATION|runtime\.php|[A-Z]:\\|password|SELECT /);
  const report=JSON.parse(result.stdout); assert.equal(report.readOnly,true); assert.equal(report.releaseReady,false);
  return report;
}
test('live inventory never executes runtime PHP or trusts commented production declarations',()=>{
  const report=fixture('staging'); assert.equal(report.version,'V1.2.3');
  assert.ok(report.findings.includes('EXPLICIT_PRODUCTION_ENVIRONMENT_MISSING'));
  assert.equal(report.database,undefined);
});
test('missing production database configuration fails closed without schema creation',()=>{
  const report=fixture('missing-db'); assert.ok(report.findings.includes('DATABASE_CONFIGURATION_UNRESOLVED'));
  assert.equal(report.fullDatabaseAndFilesRestoreVerified,false);
});
test('private storage inside the public root is rejected',()=>{
  assert.ok(fixture('inside-web').findings.includes('PRIVATE_ROOT_UNRESOLVED'));
});
test('read-only workflow skips deployment and pins the previously trusted SSH key',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy-strato-staging.yml'),'utf8');
  assert.match(workflow,/deploy-staging:\s+if: \$\{\{ inputs\.inspect_live_readonly != true \}\}/);
  assert.match(workflow,/StrictHostKeyChecking=yes/);
  assert.match(workflow,/auto_prepend_file= -d auto_append_file=/);
});
