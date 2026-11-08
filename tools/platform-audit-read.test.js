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
require ${quote(path.join(root, 'api', '_platform_audit_read.php'))};
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


const platformSeed=seed+String.raw`
$pdo->prepare("INSERT INTO account_platform_roles(account_id,role_code,assigned_at) VALUES (?,'COSYSOP',?)")->execute([$accountA,gmdate('c')]);
$p=lehrfahrer_account_create_session($pdo,$accountA,'PLATFORM',null);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$p['token'];
lehrfahrer_audit_append($pdo,LehrfahrerAuditActor::currentAccount($pdo),['action'=>'AUTH_PASSKEY_REGISTER','objectType'=>'PASSKEY','objectId'=>'pk_'.str_repeat('c',32),'result'=>'SUCCESS']);
lehrfahrer_audit_append($pdo,LehrfahrerAuditActor::knownAccount($pdo,$accountB),['action'=>'AUTH_LOGIN','result'=>'DENIED','reasonCode'=>'INVALID_CREDENTIALS']);
`;

test('A7 globale bereinigte Sicht aus explizit autorisiertem Plattformkontext',()=>{
 const d=fixture(String.raw`
$before=$pdo->query('SELECT last_hash FROM audit_chain_state')->fetchColumn();
$page=lehrfahrer_platform_audit_page($pdo,[]);
echo json_encode(['page'=>$page,'chain'=>lehrfahrer_audit_verify_chain($pdo),'unchanged'=>$before===$pdo->query('SELECT last_hash FROM audit_chain_state')->fetchColumn(),
 'companyA'=>$companyA['id'],'companyB'=>$companyB['id']]);`,platformSeed);
 assert.equal(d.chain,true);assert.equal(d.unchanged,true);assert.equal(d.page.accessContext,'PLATFORM');
 assert.equal(d.page.events.length,10);
 assert.deepEqual(new Set(d.page.events.map(e=>e.context_type)),new Set(['PREAUTH','PLATFORM','TENANT','SYSTEM']));
 for(const row of d.page.events) assert.deepEqual(Object.keys(row).sort(),['event_id','occurred_at','context_type','company_id','action','object_type','result','reason_code'].sort());
 assert.ok(d.page.events.some(e=>e.company_id===d.companyA));assert.ok(d.page.events.some(e=>e.company_id===d.companyB));
 assert.doesNotMatch(JSON.stringify(d.page),/acc_[a-f0-9]{32}|mem_[a-f0-9]{32}|pk_[a-f0-9]{32}|training_000005|role_snapshot|previous_hash|event_hash|capability_snapshot/);
});

test('A7 Firmenfilter, Kontexte, Datum und lueckenlose Seiten beachten Filtergrenzen',()=>{
 const d=fixture(String.raw`
$ids=[];$cursor=null;do{$in=['limit'=>'2'];if($cursor!==null)$in['before']=$cursor;$page=lehrfahrer_platform_audit_page($pdo,$in);foreach($page['events']as $e)$ids[]=$e['event_id'];$cursor=$page['nextBefore'];}while($cursor!==null);
$aPage=lehrfahrer_platform_audit_page($pdo,['companyId'=>$companyA['id'],'context'=>'TENANT','from'=>gmdate('Y-m-d'),'to'=>gmdate('Y-m-d'),'action'=>'TRAINING_CREATE','result'=>'SUCCESS','limit'=>'2']);
$bPage=lehrfahrer_platform_audit_page($pdo,['companyId'=>$companyB['id']]);
$badCursor=false;try{lehrfahrer_platform_audit_page($pdo,['companyId'=>$companyB['id'],'before'=>$aPage['nextBefore']]);}catch(InvalidArgumentException $e){$badCursor=true;}
$rejected=0;foreach([['accountId'=>$accountA],['objectId'=>'pk_'.str_repeat('c',32)],['companyId'=>['x']],['companyId'=>"' OR 1=1"],['context'=>'PLATFORM_COMPANY'],['context'=>['SYSTEM']],['limit'=>'51'],['before'=>'1'],['from'=>'2026-02-30'],['role'=>'SYSOP']]as $in){try{lehrfahrer_platform_audit_page($pdo,$in);}catch(InvalidArgumentException $e){$rejected++;}}
echo json_encode(['ids'=>$ids,'a'=>$aPage,'b'=>$bPage,'badCursor'=>$badCursor,'rejected'=>$rejected,'companyA'=>$companyA['id']]);`,platformSeed);
 assert.equal(d.ids.length,10);assert.equal(new Set(d.ids).size,10);assert.equal(d.a.events.length,2);
 assert.ok(d.a.events.every(e=>e.company_id===d.companyA && e.context_type==='TENANT'));assert.equal(d.b.events.length,1);
 assert.equal(d.badCursor,true);assert.equal(d.rejected,10);
});

test('A7 Firmenrechte, Nummern und manipulierte Parameter erzeugen keine Plattformrechte',()=>{
 const d=fixture(String.raw`
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$b['token'];$_GET=['platformRoles'=>['SYSOP'],'accountId'=>$accountA,'companyId'=>$companyA['id']];
$denied=0;try{lehrfahrer_platform_audit_page($pdo,[]);}catch(LehrfahrerAuditReadDenied $e){$denied=$e->status;}
$own=lehrfahrer_audit_read_page($pdo,[]);
echo json_encode(['denied'=>$denied,'ownCount'=>count($own['events'])]);`,platformSeed);
 assert.deepEqual(d,{denied:403,ownCount:1});
});

test('A7 Plattformrecht in validierter Firmensitzung erhaelt gewaehlten Mandanten und A6-Grenze',()=>{
 const d=fixture(String.raw`
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$a['token'];
$page=lehrfahrer_platform_audit_page($pdo,[]);$own=lehrfahrer_audit_read_page($pdo,[]);
$session=lehrfahrer_account_current_session($pdo,false);
echo json_encode(['global'=>count($page['events']),'own'=>count($own['events']),'context'=>$session['context_type'],'sameMembership'=>$session['membership_id']===$membershipA]);`,platformSeed);
 assert.deepEqual(d,{global:10,own:6,context:'TENANT',sameMembership:true});
});

test('A7 Rechteentzug, Pending, Widerruf und deaktivierte Accounts greifen bei jedem Abruf',()=>{
 const d=fixture(String.raw`
$codes=[];$attempt=static function()use($pdo,&$codes){try{lehrfahrer_platform_audit_page($pdo,[]);$codes[]=200;}catch(LehrfahrerAuditReadDenied $e){$codes[]=$e->status;}};
$pending=lehrfahrer_account_create_session($pdo,$accountA,'PENDING',null);$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$pending['token'];$attempt();
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$p['token'];
$pdo->exec("DELETE FROM platform_role_capabilities WHERE role_id='prole_cosysop' AND capability_id IN (SELECT id FROM platform_capabilities WHERE code='platform.audit.read')");$attempt();
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$a['token'];$attempt();
$pdo->prepare('UPDATE accounts SET active=0 WHERE id=?')->execute([$accountA]);$attempt();
$pdo->prepare('UPDATE accounts SET active=1 WHERE id=?')->execute([$accountA]);
$pdo->prepare('UPDATE account_sessions SET revoked_at=? WHERE session_token_hash=?')->execute([gmdate('c'),lehrfahrer_auth_token_hash($p['token'])]);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$p['token'];$attempt();
echo json_encode($codes);`,platformSeed);
 assert.deepEqual(d,[403,403,403,401,401]);
});

test('A7 echte SysOp-Zuweisung und bestehende MFA-Pruefung werden ausgewertet',()=>{
 const d=fixture(String.raw`
putenv('LEHRFAHRER_ENV=staging');
$pdo->prepare('INSERT INTO sysop_assignment(singleton_key,account_id,assigned_at) VALUES(1,?,?)')->execute([$accountB,gmdate('c')]);
$pdo->prepare("INSERT INTO account_passkeys(id,account_id,credential_id,public_key,rp_id,status,created_at) VALUES(?,?,?,?,?,'active',?)")
 ->execute(['pk_'.str_repeat('d',32),$accountB,'fixture-credential','fixture-public-key',LEHRFAHRER_SYSOP_MFA_RP_ID,gmdate('c')]);
$noMfa=lehrfahrer_account_create_session($pdo,$accountB,'TENANT',$membershipB);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$noMfa['token'];
$denied=0;try{lehrfahrer_platform_audit_page($pdo,[]);}catch(LehrfahrerAuditReadDenied $e){$denied=$e->status;}
$verified=lehrfahrer_account_create_session($pdo,$accountB,'TENANT',$membershipB,null,true);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$verified['token'];
$page=lehrfahrer_platform_audit_page($pdo,[]);
echo json_encode(['denied'=>$denied,'access'=>$page['accessContext'],'count'=>count($page['events'])]);`,seed);
 assert.deepEqual(d,{denied:401,access:'PLATFORM',count:8});
});

const {spawn}=require('node:child_process');
const net=require('node:net');
test('A7 HTTP: Plattformrolle, Legacy-/Tokenabwehr, Reduktion, Cursor, Methoden und Ausfall',async()=>{
 const d=fixture(String.raw`
$legacy=lehrfahrer_auth_create_session($pdo,$userB,$companyB);
echo json_encode(['folder'=>getenv('LEHRFAHRER_PRIVATE_DATA_DIR'),'platform'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$p['token'],
 'tenantOperator'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$a['token'],'admin'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$b['token'],
 'legacy'=>LEHRFAHRER_SESSION_COOKIE.'='.$legacy['sessionToken'],'company'=>$companyA['id']]);`,platformSeed);
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const child=spawn(php,['-S',`127.0.0.1:${port}`,'-t',root],{env:{...process.env,LEHRFAHRER_PRIVATE_DATA_DIR:d.folder,LEHRFAHRER_DB_DRIVER:'sqlite',LEHRFAHRER_ENV:'dev'},stdio:'ignore'});
 try{
  const url=`http://127.0.0.1:${port}/api/platform_audit_read.php`;
  let ready=false;for(let i=0;i<60;i++){try{await fetch(url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready);
  for(const headers of [{},{'X-Api-Token':'ignored'},{Cookie:d.legacy}])assert.equal((await fetch(url,{headers})).status,401);
  assert.equal((await fetch(url,{headers:{Cookie:d.admin}})).status,403);
  const headers={Cookie:d.platform};
  const first=await fetch(url+'?limit=2',{headers});assert.equal(first.status,200);assert.match(first.headers.get('cache-control'),/no-store/);assert.match(first.headers.get('vary'),/Cookie/i);
  const page=await first.json();assert.equal(page.events.length,2);assert.equal(page.accessContext,'PLATFORM');
  const next=await (await fetch(url+'?limit=2&before='+page.nextBefore,{headers})).json();
  assert.equal(next.events.length,2);assert.ok(next.events.every(e=>page.events.every(old=>old.event_id!==e.event_id)));
  const own=await (await fetch(url+'?companyId='+d.company,{headers:{Cookie:d.tenantOperator}})).json();assert.equal(own.events.length,6);
  assert.equal((await fetch(url+'?objectId=training_000005',{headers})).status,400);
  assert.equal((await fetch(url+'?companyId[]=foreign',{headers})).status,400);
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD'])assert.equal((await fetch(url,{headers,method})).status,405);
  const tenantApi=await fetch(`http://127.0.0.1:${port}/api/audit_read.php`,{headers});assert.equal(tenantApi.status,403);
  const broken=spawnSync(php,['-r',`putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(d.folder)});putenv('LEHRFAHRER_DB_DRIVER=sqlite');putenv('LEHRFAHRER_ENV=dev');require ${quote(path.join(root,'api','_audit.php'))};lehrfahrer_control_database()->exec('DROP TABLE audit_events');`],{encoding:'utf8'});assert.equal(broken.status,0,broken.stderr);
  const failed=await fetch(url,{headers});assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ok:false,error:'Plattformprotokoll derzeit nicht verfügbar.'});
 }finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));}
});
