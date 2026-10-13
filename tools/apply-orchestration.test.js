const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const migrationTool = path.join(__dirname, 'cottbus-migrate-staging.php');
const backupTool = path.join(__dirname, '_control-db-restore-point.php');
const indexTool = path.join(root, 'api', '_gtfs_variant_index.php');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-orchestration-'));
const candidates = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean);
const php = candidates.find(candidate => {
  const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
});
if (!php) throw new Error('PHP fehlt.');

function p(value) { return JSON.stringify(String(value).replaceAll('\\', '/')); }
function run(file, code, env = {}) {
  return spawnSync(php, ['-r', `require ${p(file)}; ${code}`], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_ENV: 'dev', ...env }
  });
}
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('gemeinsamer GTFS-Builder erzeugt und validiert ausschließlich den Tenant-Index', () => {
  const database = path.join(sandbox, 'variants.sqlite');
  const files = {
    'agency.txt': 'agency_id,agency_name\n143,Cottbusverkehr\n999,Fremd\n',
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type\nr1,143,1,Route 1,3\nrf,999,X,Fremd,3\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,parent_station\ns1,Start,51.1,14.1,\ns2,Ziel,51.2,14.2,\n',
    'trips.txt': 'route_id,service_id,trip_id,direction_id,trip_headsign\nr1,svc,t1,0,Ziel\nrf,svc,tf,0,Fremd\n',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence\nt1,s1,1\nt1,s2,2\n',
  };
  const encoded = Buffer.from(JSON.stringify(files)).toString('base64');
  const result = run(indexTool, `$files=json_decode(base64_decode('${encoded}'),true); $v=lehrfahrer_gtfs_build_variant_index($files,${p(database)},['143']); echo json_encode($v);`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const validation = JSON.parse(result.stdout);
  assert.equal(validation.schema_version, 3);
  assert.deepEqual(validation.agency_ids, ['143']);
  assert.equal(validation.routes, 1);
  assert.equal(validation.variants, 1);
  assert.equal(validation.integrity_check, 'ok');
});

test('Indexvalidator blockiert beschädigte SQLite-Datei', () => {
  const damaged = path.join(sandbox, 'damaged.sqlite');
  fs.writeFileSync(damaged, 'not sqlite');
  const result = run(indexTool, `try { lehrfahrer_gtfs_validate_variant_index(${p(damaged)},['143']); } catch(Throwable $e) { echo $e->getMessage(); }`);
  assert.match(result.stdout, /SQLite-Header/);
});

test('Fehler vor und während des Indexbaus hinterlassen keinen Index', () => {
  const missing = path.join(sandbox, 'missing-index.sqlite');
  let result = run(indexTool, `try{lehrfahrer_gtfs_build_variant_index([],${p(missing)},['143']);}catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /GTFS-Datei fehlt/); assert.equal(fs.existsSync(missing), false);
  const broken = path.join(sandbox, 'broken-build.sqlite');
  const files = {
    'agency.txt': 'agency_id,agency_name\n143,Cottbusverkehr\n',
    'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_type\nr1,143,1,R,3\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,parent_station\ns1,A,51,14,\ns2,B,51,14,\n',
    'trips.txt': 'route_id,trip_id\nr1,t1\n',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence\nt1,s1,invalid\n',
  };
  result = run(indexTool, `$f=json_decode(base64_decode('${Buffer.from(JSON.stringify(files)).toString('base64')}'),true);try{lehrfahrer_gtfs_build_variant_index($f,${p(broken)},['143']);}catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /stop_sequence/); assert.equal(fs.existsSync(broken), false);
});

test('DB-Restore-Punkt enthält Manifest, Hash und keine Secrets', () => {
  const privateRoot = path.join(sandbox, 'private');
  fs.mkdirSync(privateRoot);
  const dump = [...['capabilities','companies','control_metadata','role_capabilities','roles','schema_migrations','sessions','user_activation_tokens','user_roles','users']]
    .map(name => `CREATE TABLE \`${name}\` (id INT);`).join('\n');
  const encodedDump = Buffer.from(dump).toString('base64');
  const code = `$cfg=['dsn'=>'mysql:host=db.example;port=3306;dbname=control;charset=utf8mb4','user'=>'app','password'=>'TOP-SECRET'];` +
    `$cap=['DB_BACKUP_CAPABLE'=>'YES','DB_RESTORE_PATH_VALID'=>'YES','dump_binary'=>'fake-dump','restore_binary'=>'fake-restore'];` +
    `$runner=function($cmd,$password,$stdin,$stdout){file_put_contents($stdout,base64_decode('${encodedDump}'));return ['status'=>0,'stdout'=>'','stderr_present'=>false];};` +
    `$r=cottbusCreateControlDbRestorePoint($cfg,${p(privateRoot)},$cap,'4',$runner);echo json_encode($r);`;
  const result = run(backupTool, code);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const manifest = JSON.parse(fs.readFileSync(payload.manifest, 'utf8'));
  assert.equal(path.relative(privateRoot, payload.dump).startsWith('..'), false);
  assert.doesNotMatch(payload.dump, /TOP-SECRET/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(payload.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(payload.dump).mode & 0o777, 0o600);
    assert.equal(fs.statSync(payload.manifest).mode & 0o777, 0o600);
  }
  assert.equal(manifest.schema_version, '4');
  assert.equal(manifest.sha256, require('node:crypto').createHash('sha256').update(fs.readFileSync(payload.dump)).digest('hex'));
  assert.doesNotMatch(JSON.stringify(manifest), /TOP-SECRET/);
  assert.equal(manifest.restore.client_validated, true);
});

test('fehlender Dump-/Restore-Client und fehlgeschlagener Dump blockieren hart', () => {
  const privateRoot = path.join(sandbox, 'blocked-private'); fs.mkdirSync(privateRoot);
  const cfg = "['dsn'=>'mysql:host=db.example;dbname=control','user'=>'app','password'=>'secret']";
  let result = run(backupTool, `putenv('LEHRFAHRER_ENV=staging');putenv('PATH=');echo json_encode(cottbusDbBackupCapability(${cfg},${p(privateRoot)}));`);
  assert.equal(JSON.parse(result.stdout).DB_BACKUP_CAPABLE, 'NO');
  const code = `$cfg=${cfg};$cap=['DB_BACKUP_CAPABLE'=>'YES','DB_RESTORE_PATH_VALID'=>'YES','dump_binary'=>'fake','restore_binary'=>'fake'];` +
    `$runner=function(){return ['status'=>1,'stdout'=>'','stderr_present'=>true];};try{cottbusCreateControlDbRestorePoint($cfg,${p(privateRoot)},$cap,'4',$runner);}catch(Throwable $e){echo $e->getMessage();}`;
  result = run(backupTool, code);
  assert.match(result.stdout, /Dump ist fehlgeschlagen/);
  const restorePoints = path.join(privateRoot, 'backups', 'control-db');
  assert.deepEqual(fs.existsSync(restorePoints) ? fs.readdirSync(restorePoints) : [], []);
  const invalid = `$cfg=${cfg};$cap=['DB_BACKUP_CAPABLE'=>'YES','DB_RESTORE_PATH_VALID'=>'YES','dump_binary'=>'fake','restore_binary'=>'fake'];` +
    `$runner=function($cmd,$password,$stdin,$stdout){file_put_contents($stdout,'not a database dump');return ['status'=>0,'stdout'=>'','stderr_present'=>false];};` +
    `try{cottbusCreateControlDbRestorePoint($cfg,${p(privateRoot)},$cap,'4',$runner);}catch(Throwable $e){echo $e->getMessage();}`;
  result = run(backupTool, invalid);
  assert.match(result.stdout, /erwartete Tabelle/);
  assert.deepEqual(fs.readdirSync(restorePoints), []);
});

test('echter Restore-Punkt ist außerhalb von Staging nicht aufrufbar', () => {
  const result = run(backupTool, `$cfg=['dsn'=>'mysql:host=x;dbname=control','user'=>'u','password'=>'p'];$cap=['DB_BACKUP_CAPABLE'=>'YES','DB_RESTORE_PATH_VALID'=>'YES'];try{cottbusCreateControlDbRestorePoint($cfg,${p(sandbox)},$cap,'4');}catch(Throwable $e){echo $e->getMessage();}`,
    { LEHRFAHRER_ENV: 'production' });
  assert.match(result.stdout, /nur für Staging|nur fuer Staging/);
});

test('isolierter Restore blockiert die Quelldatenbank und akzeptiert separates Testziel', () => {
  const dump = path.join(sandbox, 'restore.sql'); fs.writeFileSync(dump, 'fixture');
  const common = `$manifest=['database'=>['database'=>'control']];$cap=['DB_RESTORE_PATH_VALID'=>'YES','restore_binary'=>'fake'];`;
  let result = run(backupTool, `${common} try { cottbusRestoreControlDbIsolated($manifest,${p(dump)},['dsn'=>'mysql:host=x;dbname=control','user'=>'u','password'=>'p'],$cap,function(){}); } catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /andere isolierte Datenbank/);
  result = run(backupTool, `${common}$called=false;$runner=function($cmd,$password,$stdin,$stdout)use(&$called){$called=$stdin!==null;return ['status'=>0,'stdout'=>'','stderr_present'=>false];};cottbusRestoreControlDbIsolated($manifest,${p(dump)},['dsn'=>'mysql:host=x;dbname=isolated_restore','user'=>'u','password'=>'p'],$cap,$runner);echo $called?'OK':'NO';`);
  assert.equal(result.stdout, 'OK');
});

test('kontrollierter PDO-Restore-Parser trennt nur echte SQL-Anweisungsgrenzen', () => {
  const sql = "CREATE TABLE `x` (`v` varchar(20) DEFAULT 'a;b');\nINSERT INTO `x` VALUES ('c;d');\n";
  const result = run(backupTool, `echo json_encode(cottbusSplitSqlStatements(base64_decode('${Buffer.from(sql).toString('base64')}')));`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), ["CREATE TABLE `x` (`v` varchar(20) DEFAULT 'a;b')", "INSERT INTO `x` VALUES ('c;d')"]);
});

test('atomarer Tenant-Swap stellt bei Commitfehler den Altstand wieder her', () => {
  const base = path.join(sandbox, 'swap');
  const current = path.join(base, 'company'); const next = path.join(base, 'next'); const backup = path.join(base, 'rollback');
  fs.mkdirSync(current, { recursive: true }); fs.mkdirSync(next); fs.writeFileSync(path.join(current, 'value'), 'old'); fs.writeFileSync(path.join(next, 'value'), 'new');
  const result = run(migrationTool, `try { cottbusAtomicTenantSwap(${p(current)},${p(next)},${p(backup)},function(){throw new RuntimeException('commit failed');}); } catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /commit failed/);
  assert.equal(fs.readFileSync(path.join(current, 'value'), 'utf8'), 'old');
  assert.equal(fs.existsSync(backup), false);
});

test('fehlender oder beschädigter Index blockiert den Root-Swap bereits bei der Vollvalidierung', () => {
  const base = path.join(sandbox, 'pre-swap'); const company = 'cmp_' + '9'.repeat(32);
  fs.mkdirSync(base, { recursive: true });
  const logical = `companies/${company}/imports/gtfs/index/variants.sqlite`;
  let result = run(migrationTool, `try{cottbusValidatePreparedTenantRoot(${p(base)},${p(company)},[${p(logical)}=>'x']);}catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /Datei fehlt/);
  const index = path.join(base, 'imports', 'gtfs', 'index', 'variants.sqlite'); fs.mkdirSync(path.dirname(index), { recursive: true }); fs.writeFileSync(index, 'broken');
  result = run(migrationTool, `try{cottbusValidatePreparedTenantRoot(${p(base)},${p(company)},[${p(logical)}=>'broken']);}catch(Throwable $e){echo $e->getMessage();}`);
  assert.match(result.stdout, /SQLite-Header/);
});

test('alle vier Orchestrierungs-Gates sind für isolierte Tests positiv', () => {
  const result = run(migrationTool, `echo json_encode(cottbusApplyOrchestrationCapabilities(null));`);
  const gates = JSON.parse(result.stdout);
  for (const name of ['DB_BACKUP_CAPABLE','DB_RESTORE_PATH_VALID','VARIANTS_REBUILD_CAPABLE','VARIANTS_VALIDATION_CAPABLE']) assert.equal(gates[name], 'YES');
});
