const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');const {before,after,test}=require('node:test');
const root=path.resolve(__dirname,'..');const base=fs.mkdtempSync(path.join(os.tmpdir(),'lf-a8-new-company-'));
const php=[process.env.PHP_BINARY,'php','C:\\xampp\\php\\php.exe'].filter(Boolean).find(p=>spawnSync(p,['-v'],{encoding:'utf8'}).status===0);
if(!php)throw Error('PHP required');
const quote=v=>JSON.stringify(String(v).replaceAll('\\','/'));
let fixture,server,origin;
function env(){return {...process.env,LEHRFAHRER_ENV:'dev',LEHRFAHRER_DB_DRIVER:'sqlite',LEHRFAHRER_PRIVATE_DATA_DIR:path.join(base,'private'),LEHRFAHRER_PUBLIC_ORIGIN:origin||'http://127.0.0.1',LEHRFAHRER_API_TOKEN:'A8-fixture-only',LEHRFAHRER_LEGACY_COMPANY_ID:fixture?.companyA||''};}
function phpRun(code){const r=spawnSync(php,['-r',code],{cwd:root,env:env(),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
function tree(directory){const out={};if(!fs.existsSync(directory))return out;const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else out[path.relative(directory,p)]=require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');}};walk(directory);return out;}
let originalA;
before(async()=>{
 const r=spawnSync(php,[path.join(root,'tools/a8-new-company.test.php'),'--fixture'],{cwd:root,env:{...process.env,LEHRFAHRER_A8_TEST_ROOT:base},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.ok,true);fixture=result.fixture;
 assert.equal(path.resolve(fixture.base),path.resolve(base));originalA=tree(path.join(base,'private','companies',fixture.companyA));
 const port=await new Promise(resolve=>{const listener=net.createServer();listener.listen(0,'127.0.0.1',()=>{const port=listener.address().port;listener.close(()=>resolve(port));});});origin='http://127.0.0.1:'+port;
 server=spawn(php,['-d','extension=zip','-S','127.0.0.1:'+port,'-t',root],{cwd:root,env:env(),stdio:'ignore',windowsHide:true});
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/auth/runtime.php')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
});
after(async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}fs.rmSync(base,{recursive:true,force:true});});
async function request(endpoint,{json,headers={},cookie=fixture.cookieB,method}={}){
 const all={...headers};if(cookie)all.Cookie=cookie;
 if(json!==undefined){all['Content-Type']='application/json';if(!('Origin'in all))all.Origin=origin;if(!('X-CSRF-Token'in all))all['X-CSRF-Token']=fixture.csrfB;}
 const response=await fetch(origin+endpoint,{method:method||(json===undefined?'GET':'POST'),headers:all,body:json===undefined?undefined:JSON.stringify(json)});
 const text=await response.text();return {status:response.status,text,json:()=>JSON.parse(text)};
}

test('A8 echte Neuanlage startet auch ueber die Lese-APIs ohne fremde Fachbestaende',async()=>{
 for(const [url,key]of [['/api/drivers.php','drivers'],['/api/trainings.php','trainings'],['/api/list_driver_packages.php','packages'],['/api/list_lines.php','lines'],['/api/list_cities.php?includeEmpty=1','cities'],['/api/load_catalog.php','stops']]){
  const r=await request(url);assert.equal(r.status,200,r.text);assert.deepEqual(r.json()[key],[],url);assert.doesNotMatch(r.text,/A8_FOREIGN|A8_LEGACY_FOREIGN/);
 }
 const audit=await request('/api/audit_read.php');assert.equal(audit.status,200,audit.text);assert.ok(audit.json().events.every(e=>e.action==='AUTH_LOGIN'));
 for(const [url,key]of [['/api/drivers.php?company_id='+fixture.companyA,'drivers'],['/api/trainings.php?companyId='+fixture.companyA,'trainings'],['/api/list_driver_packages.php?company_id='+fixture.companyA,'packages']]){
  const r=await request(url);assert.equal(r.status,200,r.text);assert.deepEqual(r.json()[key],[]);
 }
});

test('A8 unbekannte Sitzung, Token-Schreibversuch, fehlendes CSRF und fremder Origin werden abgewiesen',async()=>{
 assert.equal((await request('/api/drivers.php',{cookie:null})).status,401);
 assert.equal((await request('/api/drivers.php',{json:{action:'create',firstName:'Invalid'},cookie:null,headers:{'X-Api-Token':'A8-fixture-only'}})).status,401);
 assert.equal((await request('/api/drivers.php',{json:{action:'create',firstName:'Invalid'},headers:{'X-CSRF-Token':''}})).status,403);
 assert.equal((await request('/api/drivers.php',{json:{action:'create',firstName:'Invalid'},headers:{Origin:'https://foreign.invalid'}})).status,403);
 for(const url of ['/api/audit_read.php','/api/platform_audit_read.php'])assert.equal((await request(url,{cookie:null,headers:{'X-Api-Token':'A8-fixture-only'}})).status,401);
 assert.equal((await request('/api/platform_audit_read.php')).status,403);
});

let driver,route,training;
test('A8 eigene erste Fachobjekte erhalten eigene Kennungen; Einweisungszaehler beginnt bei 1',async()=>{
 const d=await request('/api/drivers.php',{json:{action:'create',firstName:'Eigener',lastName:'Test',company_id:fixture.companyA,account_id:'acc_'+'f'.repeat(32),role:'SYSOP'}});
 assert.equal(d.status,200,d.text);driver=d.json().driver;assert.notEqual(driver.id,fixture.driverA);assert.equal(driver.note,'');
 const city=await request('/api/create_city.php',{json:{city:'A8 Eigen'}});assert.equal(city.status,200,city.text);
 route={city:city.json().city,lineName:'A8 Linie',routeName:'Route 001',lineFolder:'A8_Linie',categoryFolder:'Standard',fileBase:'Route_001',stops:[{name:'Start',lat:51.7,lon:14.3}],routePoints:[{lat:51.7,lon:14.3},{lat:51.71,lon:14.31}],remark:''};
 const save=await request('/api/save_line.php',{json:route});assert.equal(save.status,200,save.text);
 const ownRoute={city:route.city,lineFolder:save.json().lineFolder||route.lineFolder,categoryFolder:save.json().categoryFolder||route.categoryFolder,fileBase:save.json().fileBase||route.fileBase};
 const t=await request('/api/trainings.php',{json:{action:'create',driverId:driver.id,routes:[ownRoute]}});assert.equal(t.status,200,t.text);training=t.json().training;
 assert.equal(training.trainingId,'training_000001');assert.equal(training.notes,'');
 const list=await request('/api/trainings.php');assert.equal(list.json().trainings.length,1);assert.equal(list.json().trainings[0].trainingId,'training_000001');
 assert.doesNotMatch(list.text,/A8_FOREIGN|000999/);
});

test('A8 Fremd-IDs und fremde Routen werden auch nach eigenen Anlagen nicht veraendert',async()=>{
 const cases=[['/api/drivers.php',{action:'update',id:fixture.driverA,firstName:'Manipuliert'}],['/api/trainings.php',{action:'updateStatus',trainingId:'training_000999',status:'running'}],['/api/manage_driver_package.php',{action:'delete',id:fixture.packageA}]];
 for(const [url,json]of cases){const r=await request(url,{json});assert.equal(r.status,404,r.text);}
 assert.equal((await request('/api/download_driver_package.php?id='+fixture.packageA)).status,404);
 assert.equal((await request('/api/download_line_json.php?city=a8-foreign-city&line=Foreign')).status,404);
 assert.deepEqual(tree(path.join(base,'private','companies',fixture.companyA)),originalA);
});

test('A8 Audit-Ausfall hinterlaesst keine Fachmutation oder offenen Journale',async()=>{
 const file=path.join(base,'private','companies',fixture.companyB,'drivers','drivers.json');const before=fs.readFileSync(file,'utf8');
 phpRun(`require ${quote(path.join(root,'api/_audit.php'))};lehrfahrer_control_database()->exec("CREATE TRIGGER a8_http_fail BEFORE INSERT ON audit_events WHEN NEW.action='DRIVER_CHANGE' BEGIN SELECT RAISE(ABORT,'A8 simulated outage'); END");`);
 try{const r=await request('/api/drivers.php',{json:{action:'update',id:driver.id,firstName:'Darf nicht bleiben',lastName:'Test'}});assert.equal(r.status,503,r.text);}finally{phpRun(`require ${quote(path.join(root,'api/_audit.php'))};lehrfahrer_control_database()->exec('DROP TRIGGER a8_http_fail');`);}
 assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal((await request('/api/drivers.php')).json().drivers[0].firstName,'Eigener');
 const state=JSON.parse(phpRun(`require ${quote(path.join(root,'api/_audit_file_operation.php'))};$pdo=lehrfahrer_control_database();$q=$pdo->prepare("SELECT company_id,account_id FROM audit_events WHERE action='DRIVER_CREATE' AND company_id=?");$q->execute([${quote(fixture.companyB)}]);$rows=$q->fetchAll(PDO::FETCH_ASSOC);echo json_encode(['chain'=>lehrfahrer_audit_verify_chain($pdo),'journals'=>count(glob(lehrfahrer_tenant_area(${quote(fixture.companyB)},'imports').'/audit-file-operations/*.json')?:[]),'ownActor'=>count($rows)===1&&$rows[0]['account_id']!=='acc_'.str_repeat('f',32)]);`));
 assert.deepEqual(state,{chain:true,journals:0,ownActor:true});
 assert.deepEqual(tree(path.join(base,'private','companies',fixture.companyA)),originalA);
});
