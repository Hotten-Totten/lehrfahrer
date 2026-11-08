<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/_account_auth.php';

/** Server CLI only, under an already owned maintenance lock. No browser caller. */
function lehrfahrer_production_mfa_prepare(PDO $pdo, string $accountId, string $owner, bool $recover): string {
    if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD']) || lehrfahrer_environment() !== 'production'
        || !lehrfahrer_account_login_enabled() || !preg_match('/^[0-9]+-[0-9]+$/D', $owner)
        || !preg_match('/^acc_[a-f0-9]{32}$/D', $accountId)) throw new RuntimeException('MAINTENANCE_CONTEXT');
    $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
    $lock = $mysql ? lehrfahrer_auth_cutover_lock_name($pdo) : '';
    if ($mysql) {
        $q=$pdo->prepare('SELECT GET_LOCK(?, 15)'); $q->execute([$lock]);
        if ((int)$q->fetchColumn()!==1) throw new RuntimeException('MAINTENANCE_BUSY');
    }
    try {
        if ($mysql) $pdo->beginTransaction(); else lehrfahrer_auth_cutover_begin_sqlite($pdo);
        $state=lehrfahrer_auth_cutover_state($pdo);
        $q=$pdo->prepare('SELECT value FROM control_metadata WHERE `key`=?');
        $q->execute(['environment']);
        if ($q->fetchColumn()!=='production') throw new RuntimeException('DATABASE_ENVIRONMENT');
        $q->execute(['auth_cutover_owner']);
        if ($state['lock']!=='LOCKED' || $state['mode']!=='ACCOUNT_PRIMARY' || $q->fetchColumn()!==$owner) throw new RuntimeException('MAINTENANCE_OWNER');
        $q=$pdo->prepare('SELECT a.id FROM accounts a JOIN sysop_assignment s ON s.account_id=a.id WHERE a.id=? AND a.active=1 AND a.must_change_password=0');
        $q->execute([$accountId]);
        if (count($q->fetchAll())!==1) throw new RuntimeException('SYSOP_TARGET');
        $rpId=lehrfahrer_sysop_mfa_rp_id();
        $q=$pdo->prepare("SELECT COUNT(*) FROM account_passkeys WHERE account_id=? AND rp_id=? AND status='active'"); $q->execute([$accountId,$rpId]);
        if (!$recover && (int)$q->fetchColumn()!==0) throw new RuntimeException('EXISTING_PASSKEY');
        $now=lehrfahrer_auth_timestamp(time());
        if ($recover) {
            $q=$pdo->prepare("UPDATE account_passkeys SET status='revoked',revoked_at=? WHERE account_id=? AND rp_id=? AND status='active'");
            $q->execute([$now,$accountId,$rpId]);
        }
        $q=$pdo->prepare('UPDATE account_mfa_pending SET consumed_at=? WHERE account_id=? AND environment=? AND consumed_at IS NULL'); $q->execute([$now,$accountId,'production']);
        $q=$pdo->prepare('UPDATE account_sessions SET revoked_at=? WHERE account_id=? AND environment=? AND revoked_at IS NULL'); $q->execute([$now,$accountId,'production']);
        $code=lehrfahrer_auth_random_token(); $key='mfa_enroll_'.$accountId;
        $q=$pdo->prepare('DELETE FROM control_metadata WHERE `key`=?'); $q->execute([$key]);
        $value=json_encode(['environment'=>'production','hash'=>hash('sha256',$code),'expires'=>time()+600],JSON_THROW_ON_ERROR);
        $q=$pdo->prepare('INSERT INTO control_metadata (`key`,value,updated_at) VALUES (?,?,?)'); $q->execute([$key,$value,$now]);
        $actor=LehrfahrerAuditActor::authorizedCli();
        lehrfahrer_audit_append($pdo,$actor,['action'=>'AUTH_MFA_ENROLL_AUTHORIZE','objectType'=>'ACCOUNT','objectId'=>$accountId,'result'=>'SUCCESS']);
        if ($recover) lehrfahrer_audit_append($pdo,$actor,['action'=>'AUTH_MFA_RECOVERY','objectType'=>'ACCOUNT','objectId'=>$accountId,'result'=>'SUCCESS']);
        lehrfahrer_audit_append($pdo,$actor,['action'=>'AUTH_SESSION_REVOKE','objectType'=>'SESSION','result'=>'SUCCESS']);
        if ($mysql) $pdo->commit(); else lehrfahrer_control_sqlite_finish($pdo,true);
        return $code;
    } catch(Throwable $e) {
        if (lehrfahrer_control_transaction_active($pdo)) {
            if ($mysql) $pdo->rollBack(); else lehrfahrer_control_sqlite_finish($pdo,false);
        }
        throw $e;
    } finally {
        if ($mysql) { $q=$pdo->prepare('SELECT RELEASE_LOCK(?)'); $q->execute([$lock]); }
    }
}

if (realpath((string)($_SERVER['SCRIPT_FILENAME']??''))===__FILE__) {
    // No auto-migrating connection; the approved release must already be installed.
    try {
        if (PHP_SAPI!=='cli' || isset($_SERVER['REQUEST_METHOD']) || getenv('LEHRFAHRER_MFA_MAINTENANCE')!=='APPROVED'
            || getenv('LEHRFAHRER_ENV')!=='production' || !lehrfahrer_account_login_enabled()) throw new RuntimeException();
        $options=getopt('', ['action:','account:','owner:','output:','restore-point:']);
        $action=$options['action']??''; $owner=$options['owner']??'';
        if (!in_array($action,['prepare','recover','open'],true) || !preg_match('/^[0-9]+-[0-9]+$/D',$owner)) throw new RuntimeException();
        $config=lehrfahrer_control_mysql_configuration(); $pdo=new PDO($config['dsn'],$config['user'],$config['password'],$config['options']);
        $expected=(string)getenv('LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE');
        if ($expected==='' || !hash_equals($expected,(string)$pdo->query('SELECT DATABASE()')->fetchColumn())) throw new RuntimeException();
        $q=$pdo->prepare('SELECT value FROM control_metadata WHERE `key`=?'); $q->execute(['environment']);
        if ($q->fetchColumn()!=='production' || (int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn()!==LEHRFAHRER_CONTROL_SCHEMA_VERSION) throw new RuntimeException();
        require_once __DIR__.'/control-db-recovery-drill.php';
        $private=(string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR');
        $privateReal=realpath($private); $publicReal=realpath(dirname(__DIR__));
        if (!$privateReal || is_link($private) || !$publicReal
            || str_starts_with(strtolower(str_replace('\\','/',$privateReal)).'/',strtolower(str_replace('\\','/',$publicReal)).'/')) throw new RuntimeException();
        $point=lehrfahrer_latest_restore_point($private,$options['restore-point']??'');
        if (($point['manifest']['database']??null)!==cottbusControlDbIdentity($config['dsn'])
            || ($point['manifest']['schema_version']??null)!==LEHRFAHRER_CONTROL_SCHEMA_VERSION) throw new RuntimeException();
        if ($action==='open') {
            lehrfahrer_auth_cutover_set_lock($pdo,'OPEN',$owner);
        } else {
            $output=$options['output']??''; $parent=realpath(dirname($output)); $privateReal=realpath($private);
            if (!$privateReal || !$parent || !str_starts_with($parent.DIRECTORY_SEPARATOR,$privateReal.DIRECTORY_SEPARATOR)
                || file_exists($output) || is_link($output)) throw new RuntimeException();
            // Reserve the private output before any mutation. Never print the code.
            $handle=fopen($output,'x'); if (!$handle || !chmod($output,0600)) throw new RuntimeException();
            if (lehrfahrer_auth_cutover_state($pdo)['lock']==='OPEN') lehrfahrer_auth_cutover_set_lock($pdo,'LOCKED',$owner);
            $code=lehrfahrer_production_mfa_prepare($pdo,$options['account']??'',$owner,$action==='recover');
            if (fwrite($handle,$code."\n")!==strlen($code)+1) throw new RuntimeException(); fclose($handle);
        }
        echo "MFA_MAINTENANCE_OK\n";
    } catch(Throwable $e) {
        // On failure the operator must inspect/recover explicitly; no auto-unlock.
        file_put_contents('php://stderr',"MFA_MAINTENANCE_BLOCKED\n"); exit(2);
    }
}
