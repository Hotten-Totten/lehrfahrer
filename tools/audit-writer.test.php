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
audit_check((int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn() === 9, 'Schema 9');
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 0, 'Migration ohne Events');
$actor = LehrfahrerAuditActor::authorizedCli();
$event = ['action' => 'SYSTEM_CHANGE', 'objectType' => 'SYSTEM', 'result' => 'SUCCESS'];
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
foreach ([
    ['action' => 'FREE_TEXT'], ['result' => 'UNKNOWN'], ['password' => 'secret'],
    ['payload' => ['secret' => true]], ['request' => 'Authorization: secret'],
    ['objectType' => 'ACCOUNT'], ['reasonCode' => 'arbitrary text'],
] as $invalid) audit_rejected(fn() => lehrfahrer_audit_append($pdo, $actor, array_replace($event, $invalid)),
    'Vertrag weist unerlaubtes Feld/Wert ab');
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 2, 'Keine Aenderung durch abgelehnte Events');
audit_rejected(fn() => lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::unauthenticated(), $event),
    'Preauth-Kontext kann keine Systemaktion behaupten');
audit_check(!is_file(dirname(__DIR__) . '/api/audit_read.php')
    && !is_file(dirname(__DIR__) . '/api/list_audit.php'), 'Keine Audit-Lese-API in A1');
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
audit_check((int)$pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn() === 2, 'Fehler erzeugt keinen Teil-Event');
audit_check(!function_exists('lehrfahrer_audit_update') && !function_exists('lehrfahrer_audit_delete'),
    'Runtime-Writer ohne Update/Delete');

// The Control-DB factory retains a process-local PDO. Windows cannot unlink
// its open SQLite file; the isolated temporary fixture is left for OS cleanup.
