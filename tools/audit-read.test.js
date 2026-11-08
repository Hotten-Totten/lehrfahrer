const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-account-auth-'));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture(action, setup = '') {
  const folder = path.join(sandbox, String(++sequence));
  fs.mkdirSync(folder);
  const code = String.raw`
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(folder)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = ${quote(path.join(folder, 'webroot'))};
require ${quote(path.join(root, 'api', '_audit_read.php'))};
$pdo = lehrfahrer_control_database();
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo);
$roles = new LehrfahrerRoleRepository($pdo);
$companyA = $companies->create(['slug'=>'phase-a','name'=>'A','status'=>'active','license_status'=>'active']);
$companyB = $companies->create(['slug'=>'phase-b','name'=>'B','status'=>'active','license_status'=>'active']);
$userA = $users->create($companyA['id'],['login'=>'alpha','display_name'=>'A','password'=>'test-password-12345']);
$userB = $users->create($companyB['id'],['login'=>'beta','display_name'=>'B','password'=>'test-password-12345']);
$roles->assignRole($companyA['id'],$userA['id'],'ADMIN');
$roles->assignRole($companyB['id'],$userB['id'],'ADMIN');
foreach ([$userA,$userB] as $user) {
  $record = $users->findAuthenticationRecordByLogin($user['company_id'],$user['login_normalized']);
  $accountId = lehrfahrer_control_id('acc'); $membershipId = lehrfahrer_control_id('mem');
  $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')->execute([$accountId,$record['login_normalized'],$record['display_name'],$record['password_hash'],gmdate('c'),gmdate('c')]);
  $pdo->prepare('INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,\'active\',?,?,?)')->execute([$membershipId,$accountId,$record['company_id'],$record['id'],gmdate('c'),gmdate('c')]);
  $roleId = $pdo->query('SELECT role_id FROM user_roles WHERE user_id=' . $pdo->quote($record['id']))->fetchColumn();
  $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$roleId]);
  if ($record['login_normalized']==='alpha') { $accountA=$accountId; $membershipA=$membershipId; }
  else { $accountB=$accountId; $membershipB=$membershipId; }
}

${setup}
${action}
`;
  const result = spawnSync(php, ['-r', code], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /test-password-12345|\$2y\$|password_hash|session_token_hash|csrf_token_hash/);
  return JSON.parse(result.stdout);
}


const seed = String.raw`
$a=lehrfahrer_account_create_session($pdo,$accountA,'TENANT',$membershipA);
$b=lehrfahrer_account_create_session($pdo,$accountB,'TENANT',$membershipB);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$b['token'];
lehrfahrer_audit_append($pdo,LehrfahrerAuditActor::currentAccount($pdo),['action'=>'DRIVER_CREATE','objectType'=>'DRIVER','objectId'=>'drv_'.str_repeat('b',32),'result'=>'SUCCESS']);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$a['token'];
for($i=0;$i<6;$i++) lehrfahrer_audit_append($pdo,LehrfahrerAuditActor::currentAccount($pdo),['action'=>'TRAINING_CREATE','objectType'=>'TRAINING','objectId'=>'training_000005','result'=>'SUCCESS']);
lehrfahrer_audit_append($pdo,LehrfahrerAuditActor::authorizedCli(),['action'=>'SYSTEM_CHANGE','objectType'=>'SYSTEM','result'=>'SUCCESS']);
`;

test('A6 eigene Gesellschaft, sichere Projektion und lueckenlose begrenzte Seiten', () => {
 const data=fixture(String.raw`
$head=$pdo->query('SELECT last_hash FROM audit_chain_state')->fetchColumn();
$one=lehrfahrer_audit_read_page($pdo,['limit'=>'2']);
$two=lehrfahrer_audit_read_page($pdo,['limit'=>'2','before'=>$one['nextBefore']]);
$three=lehrfahrer_audit_read_page($pdo,['limit'=>'2','before'=>$two['nextBefore']]);
$all=lehrfahrer_audit_read_page($pdo,[]);
echo json_encode(['pages'=>[$one,$two,$three],'all'=>$all,'unchanged'=>$head===$pdo->query('SELECT last_hash FROM audit_chain_state')->fetchColumn(),'chain'=>lehrfahrer_audit_verify_chain($pdo)]);`,seed);
 assert.equal(data.all.events.length,6);
 assert.equal(data.chain,true); assert.equal(data.unchanged,true);
 assert.equal(new Set(data.pages.flatMap(p=>p.events.map(e=>e.event_id))).size,6);
 assert.equal(data.pages[2].nextBefore,null);
 for(const row of data.all.events){
   assert.equal(row.action,'TRAINING_CREATE');
   assert.deepEqual(Object.keys(row).sort(),['event_id','occurred_at','account_id','membership_id','action','object_type','object_id','result','reason_code'].sort());
 }
});

test('A6 Filter validieren Datum, Arrays, Injection, Cursor und fremde Mandantenparameter',()=>{
 const data=fixture(String.raw`
$bad=[['companyId'=>$companyB['id']],['company_id'=>$companyB['id']],['accountId'=>$accountB],['action'=>"' OR 1=1 --"],['result'=>'OTHER'],['objectId'=>'../secret'],['before'=>'-1'],['before'=>'99999999999999999999999'],['limit'=>'51'],['limit'=>'0'],['from'=>'2026-02-30'],['from'=>'2026-11-09','to'=>'2026-11-08'],['action'=>['TRAINING_CREATE']]];
$rejected=0;foreach($bad as $input){try{lehrfahrer_audit_read_page($pdo,$input);}catch(InvalidArgumentException $e){$rejected++;}}
$filtered=lehrfahrer_audit_read_page($pdo,['action'=>'TRAINING_CREATE','result'=>'SUCCESS','objectId'=>'training_000005','from'=>gmdate('Y-m-d'),'to'=>gmdate('Y-m-d')]);
$foreign=lehrfahrer_audit_read_page($pdo,['objectId'=>'drv_'.str_repeat('b',32)]);
echo json_encode(['rejected'=>$rejected,'count'=>count($filtered['events']),'foreign'=>$foreign['events']]);`,seed);
 assert.equal(data.rejected,13);assert.equal(data.count,6);assert.deepEqual(data.foreign,[]);
});

test('A6 fehlende, Legacy- und Plattform-Sitzungen sowie entzogene Rechte ablehnen',()=>{
 const data=fixture(String.raw`
$codes=[];
$attempt=static function()use($pdo,&$codes){try{lehrfahrer_audit_read_page($pdo,[]);$codes[]=200;}catch(LehrfahrerAuditReadDenied $e){$codes[]=$e->status;}};
$pdo->prepare('DELETE FROM membership_roles WHERE membership_id=?')->execute([$membershipA]);$attempt();
$_COOKIE=[];$_GET=['apiToken'=>'ignored'];$_SERVER['HTTP_X_API_TOKEN']='ignored';$attempt();
$legacy=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
$_COOKIE[LEHRFAHRER_SESSION_COOKIE]=$legacy['sessionToken'];$attempt();
$_COOKIE=[LEHRFAHRER_ACCOUNT_TEST_COOKIE=>$b['token']];
$platform=lehrfahrer_account_create_session($pdo,$accountB,'PLATFORM',null);
$pdo->prepare("INSERT INTO account_platform_roles(account_id,role_code,assigned_at) VALUES (?,'COSYSOP',?)")->execute([$accountB,gmdate('c')]);
$_COOKIE=[LEHRFAHRER_ACCOUNT_TEST_COOKIE=>$platform['token']];$attempt();
$_COOKIE=[LEHRFAHRER_ACCOUNT_TEST_COOKIE=>$b['token']];
$pdo->prepare("UPDATE account_memberships SET status='inactive' WHERE id=?")->execute([$membershipB]);$attempt();
echo json_encode($codes);`,seed);
 assert.deepEqual(data,[403,401,401,403,401]);
});
const { spawn } = require('node:child_process');
const net = require('node:net');
test('A6 HTTP: Account-Cookie, 401/400/405/503, Cache-Schutz und kein Schreibzugriff', async () => {
  const data = fixture(String.raw`
$legacy=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
echo json_encode(['folder'=>getenv('LEHRFAHRER_PRIVATE_DATA_DIR'),'cookie'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$a['token'],
 'otherCookie'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$b['token'],
 'legacyCookie'=>LEHRFAHRER_SESSION_COOKIE.'='.$legacy['sessionToken'],'foreignEvent'=>$pdo->query("SELECT event_id FROM audit_events WHERE action='DRIVER_CREATE'")->fetchColumn()]);`, seed);
  const port = await new Promise(resolve => { const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));}); });
  const child=spawn(php,['-S',`127.0.0.1:${port}`,'-t',root],{env:{...process.env,LEHRFAHRER_PRIVATE_DATA_DIR:data.folder,LEHRFAHRER_DB_DRIVER:'sqlite',LEHRFAHRER_ENV:'dev'},stdio:'ignore'});
  try {
    const url=`http://127.0.0.1:${port}/api/audit_read.php`;
    let ready=false;
    for(let i=0;i<60;i++){try{await fetch(url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.ok(ready,'HTTP server ready');
    const get=async (query='', options={})=>fetch(url+query,options);
    for(const headers of [{},{'X-Api-Token':'invalid'},{Cookie:data.legacyCookie}]) assert.equal((await get('',{headers})).status,401);
    const headers={Cookie:data.cookie};
    const ok=await get('',{headers});assert.equal(ok.status,200);
    assert.match(ok.headers.get('cache-control'),/no-store/);assert.match(ok.headers.get('vary'),/Cookie/i);
    assert.equal((await ok.json()).events.length,6);
    assert.equal((await get('?companyId=foreign',{headers})).status,400);
    assert.equal((await get('?action[]=TRAINING_CREATE',{headers})).status,400);
    assert.equal((await get('?before='+data.foreignEvent,{headers})).status,400);
    for(const method of ['POST','PUT','PATCH','DELETE','HEAD']) assert.equal((await get('',{headers,method})).status,405);
    const foreign=await (await get('',{headers:{Cookie:data.otherCookie}})).json();
    assert.equal(foreign.events.length,1);assert.equal(foreign.events[0].action,'DRIVER_CREATE');
    // Simulate a ledger outage only inside this isolated temporary database.
    const broken=spawnSync(php,['-r',`putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(data.folder)});putenv('LEHRFAHRER_DB_DRIVER=sqlite');putenv('LEHRFAHRER_ENV=dev');require ${quote(path.join(root,'api','_audit.php'))};lehrfahrer_control_database()->exec('DROP TABLE audit_events');`],{encoding:'utf8'});
    assert.equal(broken.status,0,broken.stderr);
    const failed=await get('',{headers});assert.equal(failed.status,503);
    assert.deepEqual(await failed.json(),{ok:false,error:'Auditprotokoll derzeit nicht verfügbar.'});
  } finally { child.kill();await new Promise(resolve=>child.once('exit',resolve)); }
});
