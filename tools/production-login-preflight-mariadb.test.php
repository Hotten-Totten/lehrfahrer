<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])
    || getenv('LEHRFAHRER_PREFLIGHT_ISOLATED') !== '1'
    || getenv('LEHRFAHRER_DB_HOST') !== '127.0.0.1'
    || getenv('LEHRFAHRER_DB_DSN')) exit(2);
$name = (string)getenv('LEHRFAHRER_DB_NAME');
if (!preg_match('/^lf_preflight_fixture_[a-f0-9]+$/D', $name)) exit(2);
require __DIR__ . '/production-login-preflight.php';
function check(bool $ok, string $code): void { if (!$ok) throw new RuntimeException($code); }
$cfg = lehrfahrer_control_mysql_configuration();
$admin = new PDO($cfg['dsn'], $cfg['user'], $cfg['password'], $cfg['options']);
check($admin->query('SELECT DATABASE()')->fetchColumn() === $name, 'FIXTURE_DATABASE_MISMATCH');
check((int)$admin->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchColumn() === 0, 'FIXTURE_NOT_EMPTY');
check(str_contains((string)$admin->query('SELECT VERSION()')->fetchColumn(), 'MariaDB'), 'MARIADB_REQUIRED');
putenv('LEHRFAHRER_ENV=production');
$root = sys_get_temp_dir() . '/lf-preflight-private-' . bin2hex(random_bytes(8));
mkdir($root, 0700); putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . $root);
$_SERVER['DOCUMENT_ROOT'] = $root . '/web';
$pdo = lehrfahrer_control_database(); // Fixture creation only, never used by the check.
$companies = new LehrfahrerCompanyRepository($pdo);
$users = new LehrfahrerUserRepository($pdo); $roles = new LehrfahrerRoleRepository($pdo);
for ($i=0; $i<4; $i++) {
    $company = $companies->create(['slug'=>'fixture-private-'.$i,'name'=>'Private Fixture','status'=>'active','license_status'=>'active']);
    $user = $users->create($company['id'], ['login'=>'fixture-secret-'.$i,'display_name'=>'Private Person','password'=>'Fixture-password-12345!']);
    $roles->assignRole($company['id'], $user['id'], 'FAHRER');
}
$pdo->exec("INSERT INTO control_metadata (`key`,value,updated_at) VALUES ('auth_mode','PARALLEL','2026-11-08'),('auth_cutover_lock','OPEN','2026-11-08') ON DUPLICATE KEY UPDATE value=VALUES(value)");
// A genuinely SELECT-only user validates the real CLI, independently of transaction flags.
$pdo->exec("CREATE USER 'lf_preflight_reader'@'127.0.0.1' IDENTIFIED BY 'fixture-reader-only'");
$pdo->exec("GRANT SELECT ON `$name`.* TO 'lf_preflight_reader'@'127.0.0.1'");
function fingerprint(PDO $pdo): string {
    $tables=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN); sort($tables); $out=[];
    foreach($tables as $table) {
        $rows=$pdo->query('SELECT * FROM `'.str_replace('`','``',$table).'`')->fetchAll(PDO::FETCH_ASSOC);
        $rows=array_map('serialize',$rows); sort($rows); $out[$table]=$rows;
    }
    return hash('sha256',serialize($out));
}
function runCli(PDO $pdo, int $expectedExit, ?string $code=null): array {
    $before=fingerprint($pdo);
    $process=proc_open([PHP_BINARY,__DIR__.'/production-login-preflight.php'],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
    check(is_resource($process),'CLI_START');
    $stdout=stream_get_contents($pipes[1]); $stderr=stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]); $exit=proc_close($process);
    check($exit===$expectedExit,'CLI_EXIT'); check($before===fingerprint($pdo),'DATABASE_CHANGED');
    check(!preg_match('/fixture-secret|Private Person|password_hash|subjects|\$2y\$/',$stdout.$stderr),'REPORT_LEAK');
    if($expectedExit===2) {check($stdout==='' && trim($stderr)==='PRODUCTION_PREFLIGHT_CONTEXT_REJECTED','CLI_CONTEXT_REPORT'); return [];}
    check($stderr==='','CLI_STDERR'); $report=json_decode($stdout,true,512,JSON_THROW_ON_ERROR);
    check($report['releaseReady']===false,'FALSE_RELEASE_READINESS');
    if($code!==null) check(in_array($code,array_column($report['findings'],'code'),true),'MISSING_FINDING');
    return $report;
}
putenv('LEHRFAHRER_DB_USER=lf_preflight_reader'); putenv('LEHRFAHRER_DB_PASSWORD=fixture-reader-only');
putenv('LEHRFAHRER_PRODUCTION_PREFLIGHT=READ_ONLY'); putenv('LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE='.$name);
$report=runCli($pdo,0); check($report['counts']['legacyUsers']===4,'INVENTORY_COUNTS');
// Root connection demonstrates that READ ONLY itself rejects writes after the scanner returns.
$reader=new PDO($cfg['dsn'],$cfg['user'],$cfg['password'],$cfg['options']);
$before=fingerprint($pdo); check(lehrfahrer_production_login_preflight($reader)['inventoryStatus']==='PASS','FUNCTION_PASS');
$reader->beginTransaction(); $denied=false;
try {$reader->exec("UPDATE control_metadata SET value='forbidden' WHERE `key`='auth_mode'");} catch(PDOException $e) {$denied=true;}
$reader->rollBack(); check($denied && $before===fingerprint($pdo),'READ_ONLY_WRITE_NOT_BLOCKED');
putenv('LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE=wrong_fixture'); runCli($pdo,2);
putenv('LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE='.$name);
$pdo->exec("UPDATE control_metadata SET value='staging' WHERE `key`='environment'"); runCli($pdo,1,'DATABASE_ENVIRONMENT_MISMATCH');
$pdo->exec("UPDATE control_metadata SET value='production' WHERE `key`='environment'");
$pdo->exec("UPDATE control_metadata SET value='LOCKED' WHERE `key`='auth_cutover_lock'"); runCli($pdo,1,'AUTH_STATE_NOT_INITIAL_PARALLEL_OPEN');
$pdo->exec("UPDATE control_metadata SET value='OPEN' WHERE `key`='auth_cutover_lock'");
$users->create($company['id'],['login'=>'fixture-secret-0','display_name'=>'Private Person','password'=>'Fixture-password-12345!']);
runCli($pdo,1,'GLOBAL_LOGIN_COLLISION_EXACT');
$pdo->exec("INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at) VALUES ('partial','partial','Private Person','unknown',1,0,'now','now')");
runCli($pdo,1,'TARGET_TABLE_NOT_EMPTY');
$pdo->exec('DELETE FROM schema_migrations'); runCli($pdo,1,'UNEXPECTED_SCHEMA_VERSION');
echo "PASS: isolated MariaDB CLI, SELECT-only user, transaction write rejection, unchanged data, context/state/collision/partial/schema guards, sanitized reports\n";
