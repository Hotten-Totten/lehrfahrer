<?php
declare(strict_types=1);

function audit_check(bool $value, string $label): void {
    if (!$value) throw new RuntimeException($label);
    echo "PASS $label\n";
}
function audit_rejected(callable $action, string $label): void {
    try { $action(); } catch (InvalidArgumentException $error) { audit_check(true, $label); return; }
    throw new RuntimeException($label);
}

$base = sys_get_temp_dir() . '/lf-audit-' . bin2hex(random_bytes(8));
mkdir($base . '/webroot', 0700, true);
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . $base);
putenv('LEHRFAHRER_DB_DRIVER=sqlite');
putenv('LEHRFAHRER_ENV=dev');
$_SERVER['DOCUMENT_ROOT'] = $base . '/webroot';
require dirname(__DIR__) . '/api/_audit.php';
$pdo = lehrfahrer_control_database();
audit_check((int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn() === 10, 'Schema 10');
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 0, 'Migration ohne Events');
$actor = LehrfahrerAuditActor::authorizedCli();
$event = ['action' => 'SYSTEM_CHANGE', 'objectType' => 'SYSTEM', 'result' => 'SUCCESS'];
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
lehrfahrer_control_apply_audit_schema($legacy);
$legacyFields = [1, 'aud_' . str_repeat('a', 32), '2026-01-01T00:00:00Z', null, 'SYSTEM', null,
    null, null, null, 'SYSTEM_CHANGE', 'SYSTEM', null, 'SUCCESS', null];
$legacyHash = hash('sha256', LEHRFAHRER_AUDIT_GENESIS_HASH . "\n" . lehrfahrer_audit_canonical($legacyFields));
$legacy->prepare('INSERT INTO audit_events
    (sequence_number,event_id,occurred_at,account_id,context_type,membership_id,company_id,
     role_snapshot,capability_snapshot,action,object_type,object_id,result,reason_code,previous_hash,event_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([...$legacyFields, LEHRFAHRER_AUDIT_GENESIS_HASH, $legacyHash]);
$legacy->prepare('UPDATE audit_chain_state SET last_sequence=1,last_hash=? WHERE singleton_key=1')->execute([$legacyHash]);
lehrfahrer_control_apply_audit_related_targets($legacy);
audit_check(lehrfahrer_audit_verify_chain($legacy)
    && $legacy->query('SELECT event_hash FROM audit_events WHERE sequence_number=1')->fetchColumn() === $legacyHash,
    'Bestehendes Format-1-Event nach additiver Migration unveraendert/verifizierbar');
lehrfahrer_audit_append($legacy, $actor, $event);
audit_check(lehrfahrer_audit_verify_chain($legacy)
    && $legacy->query('SELECT hash_format FROM audit_events WHERE sequence_number=1')->fetchColumn() == 1
    && $legacy->query('SELECT hash_format FROM audit_events WHERE sequence_number=2')->fetchColumn() == 2,
    'Alte und neue Hashformate in derselben Kette');
$first = lehrfahrer_audit_append($pdo, $actor, $event);
$second = lehrfahrer_audit_append($pdo, $actor, $event, LEHRFAHRER_AUDIT_OPERATIONAL);
audit_check($first['eventId'] !== $second['eventId'] && $second['sequence'] === 2, 'Eindeutige IDs und Reihenfolge');
audit_check((bool)preg_match('/^aud_[a-f0-9]{32}$/D', $first['eventId']), 'Event-ID serverseitig');
$timestamp = $pdo->query('SELECT occurred_at FROM audit_events WHERE sequence_number=1')->fetchColumn();
audit_check((bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/D', $timestamp), 'UTC-Zeit');
audit_check(lehrfahrer_audit_verify_chain($pdo), 'Hashkette gueltig');
$pdo->beginTransaction();
$nested = lehrfahrer_audit_append($pdo, $actor, $event);
audit_check($nested['sequence'] === 3, 'Append innerhalb fremder Transaktion');
$pdo->rollBack();
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 2
    && lehrfahrer_audit_verify_chain($pdo), 'Fremder Rollback entfernt Event und Kettenkopf');
$pdo->exec('CREATE TABLE audit_fixture (value TEXT NOT NULL)');
lehrfahrer_control_sqlite_begin_immediate($pdo);
audit_check(lehrfahrer_control_transaction_active($pdo), 'Manuelles BEGIN IMMEDIATE registriert');
$pdo->exec("INSERT INTO audit_fixture (value) VALUES ('commit')");
$manualFirst = lehrfahrer_audit_append($pdo, $actor, $event);
$manualSecond = lehrfahrer_audit_append($pdo, $actor, $event);
audit_check($manualFirst['sequence'] === 3 && $manualSecond['sequence'] === 4,
    'Zwei Writes innerhalb derselben manuellen Transaktion');
$other = new PDO('sqlite:' . lehrfahrer_control_database_path());
audit_check((int)$other->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 2
    && (int)$other->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 0,
    'Writer committet fremde Transaktion nicht');
lehrfahrer_control_sqlite_finish($pdo, true);
audit_check((int)$other->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 4
    && (int)$other->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 1
    && lehrfahrer_audit_verify_chain($pdo), 'Aeusserer Commit persistiert Fachwert und Audit');
lehrfahrer_control_sqlite_begin_immediate($pdo);
$pdo->exec("INSERT INTO audit_fixture (value) VALUES ('rollback')");
lehrfahrer_audit_append($pdo, $actor, $event);
lehrfahrer_control_sqlite_finish($pdo, false);
audit_check((int)$other->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 4
    && (int)$other->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 1
    && lehrfahrer_audit_verify_chain($pdo), 'Aeusserer Rollback entfernt Fachwert und Audit');
lehrfahrer_control_sqlite_begin_immediate($pdo);
$pdo->exec("INSERT INTO audit_fixture (value) VALUES ('audit-error')");
$pdo->exec('DELETE FROM audit_chain_state');
try { lehrfahrer_audit_append($pdo, $actor, $event); throw new RuntimeException('CRITICAL nicht abgebrochen'); }
catch (LehrfahrerAuditWriteFailure $error) {
    audit_check($error->mode === LEHRFAHRER_AUDIT_CRITICAL
        && lehrfahrer_control_transaction_active($pdo)
        && (int)$pdo->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 2,
        'Audit-Fehler uebergeben; Writer rollt fremde Transaktion nicht zurueck');
}
try { lehrfahrer_audit_append($pdo, $actor, $event, LEHRFAHRER_AUDIT_OPERATIONAL);
    throw new RuntimeException('OPERATIONAL nicht gemeldet'); }
catch (LehrfahrerAuditWriteFailure $error) {
    audit_check($error->mode === LEHRFAHRER_AUDIT_OPERATIONAL
        && lehrfahrer_control_transaction_active($pdo),
        'OPERATIONAL-Fehler laesst fremde Transaktion beim Aufrufer');
}
lehrfahrer_control_sqlite_finish($pdo, false);
audit_check((int)$other->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 1
    && lehrfahrer_audit_verify_chain($pdo), 'Aufrufer-Rollback nach Audit-Fehler stellt Kette wieder her');
lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $actor, $event): void {
    audit_check(lehrfahrer_control_transaction_active($pdo), 'Auth-Gate meldet manuelle Transaktion');
    lehrfahrer_audit_append($pdo, $actor, $event);
});
audit_check((int)$other->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 5
    && lehrfahrer_audit_verify_chain($pdo), 'Auth-Gate und Audit-Writer teilen Transaktion');
try {
    lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $actor, $event): void {
        $pdo->exec("INSERT INTO audit_fixture (value) VALUES ('gate-failure')");
        $pdo->exec('DELETE FROM audit_chain_state');
        lehrfahrer_audit_append($pdo, $actor, $event);
    });
    throw new RuntimeException('Auth-Gate hat Audit-Fehler nicht weitergegeben');
} catch (LehrfahrerAuditWriteFailure $error) {
    audit_check($error->mode === LEHRFAHRER_AUDIT_CRITICAL
        && !lehrfahrer_control_transaction_active($pdo)
        && (int)$other->query('SELECT COUNT(*) FROM audit_fixture')->fetchColumn() === 1
        && lehrfahrer_audit_verify_chain($pdo), 'Auth-Gate rollt Fachmutation bei CRITICAL-Fehler zurueck');
}
foreach ([
    ['action' => 'FREE_TEXT'], ['result' => 'UNKNOWN'], ['password' => 'secret'],
    ['payload' => ['secret' => true]], ['request' => 'Authorization: secret'],
    ['objectType' => 'ACCOUNT'], ['reasonCode' => 'arbitrary text'],
] as $invalid) audit_rejected(fn() => lehrfahrer_audit_append($pdo, $actor, array_replace($event, $invalid)),
    'Vertrag weist unerlaubtes Feld/Wert ab');
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 5, 'Keine Aenderung durch abgelehnte Events');
$company = (new LehrfahrerCompanyRepository($pdo))->create(['slug'=>'audit-target-test','name'=>'Audit Test',
    'status'=>'active','license_status'=>'active']);
$accountId = lehrfahrer_control_id('acc');
$membershipId = lehrfahrer_control_id('mem');
$now = gmdate('c');
$pdo->prepare('INSERT INTO accounts (id,login_normalized,display_name,password_hash,active,must_change_password,created_at,updated_at)
    VALUES (?,?,?,?,1,0,?,?)')->execute([$accountId,'audit-fixture','Audit Fixture',password_hash('fixture-only',PASSWORD_DEFAULT),$now,$now]);
$pdo->prepare("INSERT INTO account_memberships (id,account_id,company_id,status,created_at,updated_at)
    VALUES (?,?,?,'active',?,?)")->execute([$membershipId,$accountId,$company['id'],$now,$now]);
$adminRole = $pdo->query("SELECT id FROM roles WHERE code='ADMIN'")->fetchColumn();
$pdo->prepare('INSERT INTO membership_roles (membership_id,role_id) VALUES (?,?)')->execute([$membershipId,$adminRole]);
$session = lehrfahrer_account_create_session($pdo,$accountId,'TENANT',$membershipId);
$_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $session['token'];
$tenantActor = LehrfahrerAuditActor::currentAccount($pdo);
$tenantRole = ['action'=>'TENANT_ROLE_CHANGE','objectType'=>'MEMBERSHIP','objectId'=>$membershipId,
    'relatedObjectType'=>'TENANT_ROLE','relatedObjectId'=>'role_fahrer','result'=>'SUCCESS'];
$platformRole = ['action'=>'PLATFORM_ROLE_CHANGE','objectType'=>'ACCOUNT','objectId'=>$accountId,
    'relatedObjectType'=>'PLATFORM_ROLE','relatedObjectId'=>'prole_sysop','result'=>'SUCCESS'];
lehrfahrer_audit_append($pdo,$tenantActor,$tenantRole);
lehrfahrer_audit_append($pdo,$tenantActor,$platformRole);
$targets = $pdo->query('SELECT object_type,object_id,related_object_type,related_object_id,role_snapshot
    FROM audit_events WHERE action IN (\'TENANT_ROLE_CHANGE\',\'PLATFORM_ROLE_CHANGE\') ORDER BY sequence_number')
    ->fetchAll(PDO::FETCH_ASSOC);
audit_check($targets[0]['object_id'] === $membershipId && $targets[0]['related_object_type'] === 'TENANT_ROLE'
    && $targets[0]['related_object_id'] === 'role_fahrer' && $targets[0]['role_snapshot'] === 'ADMIN'
    && $targets[1]['object_id'] === $accountId && $targets[1]['related_object_type'] === 'PLATFORM_ROLE'
    && $targets[1]['related_object_id'] === 'prole_sysop' && $targets[1]['role_snapshot'] === 'ADMIN'
    && lehrfahrer_audit_verify_chain($pdo), 'Getrennte Actor- und typisierte Zielbeziehungen');
foreach ([['relatedObjectType'=>'ACCOUNT'], ['relatedObjectId'=>'prole_sysop'],
    ['objectId'=>$accountId],
    ['relatedObjectId'=>'free text'], ['payload'=>'secret']] as $invalid) {
    audit_rejected(fn() => lehrfahrer_audit_append($pdo,$tenantActor,array_replace($tenantRole,$invalid)),
        'Ungueltige Zielbeziehung oder freies Feld abgewiesen');
}
$lastSequence = (int)$pdo->query('SELECT MAX(sequence_number) FROM audit_events')->fetchColumn();
$pdo->prepare('UPDATE audit_events SET related_object_id=? WHERE sequence_number=?')
    ->execute(['prole_cosysop',$lastSequence]);
audit_check(!lehrfahrer_audit_verify_chain($pdo), 'Related Target-Manipulation erkannt');
$pdo->prepare('UPDATE audit_events SET related_object_id=? WHERE sequence_number=?')
    ->execute(['prole_sysop',$lastSequence]);
audit_check(lehrfahrer_audit_verify_chain($pdo), 'Related Target-Wiederherstellung verifiziert');
$pdo->prepare('UPDATE audit_events SET hash_format=1 WHERE sequence_number=?')->execute([$lastSequence]);
audit_check(!lehrfahrer_audit_verify_chain($pdo), 'Hashformat-Downgrade erkannt');
$pdo->prepare('UPDATE audit_events SET hash_format=2 WHERE sequence_number=?')->execute([$lastSequence]);
audit_check(lehrfahrer_audit_verify_chain($pdo), 'Hashformat-Wiederherstellung verifiziert');
audit_rejected(fn() => lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::unauthenticated(), $event),
    'Preauth-Kontext kann keine Systemaktion behaupten');
audit_check(!function_exists('lehrfahrer_audit_update') && !function_exists('lehrfahrer_audit_delete'),
    'Auch nach A6 keine Audit-Schreibschnittstelle zum Aendern oder Loeschen');
$pdo->exec("UPDATE audit_events SET action='ROUTE_SAVE' WHERE sequence_number=1");
audit_check(!lehrfahrer_audit_verify_chain($pdo), 'Manipulation erkannt');
$pdo->exec("UPDATE audit_events SET action='SYSTEM_CHANGE' WHERE sequence_number=1");
$pdo->exec('DELETE FROM audit_chain_state');
foreach ([LEHRFAHRER_AUDIT_CRITICAL, LEHRFAHRER_AUDIT_OPERATIONAL] as $mode) {
    try { lehrfahrer_audit_append($pdo, $actor, $event, $mode); }
    catch (LehrfahrerAuditWriteFailure $error) {
        audit_check($error->mode === $mode, "$mode sichtbar und abbrechbar");
        continue;
    }
    throw new RuntimeException("$mode muss bei Speicherfehler scheitern");
}
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 7, 'Fehler erzeugt keinen Teil-Event');
audit_check(!function_exists('lehrfahrer_audit_update') && !function_exists('lehrfahrer_audit_delete'),
    'Runtime-Writer ohne Update/Delete');

// The Control-DB factory retains a process-local PDO. Windows cannot unlink
// its open SQLite file; the isolated temporary fixture is left for OS cleanup.
