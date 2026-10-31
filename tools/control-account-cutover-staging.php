<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
require_once $appRoot . '/api/_auth_cutover_gate.php';
require_once __DIR__ . '/control-account-cutover-preflight.php';
require_once __DIR__ . '/control-db-recovery-drill.php';

function lehrfahrer_cutover_context(): array {
    if ((string)getenv('LEHRFAHRER_ENV') !== 'staging' || lehrfahrer_environment() !== 'staging'
        || isset($_SERVER['REQUEST_METHOD']) || !in_array(PHP_SAPI, ['cli', 'cgi-fcgi'], true)) {
        throw new RuntimeException('Cutover ist nur administrativ auf Staging erlaubt.');
    }
    $private = (string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR');
    $run = (string)getenv('LEHRFAHRER_CUTOVER_RUN_ID');
    if ($private === '' || !is_dir($private) || is_link($private)
        || !preg_match('/^[0-9]+-[0-9]+$/D', $run)) {
        throw new RuntimeException('Privater Cutover-Kontext fehlt.');
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
    $marker = $private . '/auth-cutover-p24.json';
    if (is_link($marker)) throw new RuntimeException('Cutover-Marker ist unsicher.');
    $action = (string)getenv('LEHRFAHRER_CUTOVER_ACTION');
    $restoreId = null;
    if (in_array($action, ['open', 'recover', 'finalize'], true)) {
        $record = lehrfahrer_cutover_marker($marker, $run);
        $restoreId = (string)$record['restore_point'];
    }
    $point = lehrfahrer_latest_restore_point($private, $restoreId);
    $identity = cottbusControlDbIdentity((string)$configuration['dsn']);
    if (!hash_equals((string)$identity['database'], (string)($point['manifest']['database']['database'] ?? ''))
        || (int)($point['manifest']['schema_version'] ?? -1) !== LEHRFAHRER_CONTROL_SCHEMA_VERSION
        || (int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn() !== LEHRFAHRER_CONTROL_SCHEMA_VERSION) {
        throw new RuntimeException('Restore-Punkt oder DB-Schema passt nicht.');
    }
    if ($restoreId !== null && !hash_equals((string)$point['manifest']['sha256'], (string)$record['sha256'])) {
        throw new RuntimeException('Cutover-Marker passt nicht zum Restore-Punkt.');
    }
    return [$pdo, $point, $marker, $run];
}

function lehrfahrer_cutover_marker(string $path, string $run): array {
    $permissions = is_file($path) ? fileperms($path) : false;
    if ($permissions === false || is_link($path) || ($permissions & 0077) !== 0) {
        throw new RuntimeException('Privater Cutover-Marker fehlt.');
    }
    $record = json_decode((string)file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($record) || !hash_equals($run, (string)($record['run'] ?? ''))
        || !is_string($record['restore_point'] ?? null) || !is_string($record['sha256'] ?? null)) {
        throw new RuntimeException('Cutover-Marker passt nicht zum Vorgang.');
    }
    return $record;
}

function lehrfahrer_cutover_with_lock(PDO $pdo, callable $action): mixed {
    $name = lehrfahrer_auth_cutover_lock_name($pdo);
    $query = $pdo->prepare('SELECT GET_LOCK(?, 15)');
    $query->execute([$name]);
    if ((int)$query->fetchColumn() !== 1) throw new LehrfahrerAuthCutoverBusy('Auth-Sperre nicht verfuegbar.');
    try {
        $pdo->beginTransaction();
        try {
            $result = $action();
            $pdo->commit();
            return $result;
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$name]);
    }
}

function lehrfahrer_cutover_write_state(PDO $pdo, string $mode, string $lock): void {
    $now = gmdate('c');
    $query = $pdo->prepare('INSERT INTO control_metadata (`key`, value, updated_at) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)');
    $query->execute(['auth_mode', $mode, $now]);
    $query->execute(['auth_cutover_lock', $lock, $now]);
}

function lehrfahrer_cutover_assert_owner(PDO $pdo, string $run): void {
    $query = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
    $query->execute(['auth_cutover_owner']);
    $stored = $query->fetchColumn();
    if (!is_string($stored) || !hash_equals($run, $stored)) {
        throw new RuntimeException('Cutover-Lock gehoert nicht zum erwarteten Vorgang.');
    }
}

function lehrfahrer_cutover_revoke_sessions(PDO $pdo): array {
    $now = gmdate('Y-m-d\TH:i:s\Z');
    $result = [];
    foreach (['sessions' => 'legacy', 'account_sessions' => 'account'] as $table => $name) {
        $statement = $pdo->prepare('UPDATE ' . $table . ' SET revoked_at = ? WHERE environment = ? AND revoked_at IS NULL');
        $statement->execute([$now, 'staging']);
        $result[$name] = $statement->rowCount();
    }
    return $result;
}

function lehrfahrer_cutover_run(): array {
    [$pdo, $point, $marker, $run] = lehrfahrer_cutover_context();
    $action = (string)getenv('LEHRFAHRER_CUTOVER_ACTION');
    $state = lehrfahrer_auth_cutover_state($pdo);
    if ($action === 'inspect') return ['ok' => true, 'auth' => $state,
        'restore_point_valid' => true, 'marker_present' => is_file($marker)];
    if ($action === 'begin') {
        if ($state !== ['mode' => 'PARALLEL', 'lock' => 'OPEN'] || file_exists($marker)) {
            throw new RuntimeException('Cutover erwartet PARALLEL/OPEN ohne bestehenden Marker.');
        }
        $preflight = lehrfahrer_account_cutover_preflight($pdo);
        if ($preflight['status'] === 'BLOCKER' || $preflight['auth'] !== $state) {
            throw new RuntimeException('Read-only Cutover-Preflight blockiert.');
        }
        $record = json_encode(['run' => $run, 'restore_point' => basename((string)$point['directory']),
            'sha256' => (string)$point['manifest']['sha256']], JSON_THROW_ON_ERROR);
        $handle = fopen($marker, 'x');
        if ($handle === false) throw new RuntimeException('Cutover-Marker konnte nicht angelegt werden.');
        try {
            if (!chmod($marker, 0600) || fwrite($handle, $record) !== strlen($record) || !fflush($handle)) {
                throw new RuntimeException('Cutover-Marker konnte nicht sicher geschrieben werden.');
            }
        } finally {
            fclose($handle);
        }
        lehrfahrer_auth_cutover_set_lock($pdo, 'LOCKED', $run);
        $revoked = lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run): array {
            lehrfahrer_cutover_assert_owner($pdo, $run);
            if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
                throw new RuntimeException('Cutover-Sperre ist inkonsistent.');
            }
            $revoked = lehrfahrer_cutover_revoke_sessions($pdo);
            lehrfahrer_cutover_write_state($pdo, 'ACCOUNT_PRIMARY', 'LOCKED');
            return $revoked;
        });
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED']) {
            throw new RuntimeException('ACCOUNT_PRIMARY wurde nicht eindeutig gespeichert.');
        }
        return ['ok' => true, 'auth' => ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED'], 'revoked' => $revoked];
    }
    if ($action === 'open') {
        lehrfahrer_cutover_marker($marker, $run);
        lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run): void {
            lehrfahrer_cutover_assert_owner($pdo, $run);
            if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED']) {
                throw new RuntimeException('ACCOUNT_PRIMARY/LOCKED ist nicht aktiv.');
            }
            foreach (['sessions', 'account_sessions'] as $table) {
                $count = (int)$pdo->query("SELECT COUNT(*) FROM $table WHERE environment = 'staging' AND revoked_at IS NULL")->fetchColumn();
                if ($count !== 0) throw new RuntimeException('Vor-Cutover-Session blieb offen.');
            }
            lehrfahrer_cutover_write_state($pdo, 'ACCOUNT_PRIMARY', 'OPEN');
        });
        return ['ok' => true, 'auth' => lehrfahrer_auth_cutover_state($pdo)];
    }
    if ($action === 'recover') {
        lehrfahrer_cutover_marker($marker, $run);
        lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run): void {
            $state = lehrfahrer_auth_cutover_state($pdo);
            if ($state === ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
                $query = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
                $query->execute(['auth_cutover_owner']);
                if ($query->fetchColumn() !== false) throw new RuntimeException('Recovery-Owner blieb aktiv.');
                return;
            }
            lehrfahrer_cutover_assert_owner($pdo, $run);
            if (!in_array($state, [
                ['mode' => 'PARALLEL', 'lock' => 'LOCKED'],
                ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED'],
                ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN'],
            ], true)) throw new RuntimeException('Recovery-Zustand ist widerspruechlich.');
            lehrfahrer_cutover_revoke_sessions($pdo);
            lehrfahrer_cutover_write_state($pdo, 'PARALLEL', 'OPEN');
            $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ?')->execute(['auth_cutover_owner']);
        });
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
            throw new RuntimeException('Recovery ist nicht konsistent.');
        }
        if (!unlink($marker)) throw new RuntimeException('Recovery-Marker konnte nicht entfernt werden.');
        return ['ok' => true, 'auth' => ['mode' => 'PARALLEL', 'lock' => 'OPEN']];
    }
    if ($action === 'finalize') {
        lehrfahrer_cutover_marker($marker, $run);
        if ($state !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN']) {
            throw new RuntimeException('Cutover ist nicht abgeschlossen.');
        }
        lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run): void {
            if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN']) {
                throw new RuntimeException('Cutover-Zustand hat sich geaendert.');
            }
            lehrfahrer_cutover_assert_owner($pdo, $run);
            $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ?')->execute(['auth_cutover_owner']);
        });
        if (!unlink($marker)) throw new RuntimeException('Cutover-Marker konnte nicht entfernt werden.');
        return ['ok' => true, 'auth' => $state];
    }
    throw new RuntimeException('Unbekannte Cutover-Aktion.');
}

if (getenv('LEHRFAHRER_CUTOVER_RUN') === '1') {
    try {
        echo json_encode(lehrfahrer_cutover_run(), JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable $error) {
        file_put_contents('php://stderr', 'Staging-Cutover fehlgeschlagen: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
