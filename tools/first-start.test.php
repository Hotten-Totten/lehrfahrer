<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/_first_start.php';

function setupCheck(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$private = sys_get_temp_dir() . '/lf-first-start-' . bin2hex(random_bytes(8));
mkdir($private, 0700);
putenv('LEHRFAHRER_PRIVATE_DATA_DIR='.$private);
putenv('LEHRFAHRER_ENV=production');
putenv('LEHRFAHRER_ACCOUNT_LOGIN_ENABLED=1');
putenv('LEHRFAHRER_PUBLIC_ORIGIN=https://lehrfahrer.example');
putenv('LEHRFAHRER_PASSKEY_RP_ID=lehrfahrer.example');
$code = lehrfahrer_auth_random_token();
putenv('LEHRFAHRER_FIRST_START_ENABLED=1');
putenv('LEHRFAHRER_FIRST_START_HASH='.hash('sha256',$code));
putenv('LEHRFAHRER_FIRST_START_EXPIRES='.(time()+900));
$mysql = getenv('LEHRFAHRER_FIRST_START_ISOLATED') === '1';
if ($mysql) {
    setupCheck(getenv('LEHRFAHRER_DB_HOST')==='127.0.0.1' && !getenv('LEHRFAHRER_DB_DSN')
        && preg_match('/^lf_first_start_fixture_[a-f0-9]+$/D',(string)getenv('LEHRFAHRER_DB_NAME'))===1, 'unsafe fixture connection');
    putenv('LEHRFAHRER_FIRST_START_DATABASE='.getenv('LEHRFAHRER_DB_NAME'));
    putenv('LEHRFAHRER_DB_DRIVER=mysql');
    putenv('LEHRFAHRER_FIRST_START_PREPARE=1');
    $process=proc_open([PHP_BINARY,__DIR__.'/first-start-prepare.php'],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
    setupCheck(is_resource($process),'fixture preparation process');
    $out=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
    setupCheck(proc_close($process)===0 && trim($out)==='FIRST_START_PREPARED' && $err==='', 'MariaDB CLI preparation');
    $pdo=lehrfahrer_first_start_connection();
} else {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    lehrfahrer_control_migrate($pdo);
    lehrfahrer_control_bind_environment($pdo,'production');
    $insert=$pdo->prepare('INSERT INTO control_metadata (`key`,value,updated_at) VALUES (?,?,?)');
    foreach (['auth_mode'=>'ACCOUNT_PRIMARY','auth_cutover_lock'=>'OPEN','first_start_pending'=>hash('sha256',realpath($private))] as $key=>$value) $insert->execute([$key,$value,gmdate('c')]);
}

$input=['setup_code'=>$code,'name'=>'Fixture GmbH','slug'=>'fixture-company','admin_display_name'=>'Fixture Operator',
    'admin_login'=>'fixture-owner','password'=>'fixture-password-12345','password_confirm'=>'fixture-password-12345'];
setupCheck(lehrfahrer_first_start_empty($pdo),'fresh state');
try { lehrfahrer_first_start($pdo,['setup_code'=>str_repeat('x',43)]+$input); throw new LogicException('wrong code accepted'); }
catch (InvalidArgumentException $expected) {}
putenv('LEHRFAHRER_FIRST_START_EXPIRES='.(time()-1));
try { lehrfahrer_first_start($pdo,$input); throw new LogicException('expired code accepted'); }
catch (InvalidArgumentException $expected) {}
putenv('LEHRFAHRER_FIRST_START_EXPIRES='.(time()+900));
$pdo->exec($mysql
    ? "CREATE TRIGGER first_start_fixture_fail BEFORE INSERT ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'"
    : "CREATE TRIGGER first_start_fixture_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
try { lehrfahrer_first_start($pdo,$input); throw new LogicException('audit failure accepted'); }
catch (LehrfahrerAuditWriteFailure $expected) {}
setupCheck(lehrfahrer_first_start_empty($pdo),'failed setup rolls back DB and new company files');
$pdo->exec('DROP TRIGGER first_start_fixture_fail');
if ($mysql) {
    $listener=stream_socket_server('tcp://127.0.0.1:0');
    $address=stream_socket_get_name($listener,false); fclose($listener);
    $server=proc_open([PHP_BINARY,'-S',$address,'-t',dirname(__DIR__)],[], $serverPipes);
    setupCheck(is_resource($server),'HTTP fixture server');
    try {
        for ($attempt=0;$attempt<30;$attempt++) {
            $socket=@stream_socket_client('tcp://'.$address, $errno, $message, 0.1);
            if ($socket) { fclose($socket); break; }
            usleep(100000);
        }
        setupCheck($attempt<30,'HTTP fixture server reachable');
        $url='http://'.$address.'/first-start.php';
        $request=static function (array $data, string $origin) use ($url): array {
            $body=file_get_contents($url,false,stream_context_create(['http'=>[
                'method'=>'POST','header'=>"Origin: $origin\r\nContent-Type: application/x-www-form-urlencoded\r\n",
                'content'=>http_build_query($data),'ignore_errors'=>true,'timeout'=>5,
            ]]));
            return [$http_response_header[0]??'',(string)$body];
        };
        setupCheck(!str_contains((string)file_get_contents($url),'Frank Fudeus'),'details hidden before code');
        [$status]=$request(['action'=>'create']+$input,'https://foreign.example');
        setupCheck(str_contains($status,'403'),'foreign origin rejected');
        [$status,$body]=$request(['setup_code'=>$code],'https://lehrfahrer.example');
        setupCheck(str_contains($status,'200') && str_contains($body,'Cottbusverkehr GmbH') && str_contains($body,'Frank Fudeus'),'authorized form defaults');
        [$status,$body]=$request(['action'=>'create']+$input,'https://lehrfahrer.example');
        setupCheck(str_contains($status,'200') && preg_match('~<code>([A-Za-z0-9_-]{43})</code>~',$body,$match)===1,'setup form completes');
        $result=['enrollmentCode'=>$match[1]];
        [$status]=$request(['action'=>'create']+$input,'https://lehrfahrer.example');
        setupCheck(str_contains($status,'404'),'HTTP replay closed');
        echo "PASS isolated HTTP setup form, origin check and replay\n";
    } finally { proc_terminate($server); proc_close($server); }
} else {
    $result=lehrfahrer_first_start($pdo,$input);
}
setupCheck(!lehrfahrer_first_start_empty($pdo),'completed state is closed');
try { lehrfahrer_first_start($pdo,$input); throw new LogicException('setup replay accepted'); }
catch (RuntimeException $expected) { setupCheck($expected->getMessage()==='SETUP_ALREADY_USED','closed replay'); }
setupCheck((int)$pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn()===1,'one account');
$company=$pdo->query('SELECT id FROM companies')->fetchColumn();
$account=$pdo->query('SELECT account_id FROM sysop_assignment')->fetchColumn();
setupCheck(lehrfahrer_control_user_number_for_account($pdo,$account)===1,'reserved SysOp number');
setupCheck(in_array('audit.read',lehrfahrer_account_tenant_capabilities($pdo,$account,(string)$pdo->query('SELECT id FROM account_memberships')->fetchColumn()),true),'tenant admin permissions');
foreach (LEHRFAHRER_TENANT_AREAS as $area) {
    $entries=array_values(array_diff(scandir(lehrfahrer_tenant_area($company,$area)),['.','..']));
    setupCheck($entries===($area==='settings'?['company.json']:[]),'empty first company');
}
setupCheck(lehrfahrer_account_login($pdo,'fixture-owner',$input['password'])===null,'password alone cannot start MFA enrollment');
$pending=lehrfahrer_account_login($pdo,'fixture-owner',$input['password'],null,$result['enrollmentCode']);
setupCheck(($pending['purpose']??null)==='ENROLL' && (int)$pdo->query('SELECT COUNT(*) FROM account_sessions')->fetchColumn()===0,'grant opens only pending MFA');
setupCheck(lehrfahrer_account_login($pdo,'fixture-owner',$input['password'],null,$result['enrollmentCode'])===null,'single use MFA grant');
setupCheck(lehrfahrer_audit_verify_chain($pdo),'audit chain valid');
$audit=json_encode($pdo->query('SELECT * FROM audit_events')->fetchAll());
foreach ([$code,$input['password'],$result['enrollmentCode']] as $secret) setupCheck(!str_contains($audit,$secret),'audit leak');
echo "PASS first-start configuration, empty company, audit rollback, replay, role separation and MFA gate\n";
