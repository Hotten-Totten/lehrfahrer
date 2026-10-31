<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
require_once $appRoot . '/api/_auth_cutover_gate.php';
require_once __DIR__ . '/control-db-recovery-drill.php';

function lehrfahrer_live_recovery_context(): array {
    if (lehrfahrer_environment() !== 'staging' || (string)getenv('LEHRFAHRER_ENV') !== 'staging') {
        throw new RuntimeException('Recovery ist ausschliesslich auf Staging erlaubt.');
    }
    $private = (string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR');
    $run = (string)getenv('LEHRFAHRER_RECOVERY_RUN_ID');
    if ($private === '' || !is_dir($private) || is_link($private) || !preg_match('/^[0-9]+-[0-9]+$/D', $run)) {
        throw new RuntimeException('Privater Recovery-Kontext fehlt.');
    }
    $configuration = lehrfahrer_control_mysql_configuration();
    $configuration['tls_ca'] = trim((string)getenv('LEHRFAHRER_DB_TLS_CA')) ?: null;
    $pdo = cottbusPdoConnection($configuration);
    if (lehrfahrer_control_driver($pdo) !== 'mysql') throw new RuntimeException('MariaDB ist erforderlich.');
    $environment = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
    $environment->execute(['environment']);
    if (!hash_equals('staging', (string)$environment->fetchColumn())) {
        throw new RuntimeException('Control-DB ist nicht eindeutig Staging.');
    }
    $schemaVersion = (int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn();
    if ($schemaVersion !== LEHRFAHRER_CONTROL_SCHEMA_VERSION) {
        throw new RuntimeException('Control-DB-Schema weicht ab.');
    }
    $marker = $private . '/auth-recovery-drill.json';
    if (is_link($marker)) throw new RuntimeException('Recovery-Marker ist unsicher.');
    $restoreId = null;
    if (in_array((string)getenv('LEHRFAHRER_RECOVERY_ACTION'), ['recover', 'cancel'], true)) {
        $permissions = is_file($marker) ? fileperms($marker) : false;
        if ($permissions === false || ($permissions & 0077) !== 0) {
            throw new RuntimeException('Privater Recovery-Marker fehlt.');
        }
        $record = json_decode((string)file_get_contents($marker), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($record) || !is_string($record['restore_point'] ?? null)) {
            throw new RuntimeException('Recovery-Marker ist ungueltig.');
        }
        $restoreId = $record['restore_point'];
    }
    $point = lehrfahrer_latest_restore_point($private, $restoreId);
    $identity = cottbusControlDbIdentity((string)$configuration['dsn']);
    if (!hash_equals((string)$identity['database'], (string)($point['manifest']['database']['database'] ?? ''))) {
        throw new RuntimeException('Restore-Punkt gehoert nicht zur Control-DB.');
    }
    if ((int)($point['manifest']['schema_version'] ?? -1) !== $schemaVersion) {
        throw new RuntimeException('Restore-Punkt-Schema weicht ab.');
    }
    return [$pdo, $point, $marker, $run];
}

function lehrfahrer_live_recovery_assert_no_operation(PDO $pdo): void {
    $query = $pdo->query("SELECT `key` FROM control_metadata WHERE `key` LIKE 'auth_cutover_%' AND `key` <> 'auth_cutover_lock'");
    if ($query->fetchColumn() !== false) throw new RuntimeException('Andere Cutover-Operation ist markiert.');
}

function lehrfahrer_live_recovery_marker(string $marker, string $run, array $point): array {
    $permissions = is_file($marker) ? fileperms($marker) : false;
    if ($permissions === false || is_link($marker) || ($permissions & 0077) !== 0) {
        throw new RuntimeException('Passender privater Recovery-Marker fehlt.');
    }
    $data = json_decode((string)file_get_contents($marker), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !hash_equals($run, (string)($data['run'] ?? ''))
        || !hash_equals(basename((string)$point['directory']), (string)($data['restore_point'] ?? ''))
        || !hash_equals((string)$point['manifest']['sha256'], (string)($data['sha256'] ?? ''))) {
        throw new RuntimeException('Recovery-Marker passt nicht zum Restore-Punkt und Vorgang.');
    }
    return $data;
}

function lehrfahrer_live_recovery_run(): array {
    [$pdo, $point, $marker, $run] = lehrfahrer_live_recovery_context();
    $action = (string)getenv('LEHRFAHRER_RECOVERY_ACTION');
    $state = lehrfahrer_auth_cutover_state($pdo);
    if ($action === 'inspect') {
        return ['ok' => true, 'engine' => 'mariadb', 'mode' => $state['mode'], 'lock' => $state['lock'],
            'restore_point_valid' => true, 'marker_present' => is_file($marker)];
    }
    if ($action === 'lock') {
        if ($state !== ['mode' => 'PARALLEL', 'lock' => 'OPEN'] || file_exists($marker)) {
            throw new RuntimeException('Drill erwartet PARALLEL/OPEN ohne bestehenden Recovery-Marker.');
        }
        lehrfahrer_live_recovery_assert_no_operation($pdo);
        $data = json_encode(['run' => $run, 'restore_point' => basename((string)$point['directory']),
            'sha256' => (string)$point['manifest']['sha256']], JSON_THROW_ON_ERROR);
        $handle = fopen($marker, 'x');
        if ($handle === false) throw new RuntimeException('Recovery-Marker konnte nicht exklusiv angelegt werden.');
        try {
            if (!chmod($marker, 0600) || fwrite($handle, $data) !== strlen($data) || !fflush($handle)) {
                throw new RuntimeException('Recovery-Marker konnte nicht vollstaendig geschrieben werden.');
            }
        } catch (Throwable $error) {
            fclose($handle);
            unlink($marker);
            throw $error;
        } finally {
            if (is_resource($handle)) fclose($handle);
        }
        try {
            lehrfahrer_auth_cutover_set_lock($pdo, 'LOCKED');
        } catch (Throwable $error) {
            if (lehrfahrer_auth_cutover_state($pdo)['lock'] === 'OPEN') unlink($marker);
            throw $error;
        }
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
            throw new RuntimeException('Lock-Zustand nach Sperre ist inkonsistent.');
        }
        return ['ok' => true, 'mode' => 'PARALLEL', 'lock' => 'LOCKED'];
    }
    if ($action === 'recover') {
        lehrfahrer_live_recovery_marker($marker, $run, $point);
        lehrfahrer_live_recovery_assert_no_operation($pdo);
        if ($state !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
            throw new RuntimeException('Recovery erwartet exakt PARALLEL/LOCKED.');
        }
        lehrfahrer_auth_cutover_set_lock($pdo, 'OPEN');
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
            throw new RuntimeException('Recovery hat PARALLEL/OPEN nicht hergestellt.');
        }
        if (!unlink($marker)) throw new RuntimeException('Recovery-Marker konnte nicht entfernt werden.');
        return ['ok' => true, 'mode' => 'PARALLEL', 'lock' => 'OPEN'];
    }
    if ($action === 'cancel') {
        lehrfahrer_live_recovery_marker($marker, $run, $point);
        lehrfahrer_live_recovery_assert_no_operation($pdo);
        if ($state !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
            throw new RuntimeException('Marker-Abbruch ist nur ohne aktiven Lock erlaubt.');
        }
        if (!unlink($marker)) throw new RuntimeException('Recovery-Marker konnte nicht entfernt werden.');
        return ['ok' => true, 'mode' => 'PARALLEL', 'lock' => 'OPEN'];
    }
    throw new RuntimeException('Unbekannte Recovery-Aktion.');
}

if (getenv('LEHRFAHRER_RECOVERY_RUN') === '1') {
    try {
        echo json_encode(lehrfahrer_live_recovery_run(), JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable $error) {
        file_put_contents('php://stderr', 'Staging-Recovery fehlgeschlagen: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
