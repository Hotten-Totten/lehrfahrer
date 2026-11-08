const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { before, after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-phase4c-'));
const webroot = path.join(sandbox, 'webroot');
const privateRoot = path.join(sandbox, 'private');
const password = 'Phase4C-Testpasswort!';
let php; let server; let origin; let companyA; let companyB; let sessionA; let sessionB;
const phpString = value => JSON.stringify(String(value).replaceAll('\\', '/'));
const env = () => ({ ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot,
  LEHRFAHRER_DB_DRIVER: 'sqlite', LEHRFAHRER_ENV: 'dev', LEHRFAHRER_PUBLIC_ORIGIN: origin,
  LEHRFAHRER_API_TOKEN: 'phase4c-token', LEHRFAHRER_LEGACY_COMPANY_ID: companyA?.id || '' });
function runPhp(code) {
  const result = spawnSync(php, ['-r', code], { cwd: root, env: env(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const value = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(value));
    });
  });
}
async function request(url, options = {}, session = sessionA) {
  const headers = { ...(options.headers || {}) };
  if (session) headers.Cookie = session.cookie;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers.Origin = origin;
    headers['X-CSRF-Token'] = session?.csrf || '';
  }
  const response = await fetch(origin + url, { method: options.json === undefined ? 'GET' : 'POST',
    headers, body: options.json === undefined ? undefined : JSON.stringify(options.json) });
  const body = await response.text();
  return { status: response.status, body, json: () => JSON.parse(body), headers: response.headers };
}
async function login(slug) {
  const response = await request('/api/auth/login.php',
    { json: { company: slug, login: 'admin', password } }, null);
  assert.equal(response.status, 200, response.body);
  return { cookie: (response.headers?.get?.('set-cookie') || '').split(';', 1)[0],
    csrf: response.json().csrfToken };
}

before(async () => {
  const candidates = [process.env.PHP_BINARY, 'php'];
  if (process.platform === 'win32') candidates.push('C:\\xampp\\php\\php.exe');
  php = candidates.find(candidate => {
    if (!candidate) return false;
    const check = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    return !check.error && check.status === 0;
  });
  if (!php) throw new Error('PHP fehlt.');
  fs.mkdirSync(webroot);
  fs.cpSync(path.join(root, 'api'), path.join(webroot, 'api'), { recursive: true });
  origin = 'http://127.0.0.1:' + await freePort();
  const seed = `
    require ${phpString(path.join(root, 'api', '_account_auth.php'))};
    $pdo=lehrfahrer_control_database();
    $companies=new LehrfahrerCompanyRepository($pdo);
    $users=new LehrfahrerUserRepository($pdo);
    $roles=new LehrfahrerRoleRepository($pdo);
    $result=[];
    $accountSessions=[];
    foreach (['firma-a','firma-b'] as $slug) {
      $company=$companies->create(['slug'=>$slug,'name'=>$slug,'status'=>'active','license_status'=>'active']);
      $user=$users->create($company['id'],['login'=>'admin','display_name'=>'Admin','password'=>${phpString(password)}]);
      $roles->assignRole($company['id'],$user['id'],'ADMIN');
      $record=$users->findAuthenticationRecordByLogin($company['id'],'admin');
      $accountId=lehrfahrer_control_id('acc'); $membershipId=lehrfahrer_control_id('mem');
      $login=$slug.'-admin'; $now=gmdate('c');
      $pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)')
        ->execute([$accountId,$login,'Admin',$record['password_hash'],$now,$now]);
      $pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,legacy_user_id,created_at,updated_at) VALUES (?,?,?,'active',?,?,?)")
        ->execute([$membershipId,$accountId,$company['id'],$user['id'],$now,$now]);
      $roleId=$pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
      $pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$roleId]);
      $created=lehrfahrer_account_login($pdo,$login,${phpString(password)});
      $accountSessions[]=['cookie'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$created['token'],'csrf'=>$created['csrf']];
      $result[]=$company;
    }
    echo json_encode(['companies'=>$result,'accountSessions'=>$accountSessions]);
  `;
  const seeded = JSON.parse(runPhp(seed));
  [companyA, companyB] = seeded.companies;
  [sessionA, sessionB] = seeded.accountSessions;
  const legacyDrivers = path.join(privateRoot, 'personnel', 'drivers.json');
  fs.mkdirSync(path.dirname(legacyDrivers), { recursive: true });
  fs.writeFileSync(legacyDrivers, '[{"id":"drv_legacy","firstName":"Legacy"}]');
  for (const [company, city, line] of [[companyA, 'stadt-a', 'Route_A'], [companyB, 'stadt-b', 'Route_B']]) {
    const routeDir = path.join(privateRoot, 'companies', company.id, 'lines', city, 'Linie_1', 'Standard');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.mkdirSync(path.join(privateRoot, 'companies', company.id, 'cities', city), { recursive: true });
    fs.writeFileSync(path.join(routeDir, line + '.json'), JSON.stringify({ lineName: line, routeName: 'Route 001', stops: [] }));
  }
  const zipArgs = spawnSync(php, ['-r', 'echo class_exists("ZipArchive") ? "1" : "0";'],
    {encoding:'utf8'}).stdout === '1' ? [] : ['-d', 'extension=zip'];
  server = spawn(php, [...zipArgs, '-S', origin.replace('http://', ''), '-t', webroot],
    { cwd: webroot, env: env(), stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin + '/api/auth/runtime.php')).status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }

});
after(() => { if (server) server.kill(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('Fahrer A/B getrennt; Fremd-ID kann nicht geaendert oder geloescht werden', async () => {
  const create = async (session, name) => request('/api/drivers.php',
    { json: { action: 'create', firstName: name, lastName: 'Test' } }, session);
  const a = await create(sessionA, 'Anna'); const b = await create(sessionB, 'Berta');
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  const idA = a.json().driver.id; const idB = b.json().driver.id;
  assert.deepEqual((await request('/api/drivers.php')).json().drivers.map(driver => driver.id), [idA]);
  assert.deepEqual((await request('/api/drivers.php', {}, sessionB)).json().drivers.map(driver => driver.id), [idB]);
  assert.deepEqual((await request('/api/drivers.php?company_id=' + companyB.id)).json().drivers.map(driver => driver.id), [idA]);
  assert.equal(fs.readFileSync(path.join(privateRoot, 'personnel', 'drivers.json'), 'utf8'),
    '[{"id":"drv_legacy","firstName":"Legacy"}]');
  for (const action of ['update', 'toggle', 'delete']) {
    const result = await request('/api/drivers.php', { json: { action, id: idB, firstName: 'X' } });
    assert.equal(result.status, 404, result.body);
  }
  const ownUpdate = await request('/api/drivers.php', { json: {
    action: 'update', id: idA, firstName: 'Anna Neu', lastName: 'Test'
  } });
  assert.equal(ownUpdate.status, 200, ownUpdate.body);
  const ownToggle = await request('/api/drivers.php', { json: { action: 'toggle', id: idA } });
  assert.equal(ownToggle.status, 200, ownToggle.body);
  globalThis.driverA = idA; globalThis.driverB = idB;
});

test('Einweisungen validieren Fahrer und Route im selben Tenant', async () => {
  const routeA = { city: 'stadt-a', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_A' };
  const routeB = { city: 'stadt-b', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_B' };
  const create = (session, driverId, route) => request('/api/trainings.php',
    { json: { action: 'create', driverId, routes: [route] } }, session);
  assert.equal((await create(sessionA, globalThis.driverB, routeA)).status, 404);
  assert.equal((await create(sessionA, globalThis.driverA, routeB)).status, 404);
  const a = await create(sessionA, globalThis.driverA, routeA);
  const bFirst = await create(sessionB, globalThis.driverB, routeB);
  const b = await create(sessionB, globalThis.driverB, routeB);
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  assert.equal(bFirst.status, 200, bFirst.body);
  assert.ok(a.body.startsWith('{'), a.body);
  assert.ok(b.body.startsWith('{'), b.body);
  const listA = await request('/api/trainings.php');
  const listB = await request('/api/trainings.php', {}, sessionB);
  assert.equal(listA.status, 200, listA.body);
  assert.equal(listB.status, 200, listB.body);
  assert.ok(listA.body.startsWith('{'), listA.body);
  assert.ok(listB.body.startsWith('{'), listB.body);
  assert.equal(listA.json().trainings.length, 1, listA.body);
  assert.equal(listB.json().trainings.length, 2, listB.body);
  globalThis.trainingA = a.json().training.trainingId;
  globalThis.trainingB = b.json().training.trainingId;
  for (const action of ['updateStatus', 'completeRoute']) {
    const result = await request('/api/trainings.php', { json: {
      action, trainingId: globalThis.trainingB, status: 'running', routeIndex: 0
    } });
    assert.equal(result.status, 404, result.body);
  }
  const own = await request('/api/trainings.php', { json: {
    action: 'completeRoute', trainingId: globalThis.trainingA, routeIndex: 0
  } });
  assert.equal(own.status, 200, own.body);
});

test('Pakete und PDFs bleiben pro Tenant; Fremd-Referenzen und Downloads scheitern', async () => {
  const itemA = { city: 'stadt-a', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_A' };
  const itemB = { city: 'stadt-b', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_B' };
  const create = (session, driverId, trainingId, item) => request('/api/create_driver_documents.php',
    { json: { driverId, trainingId, driverName: 'Test', items: [item] } }, session);
  assert.equal((await create(sessionA, globalThis.driverA, globalThis.trainingB, itemA)).status, 404);
  assert.equal((await create(sessionA, globalThis.driverA, globalThis.trainingA, itemB)).status, 404);
  const a = await create(sessionA, globalThis.driverA, globalThis.trainingA, itemA);
  const b = await create(sessionB, globalThis.driverB, globalThis.trainingB, itemB);
  assert.equal(a.status, 200, a.body); assert.equal(b.status, 200, b.body);
  const packageA = a.json().package; const packageB = b.json().package;
  assert.equal((await request('/api/list_driver_packages.php')).json().packages.length, 1);
  assert.equal((await request('/api/list_driver_packages.php', {}, sessionB)).json().packages.length, 1);
  const pdf = await request('/api/download_driver_package.php?id=' + packageA.id + '&document=' + packageA.documents[0].file);
  assert.equal(pdf.status, 200, pdf.body); assert.match(pdf.body, /^%PDF/);
  const zip = await request('/api/download_driver_package.php?id=' + packageA.id);
  assert.ok([200, 501].includes(zip.status), zip.body);
  const pdfB = await request('/api/download_driver_package.php?id=' + packageB.id + '&document=' + packageB.documents[0].file, {}, sessionB);
  assert.equal(pdfB.status, 200, pdfB.body);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageB.id)).status, 404);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageA.id + '&document=..%2Fsecret.pdf')).status, 404);
  assert.equal((await request('/api/manage_driver_package.php', { json: { action: 'delete', id: packageB.id } })).status, 404);
  assert.equal((await request('/api/manage_driver_package.php', { json: { action: 'rename', id: packageB.id, driverName: 'X' } })).status, 404);
  assert.equal((await request('/api/create_driver_documents.php', { json: {
    mode: 'update', packageId: packageB.id, driverId: globalThis.driverA, items: [itemA]
  } })).status, 404);
  const legacy = await request('/api/list_driver_packages.php', { headers: { 'X-Api-Token': 'phase4c-token' } }, null);
  assert.equal(legacy.status, 200, legacy.body);
  assert.equal(legacy.json().packages.length, 1);
  for (const area of ['drivers', 'trainings', 'packages', 'documents']) {
    const location = path.join(privateRoot, 'companies', companyA.id, area);
    assert.ok(fs.existsSync(location));
    assert.equal((await request('/private/companies/' + companyA.id + '/' + area + '/')).status, 404);
  }
  const rename = await request('/api/manage_driver_package.php', { json: {
    action: 'rename', id: packageA.id, driverName: 'Anna Test'
  } });
  assert.equal(rename.status, 200, rename.body);
  const remove = await request('/api/manage_driver_package.php', { json: { action: 'delete', id: packageA.id } });
  assert.equal(remove.status, 200, remove.body);
  assert.equal((await request('/api/download_driver_package.php?id=' + packageA.id)).status, 404);
});

function auditState() {
  return JSON.parse(runPhp('require ' + phpString(path.join(root, 'api/_audit.php')) +
    ';$pdo=lehrfahrer_control_database();echo json_encode(["chain"=>lehrfahrer_audit_verify_chain($pdo),' +
    '"events"=>$pdo->query("SELECT action,object_type,object_id,company_id,account_id,membership_id,context_type,capability_snapshot,result FROM audit_events WHERE object_type IN (\'DRIVER\',\'TRAINING\',\'PACKAGE\',\'SETTING\') ORDER BY sequence_number")->fetchAll(PDO::FETCH_ASSOC)]);'));
}
function sql(sqlText) {
  runPhp('require ' + phpString(path.join(root, 'api/_control_database.php')) +
    ';lehrfahrer_control_database()->exec(' + phpString(sqlText) + ');');
}
function snapshot() {
  const result = {};
  for (const company of [companyA, companyB]) for (const area of ['drivers','trainings','packages','documents','settings']) {
    const base = path.join(privateRoot, 'companies', company.id, area);
    const walk = dir => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else result[path.relative(privateRoot, file)] = require('node:crypto').createHash('sha256')
          .update(fs.readFileSync(file)).digest('hex');
      }
    };
    walk(base);
  }
  return result;
}
const itemA5 = { city: 'stadt-a', lineFolder: 'Linie_1', categoryFolder: 'Standard', fileBase: 'Route_A' };

test('A5 protokolliert Account, Tenant und technische Ziele ohne Personendaten', () => {
  const state = auditState();
  assert.equal(state.chain, true);
  for (const type of ['DRIVER','TRAINING','PACKAGE']) assert.ok(state.events.some(e => e.object_type === type));
  for (const event of state.events) {
    assert.ok([companyA.id, companyB.id].includes(event.company_id));
    assert.match(event.account_id, /^acc_[a-f0-9]{32}$/);
    assert.match(event.membership_id, /^mem_[a-f0-9]{32}$/);
    assert.equal(event.context_type, 'TENANT');
    assert.equal(event.result, 'SUCCESS');
    assert.match(event.object_id, /^(driver|training|package|setting)_[a-f0-9]{32}$/);
  }
  const serialized = JSON.stringify(state.events);
  assert.ok(!serialized.includes('Anna') && !serialized.includes('Berta') && !serialized.includes('stadt-a'));
});

test('A5 unveraenderte Fahrer, Routenerledigung und Einstellungen schreiben kein Ereignis', async () => {
  const before = auditState().events.length;
  const same = await request('/api/drivers.php', { json: { action:'update', id:globalThis.driverA,
    firstName:'Anna Neu', lastName:'Test', active:false } });
  assert.equal(same.status, 200, same.body);
  const route = await request('/api/trainings.php', { json: { action:'completeRoute',
    trainingId:globalThis.trainingA, routeIndex:0 } });
  assert.equal(route.status, 200, route.body);
  assert.equal(auditState().events.length, before);
  const change = await request('/api/city_settings.php', { json:{ city:'stadt-a', dispatchPhone:'0355 123456' } });
  assert.equal(change.status, 200, change.body);
  const once = auditState().events.length;
  assert.equal(once, before + 1);
  assert.equal((await request('/api/city_settings.php', { json:{city:'stadt-a',dispatchPhone:'0355 123456'} })).status, 200);
  assert.equal(auditState().events.length, once);
  assert.equal(auditState().events.at(-1).action, 'SETTING_CHANGE');
});

test('A5 Audit-Ausfaelle lassen Fahrer, Einweisung, Paketsatz und Einstellungen unveraendert', async () => {
  const training = await request('/api/trainings.php', { json: { action:'create',
    driverId:globalThis.driverA, routes:[itemA5] } });
  assert.equal(training.status, 200, training.body);
  globalThis.a5Training = training.json().training.trainingId;
  const pack = await request('/api/create_driver_documents.php', { json:{
    driverId:globalThis.driverA, trainingId:globalThis.a5Training, driverName:'Audit Original', items:[itemA5] } });
  assert.equal(pack.status, 200, pack.body);
  globalThis.a5Package = pack.json().package;
  const cases = [
    ['DRIVER_CREATE','/api/drivers.php',{action:'create',firstName:'Nicht speichern'}],
    ['DRIVER_CHANGE','/api/drivers.php',{action:'update',id:globalThis.driverA,firstName:'Nicht speichern'}],
    ['DRIVER_STATUS_CHANGE','/api/drivers.php',{action:'toggle',id:globalThis.driverA}],
    ['DRIVER_DELETE','/api/drivers.php',{action:'delete',id:globalThis.driverA}],
    ['TRAINING_CREATE','/api/trainings.php',{action:'create',driverId:globalThis.driverA,routes:[itemA5]}],
    ['TRAINING_STATUS_CHANGE','/api/trainings.php',{action:'updateStatus',trainingId:globalThis.a5Training,status:'running'}],
    ['TRAINING_ROUTE_COMPLETE','/api/trainings.php',{action:'completeRoute',trainingId:globalThis.a5Training,routeIndex:0}],
    ['PACKAGE_CREATE','/api/create_driver_documents.php',{driverId:globalThis.driverA,items:[itemA5]}],
    ['PACKAGE_CHANGE','/api/create_driver_documents.php',{mode:'update',packageId:globalThis.a5Package.id,
      driverId:globalThis.driverA,trainingId:globalThis.a5Training,driverName:'Nicht speichern',items:[itemA5]}],
    ['PACKAGE_CHANGE','/api/manage_driver_package.php',{action:'rename',id:globalThis.a5Package.id,driverName:'Nicht speichern'}],
    ['PACKAGE_DELETE','/api/manage_driver_package.php',{action:'delete',id:globalThis.a5Package.id}],
    ['SETTING_CHANGE','/api/city_settings.php',{city:'stadt-a',dispatchPhone:'Nicht speichern'}]
  ];
  for (const [action, url, input] of cases) {
    const before = snapshot(), count = auditState().events.length;
    sql("CREATE TRIGGER a5_fail BEFORE INSERT ON audit_events WHEN NEW.action='" + action +
      "' BEGIN SELECT RAISE(ABORT,'A5 simulated failure'); END");
    try {
      const result = await request(url,{json:input});
      assert.equal(result.status,503,action+': '+result.body);
      assert.equal(result.json().ok,false);
    } finally { sql('DROP TRIGGER a5_fail'); }
    assert.deepEqual(snapshot(),before,action);
    assert.equal(auditState().events.length,count,action);
    assert.equal(auditState().chain,true);
  }
});

test('A5 Download-Auditfehler gibt keine PDF- oder ZIP-Bytes frei', async () => {
  const id=globalThis.a5Package.id, name=globalThis.a5Package.documents[0].file;
  const before=snapshot(), count=auditState().events.length;
  sql("CREATE TRIGGER a5_fail BEFORE INSERT ON audit_events WHEN NEW.action='PACKAGE_DOWNLOAD' BEGIN SELECT RAISE(ABORT,'A5 download failure'); END");
  try {
    for(const suffix of ['', '&document='+name]) {
      const result=await request('/api/download_driver_package.php?id='+id+suffix);
      assert.equal(result.status,503,result.body); assert.equal(result.json().ok,false);
    }
  } finally {sql('DROP TRIGGER a5_fail');}
  assert.deepEqual(snapshot(),before);
  assert.equal(auditState().events.length,count);
});

test('A5 Paketerneuerung und Statuswechsel bleiben benutzbar', async () => {
  const result=await request('/api/create_driver_documents.php',{json:{mode:'update',
    packageId:globalThis.a5Package.id,driverId:globalThis.driverA,trainingId:globalThis.a5Training,
    driverName:'Audit Aktualisiert',items:[itemA5]}});
  assert.equal(result.status,200,result.body);
  for(const status of ['running','completed','archived']) {
    const changed=await request('/api/trainings.php',{json:{action:'updateStatus',
      trainingId:globalThis.a5Training,status}});
    assert.equal(changed.status,200,changed.body);
  }
  const same=await request('/api/manage_driver_package.php',{json:{action:'rename',
    id:globalThis.a5Package.id,driverName:'Audit Aktualisiert'}});
  const count=auditState().events.length;
  assert.equal(same.status,200,same.body);
  assert.equal(auditState().events.at(-1).action,'TRAINING_STATUS_CHANGE');
  const removed=await request('/api/manage_driver_package.php',{json:{action:'delete',id:globalThis.a5Package.id}});
  assert.equal(removed.status,200,removed.body);
  assert.equal(auditState().events.length,count+1);
  assert.equal(auditState().chain,true);
});

test('A5 Token, Legacy-Session und falscher CSRF duerfen keine Fachschreibaktionen ausfuehren', async () => {
  const legacy=await login('firma-a');
  const writes=['drivers.php','trainings.php','create_driver_documents.php','manage_driver_package.php','city_settings.php'];
  for(const endpoint of writes){
    for(const session of [legacy,{...sessionA,csrf:'wrong'}]){
      const result=await request('/api/'+endpoint,{json:{}},session);
      assert.equal(result.status,403,result.body);
    }
    const result=await request('/api/'+endpoint,{json:{},headers:{'X-Api-Token':'phase4c-token'}},null);
    assert.equal(result.status,401,result.body);
  }
  const result=await request('/api/download_driver_package.php?id=missing',{},legacy);
  assert.equal(result.status,403,result.body);
});

test('A5 BLOCKED sperrt Personal und Pakete nur im betroffenen Tenant', async () => {
  const dir=path.join(privateRoot,'companies',companyA.id,'imports','audit-file-operations');
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'op_'+'f'.repeat(32)+'.json');fs.writeFileSync(file,'invalid journal');
  try {
    for(const url of ['/api/drivers.php','/api/trainings.php','/api/list_driver_packages.php',
      '/api/city_settings.php?city=stadt-a']) {
      assert.equal((await request(url)).status,503,url);
    }
    assert.equal((await request('/api/drivers.php',{},sessionB)).status,200);
    assert.equal((await request('/api/drivers.php',{json:{action:'toggle',id:globalThis.driverA}})).status,503);
  } finally {fs.unlinkSync(file);}
});

test('A5 beschaedigte Fahrer- und Einstellungsdateien werden nicht ueberschrieben', async () => {
  for(const [area,name,url,input] of [
    ['drivers','drivers.json','/api/drivers.php',{action:'create',firstName:'Fehler'}],
    ['settings','city_settings.json','/api/city_settings.php',{city:'stadt-a',dispatchPhone:'Fehler'}]]) {
    const file=path.join(privateRoot,'companies',companyA.id,area,name);
    const before=fs.readFileSync(file);fs.writeFileSync(file,'{invalid');
    try {
      assert.equal((await request(url,{json:input})).status,503);
      assert.equal(fs.readFileSync(file,'utf8'),'{invalid');
    } finally {fs.writeFileSync(file,before);}
  }
});

function runPhpAsync(code) {
  return new Promise((resolve,reject)=>{
    const child=spawn(php,['-r',code],{cwd:root,env:env(),windowsHide:true});
    let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    child.on('error',reject);child.on('close',status=>resolve({status,out,err}));
  });
}

test('A5 parallele Fahreranlage verliert keine Aenderung und schreibt zwei Auditzeugen',async()=>{
  const initial=(await request('/api/drivers.php')).json().drivers.map(x=>x.id);
  const count=auditState().events.length;
  const ids=['drv_'+'c'.repeat(32),'drv_'+'d'.repeat(32)];
  const results=await Promise.all(ids.map(id=>{
    const code='require '+phpString(path.join(root,'api/_business_audit.php'))+';'+
      '$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]='+phpString(sessionA.cookie.split('=').slice(1).join('='))+';'+
      '$company='+phpString(companyA.id)+';'+
      'lehrfahrer_business_request($company,true,static function()use($company):void{'+
      '$file=lehrfahrer_tenant_path($company,"drivers","drivers.json");'+
      '$drivers=json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR);usleep(100000);'+
      '$id='+phpString(id)+';$drivers[]=["id"=>$id,"firstName"=>"Parallel","active"=>true];'+
      'lehrfahrer_business_commit($company,"DRIVER",$id,"DRIVER_CREATE","drivers.manage",'+
      '[["area"=>"drivers","relative"=>"drivers.json","content"=>lehrfahrer_business_json($drivers)]]);echo "OK";});';
    return runPhpAsync(code);
  }));
  for(const result of results){assert.equal(result.status,0,result.err);assert.equal(result.out,'OK',result.err);}
  const after=(await request('/api/drivers.php')).json().drivers.map(x=>x.id);
  assert.deepEqual([...after].sort(),[...initial,...ids].sort());
  assert.equal(auditState().events.length,count+2);
  for(const id of ids)assert.equal((await request('/api/drivers.php',{json:{action:'delete',id}})).status,200);
});

test('A5 Request-IDs ersetzen weder Audit-Akteur noch Mandanten oder bestehende Fahrer',async()=>{
  const result=await request('/api/drivers.php',{json:{action:'create',id:globalThis.driverA,
    firstName:'Spoofprobe',company_id:companyB.id,account_id:'acc_'+'f'.repeat(32)}});
  assert.equal(result.status,200,result.body);const id=result.json().driver.id;
  assert.notEqual(id,globalThis.driverA);
  const event=auditState().events.at(-1);assert.equal(event.company_id,companyA.id);
  assert.notEqual(event.account_id,'acc_'+'f'.repeat(32));
  assert.ok((await request('/api/drivers.php')).json().drivers.some(x=>x.id===globalThis.driverA&&x.firstName==='Anna Neu'));
  assert.equal((await request('/api/drivers.php',{json:{action:'delete',id}})).status,200);
});

test('A5 Einweisungs-IDs bleiben bei zwei parallelen HTTP-Servern eindeutig',async()=>{
  const otherOrigin='http://127.0.0.1:'+await freePort();
  const other=spawn(php,['-S',otherOrigin.replace('http://',''),'-t',webroot],
    {cwd:webroot,env:env(),stdio:'ignore',windowsHide:true});
  try {
    for(let i=0;i<50;i++){
      try{if((await fetch(otherOrigin+'/api/auth/runtime.php')).status===200)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    const send=async target=>{
      const response=await fetch(target+'/api/trainings.php',{method:'POST',
        headers:{Cookie:sessionA.cookie,Origin:origin,'X-CSRF-Token':sessionA.csrf,'Content-Type':'application/json'},
        body:JSON.stringify({action:'create',driverId:globalThis.driverA,routes:[itemA5]})});
      const body=await response.text();assert.equal(response.status,200,body);return JSON.parse(body).training;
    };
    const count=auditState().events.length;
    const [a,b]=await Promise.all([send(origin),send(otherOrigin)]);
    assert.notEqual(a.trainingId,b.trainingId);
    const stored=(await request('/api/trainings.php')).json().trainings;
    for(const t of [a,b])assert.ok(stored.some(x=>x.trainingId===t.trainingId));
    assert.equal(auditState().events.length,count+2);
    assert.equal(auditState().chain,true);
  } finally {other.kill();}
});
