const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-audit-file-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(candidate => spawnSync(candidate, ['-v'], { encoding: 'utf8' }).status === 0);
if (!php) throw new Error('PHP fehlt.');
const company = 'cmp_' + 'a'.repeat(32);
const route = 'cottbus/Linie_1/Standard/Route_01.json';
const quote = value => JSON.stringify(String(value).replaceAll('\\', '/'));
let sequence = 0;

function fixture() {
  const privateRoot = path.join(temp, String(++sequence));
  const routePath = path.join(privateRoot, 'companies', company, 'lines', ...route.split('/'));
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  return { privateRoot, routePath, journalDir: path.join(privateRoot, 'companies', company,
    'imports', 'audit-file-operations') };
}

function source(f, code) {
  return `putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . ${quote(f.privateRoot)});
putenv('LEHRFAHRER_DB_DRIVER=sqlite'); putenv('LEHRFAHRER_ENV=dev');
require ${quote(path.join(root, 'api/_audit_file_operation.php'))};
$pdo=lehrfahrer_control_database();
$actor=LehrfahrerAuditActor::authorizedCli();
$company=${quote(company)}; $route=${quote(route)};
$object=lehrfahrer_audit_file_object_id($company,$route);
$event=['action'=>'SYSTEM_CHANGE','objectType'=>'SYSTEM','objectId'=>$object,'result'=>'SUCCESS'];
` + code;
}

function run(f, code, expect = 0) {
  const result = spawnSync(php, ['-r', source(f, code)], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, expect, result.stderr);
  return result.stdout;
}

function runAsync(f, code) {
  return new Promise((resolve, reject) => {
    const child = spawn(php, ['-r', source(f, code)], { cwd: root, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stderr }));
  });
}

test('CREATE, UPDATE und DELETE koppeln Datei und Audit', () => {
  const f = fixture();
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
    [['relative'=>$route,'content'=>'erste Route']],$event);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'erste Route');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'zweite Route']],$event);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'zweite Route');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'DELETE',
    [['relative'=>$route]],$event);
echo json_encode(['count'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
  'chain'=>lehrfahrer_audit_verify_chain($pdo),
  'blocked'=>lehrfahrer_audit_file_route_blocked($company,lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`);
  assert.equal(fs.existsSync(f.routePath), false);
  const result = JSON.parse(run(f, `echo json_encode(['count'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'chain'=>lehrfahrer_audit_verify_chain($pdo),
    'journals'=>glob(lehrfahrer_audit_file_directory($company).'/*.json')]);`));
  assert.deepEqual(result, { count: 3, chain: true, journals: [] });
});

test('Abbruch vor Aktivierung erzeugt weder Datei noch SUCCESS-Audit', () => {
  const f = fixture();
  const result = JSON.parse(run(f, `try {
    lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
      [['relative'=>$route,'content'=>'neu']],$event,
      static function($stage) { if($stage==='PREPARED') throw new RuntimeException('simuliert'); });
  } catch (RuntimeException $error) {}
  echo json_encode(['count'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'blocked'=>lehrfahrer_audit_file_route_blocked($company,lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.equal(fs.existsSync(f.routePath), false);
  assert.deepEqual(result, { count: 0, blocked: false });
});

test('Prozessabbruch nach Aktivierung wird vor Auslieferung erkannt und zurückgerollt', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event,
    static function($stage) { if($stage==='FILE_ACTIVATED') exit(17); });`, 17);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'neu');
  const result = JSON.parse(run(f, `$path=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard');
  $before=lehrfahrer_audit_file_route_blocked($company,$path);
  lehrfahrer_audit_file_recover($pdo,$company);
  echo json_encode(['before'=>$before,'after'=>lehrfahrer_audit_file_route_blocked($company,$path),
    'events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn()]);`));
  assert.deepEqual(result, { before: true, after: false, events: 0 });
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
});

test('Prozessabbruch nach DB-Commit finalisiert die neue Datei', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event,
    static function($stage) { if($stage==='DB_COMMIT') exit(18); });`, 18);
  const result = JSON.parse(run(f, `$path=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard');
  $before=lehrfahrer_audit_file_route_blocked($company,$path);
  lehrfahrer_audit_file_recover($pdo,$company);
  echo json_encode(['before'=>$before,'after'=>lehrfahrer_audit_file_route_blocked($company,$path),
    'events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'chain'=>lehrfahrer_audit_verify_chain($pdo)]);`));
  assert.deepEqual(result, { before: true, after: false, events: 1, chain: true });
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'neu');
});

test('CRITICAL Audit-Fehler verhindert Dateiaktivierung', () => {
  const f = fixture();
  const result = JSON.parse(run(f, `$pdo->exec('DELETE FROM audit_chain_state');
  $failed=false;
  try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
    [['relative'=>$route,'content'=>'neu']],$event); }
  catch (LehrfahrerAuditWriteFailure $error) { $failed=true; }
  echo json_encode(['failed'=>$failed,'events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'blocked'=>lehrfahrer_audit_file_route_blocked($company,lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.deepEqual(result, { failed: true, events: 0, blocked: false });
  assert.equal(fs.existsSync(f.routePath), false);
});

test('CREATE und DELETE nach Prozessabbruch ohne DB-Commit recovern', () => {
  for (const kind of ['CREATE', 'DELETE']) {
    const f = fixture();
    if (kind === 'DELETE') fs.writeFileSync(f.routePath, 'alt');
    run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,${quote(kind)},
      [['relative'=>$route,'content'=>'neu']],$event,
      static function($stage) { if($stage==='FILE_ACTIVATED') exit(19); });`, 19);
    assert.equal(fs.existsSync(f.routePath), kind === 'CREATE');
    run(f, `lehrfahrer_audit_file_recover($pdo,$company);`);
    assert.equal(fs.existsSync(f.routePath), kind === 'DELETE');
    if (kind === 'DELETE') assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
  }
});

test('fehlendes Backup setzt BLOCKED; erfolgreiche spätere Recovery hebt es auf', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event,
    static function($stage) { if($stage==='FILE_ACTIVATED') exit(20); });`, 20);
  const journalPath = path.join(f.journalDir, fs.readdirSync(f.journalDir).find(x => x.endsWith('.json')));
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const backup = path.join(path.dirname(f.routePath), '.lf-audit-' + journal.id + '-0.bak');
  fs.renameSync(backup, backup + '.hidden');
  const result = JSON.parse(run(f, `$failed=false;
    try { lehrfahrer_audit_file_recover($pdo,$company); } catch(RuntimeException $e) { $failed=true; }
    echo json_encode(['failed'=>$failed,'blocked'=>lehrfahrer_audit_file_route_blocked($company,
      lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.deepEqual(result, { failed: true, blocked: true });
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).state, 'BLOCKED');
  fs.renameSync(backup + '.hidden', backup);
  run(f, `lehrfahrer_audit_file_recover($pdo,$company);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
  assert.equal(JSON.parse(run(f, `echo json_encode(lehrfahrer_audit_file_route_blocked($company,
    lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard')));`)), false);
});

test('manipuliertes Journal und ungültiger State bleiben fail-closed', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event,
    static function($stage) { if($stage==='PREPARED') exit(21); });`, 21);
  const journalPath = path.join(f.journalDir, fs.readdirSync(f.journalDir).find(x => x.endsWith('.json')));
  const original = fs.readFileSync(journalPath, 'utf8');
  const tampered = JSON.parse(original);
  tampered.state = 'UNGUELTIG';
  fs.writeFileSync(journalPath, JSON.stringify(tampered));
  const result = JSON.parse(run(f, `$failed=false;
    try { lehrfahrer_audit_file_recover($pdo,$company); } catch(RuntimeException $e) { $failed=true; }
    echo json_encode(['failed'=>$failed,'blocked'=>lehrfahrer_audit_file_route_blocked($company,
      lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.deepEqual(result, { failed: true, blocked: true });
  fs.writeFileSync(journalPath, original);
  run(f, `lehrfahrer_audit_file_recover($pdo,$company);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
});

test('vorgegaukelter COMPLETED-State ohne DB-Commit gibt geänderte Datei nicht frei', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event,
    static function($stage) { if($stage==='FILE_ACTIVATED') exit(24); });`, 24);
  const journalPath = path.join(f.journalDir, fs.readdirSync(f.journalDir).find(x => x.endsWith('.json')));
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.state = 'COMPLETED';
  delete journal.checksum;
  const crypto = require('node:crypto');
  journal.checksum = crypto.createHash('sha256').update(JSON.stringify(journal).replaceAll('\\/', '/')).digest('hex');
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  assert.equal(JSON.parse(run(f, `echo json_encode(lehrfahrer_audit_file_route_blocked($company,
    lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard')));`)), true);
  run(f, `lehrfahrer_audit_file_recover($pdo,$company);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
});

test('Pfad-Traversal und Symlink-Ziele werden vor einem Journal abgewiesen', () => {
  const f = fixture();
  const result = JSON.parse(run(f, `$traversal=false;
    try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
      [['relative'=>'../fremd.json','content'=>'x']],$event); }
    catch(Throwable $e) { $traversal=true; }
    echo json_encode(['traversal'=>$traversal,'journals'=>glob(lehrfahrer_audit_file_directory($company).'/*.json')]);`));
  assert.deepEqual(result, { traversal: true, journals: [] });
  const outside = path.join(temp, 'outside-' + sequence + '.json');
  fs.writeFileSync(outside, 'fremd');
  try {
    fs.symlinkSync(outside, f.routePath);
  } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  assert.equal(JSON.parse(run(f, `$denied=false;
    try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
      [['relative'=>$route,'content'=>'x']],$event); }
    catch(Throwable $e) { $denied=true; }
    echo json_encode($denied);`)), true);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'fremd');
});

test('ein Vorgang darf keine zweite, nicht zugehörige Route verändern', () => {
  const f = fixture();
  const unrelated = route.replace('Route_01.json', 'Route_02.json');
  const result = JSON.parse(run(f, `$denied=false;
    try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
      [['relative'=>$route,'content'=>'eins'],
       ['relative'=>${quote(unrelated)},'content'=>'zwei']],$event); }
    catch(InvalidArgumentException $error) { $denied=true; }
    echo json_encode(['denied'=>$denied,'journals'=>glob(lehrfahrer_audit_file_directory($company).'/*.json')]);`));
  assert.deepEqual(result, { denied: true, journals: [] });
  assert.equal(fs.existsSync(f.routePath), false);
});

test('Teilaktivierung mehrerer Dateien wird vollständig zurückgerollt', () => {
  const f = fixture();
  const gpx = path.join(path.dirname(f.routePath), 'Route_01.gpx');
  fs.writeFileSync(f.routePath, 'alt-json');
  fs.writeFileSync(gpx, 'alt-gpx');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu-json'],
     ['relative'=>'cottbus/Linie_1/Standard/Route_01.gpx','content'=>'neu-gpx']],$event,
    static function($stage) { if($stage==='ACTIVATED_0') exit(22); });`, 22);
  run(f, `lehrfahrer_audit_file_recover($pdo,$company);`);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt-json');
  assert.equal(fs.readFileSync(gpx, 'utf8'), 'alt-gpx');
});

test('simulierter DB-Commitfehler rollt aktivierte Datei und Audit zurück', () => {
  const f = fixture();
  fs.writeFileSync(f.routePath, 'alt');
  const result = JSON.parse(run(f, `class FailingCommitPDO extends PDO {
    public function commit(): bool { throw new RuntimeException('commit failed'); }
  }
  $bad=new FailingCommitPDO('sqlite:'.lehrfahrer_control_database_path());
  $bad->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
  $failed=false;
  try { lehrfahrer_audit_file_mutate($bad,$actor,$company,$route,'UPDATE',
    [['relative'=>$route,'content'=>'neu']],$event); }
  catch (RuntimeException $error) { $failed=true; }
  echo json_encode(['failed'=>$failed,'events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'blocked'=>lehrfahrer_audit_file_route_blocked($company,lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.deepEqual(result, { failed: true, events: 0, blocked: false });
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt');
});

test('Tenant A kann keine Pfade von Tenant B mutieren oder recovern', () => {
  const f = fixture();
  const other = 'cmp_' + 'b'.repeat(32);
  const otherPath = path.join(f.privateRoot, 'companies', other, 'lines', ...route.split('/'));
  fs.mkdirSync(path.dirname(otherPath), { recursive: true });
  fs.writeFileSync(otherPath, 'B');
  const result = JSON.parse(run(f, `$other=${quote(other)};
    $foreign=false; try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
      [['relative'=>'../'. $other .'/lines/'.$route,'content'=>'boese']],$event); }
      catch(Throwable $e) { $foreign=true; }
    echo json_encode(['foreign'=>$foreign,
      'otherBlocked'=>lehrfahrer_audit_file_route_blocked($other,
        lehrfahrer_route_file($other,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
  assert.deepEqual(result, { foreign: true, otherBlocked: false });
  assert.equal(fs.readFileSync(otherPath, 'utf8'), 'B');
});

test('parallele Operationen am selben Objekt werden durch die Tenant-Sperre serialisiert', async () => {
  const f = fixture();
  const first = runAsync(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
    [['relative'=>$route,'content'=>'erste']],$event,
    static function($stage) { if($stage==='PREPARED') usleep(500000); });`);
  for (let i = 0; i < 50 && (!fs.existsSync(f.journalDir)
    || !fs.readdirSync(f.journalDir).some(name => name.endsWith('.json'))); i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const second = runAsync(f, `try { lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'CREATE',
    [['relative'=>$route,'content'=>'zweite']],$event); }
    catch(RuntimeException $error) { exit(23); }`);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 23, b.stderr);
  assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'erste');
  assert.equal(JSON.parse(run(f, `echo json_encode(['events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
    'chain'=>lehrfahrer_audit_verify_chain($pdo)]);`)).events, 1);
});

test('GTFS-Inventardatei kann als technische UPDATE-Datei für ein Routenobjekt dienen', () => {
  const f = fixture();
  const inventory = path.join(f.privateRoot, 'companies', company, 'imports', 'gtfs', 'index', 'work-inventory.json');
  fs.mkdirSync(path.dirname(inventory), { recursive: true });
  fs.writeFileSync(inventory, '{"status":"GEPRUEFT"}');
  run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
    [['area'=>'imports','relative'=>'gtfs/index/work-inventory.json',
      'content'=>'{"status":"FREIGEGEBEN"}']],$event);`);
  assert.equal(fs.readFileSync(inventory, 'utf8'), '{"status":"FREIGEGEBEN"}');
  assert.equal(JSON.parse(run(f, `echo json_encode(lehrfahrer_audit_verify_chain($pdo));`)), true);
});

test('Recovery vor Aktivierung ist an jeder Journalgrenze idempotent', () => {
  for (const stage of ['PREPARING','PREPARED','AUDIT_PREPARED','ACTIVATING']) {
    const f = fixture();
    fs.writeFileSync(f.routePath, 'alt');
    run(f, `lehrfahrer_audit_file_mutate($pdo,$actor,$company,$route,'UPDATE',
      [['relative'=>$route,'content'=>'neu']],$event,
      static function($state) { if($state===${quote(stage)}) exit(24); });`, 24);
    const result = JSON.parse(run(f, `lehrfahrer_audit_file_recover($pdo,$company);
      lehrfahrer_audit_file_recover($pdo,$company);
      echo json_encode(['events'=>(int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn(),
        'chain'=>lehrfahrer_audit_verify_chain($pdo),
        'blocked'=>lehrfahrer_audit_file_route_blocked($company,
          lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_1','Standard'))]);`));
    assert.deepEqual(result, { events: 0, chain: true, blocked: false }, stage);
    assert.equal(fs.readFileSync(f.routePath, 'utf8'), 'alt', stage);
  }
});
