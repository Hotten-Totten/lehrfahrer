<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
require_once $appRoot . '/api/_auth_cutover_gate.php';
require_once __DIR__ . '/control-account-cutover-preflight.php';
require_once __DIR__ . '/control-db-recovery-drill.php';

/** Emit only fixed phase names and aggregate state; never include credentials or request data. */
function lehrfahrer_cutover_log(string $phase, string $event, array $facts = []): void {
    $safe = [];
    foreach ($facts as $key => $value) {
        if (!in_array($key, ['expected', 'actual', 'error_class', 'mutated', 'recovery_required',
            'legacy_active_before', 'legacy_revoked', 'legacy_active_after',
            'account_active_before', 'account_revoked', 'account_active_after'], true)) continue;
        if (!is_scalar($value) && $value !== null) continue;
        $safe[$key] = $value;
    }
    file_put_contents('php://stderr', $phase . ': ' . $event
        . ($safe === [] ? '' : ' ' . json_encode($safe, JSON_THROW_ON_ERROR)) . "\n");
}

function lehrfahrer_cutover_start(string $phase, string $expected, bool $mutated = false): void {
    $GLOBALS['lehrfahrer_cutover_phase'] = [$phase, $expected, $mutated];
    lehrfahrer_cutover_log($phase, 'START', ['expected' => $expected, 'mutated' => $mutated]);
}

function lehrfahrer_cutover_pass(string $phase, array $facts = []): void {
    lehrfahrer_cutover_log($phase, 'PASS', $facts);
    unset($GLOBALS['lehrfahrer_cutover_phase']);
}

function lehrfahrer_cutover_fail(Throwable $error): void {
    [$phase, $expected, $mutated] = $GLOBALS['lehrfahrer_cutover_phase']
        ?? ['CUTOVER-00 INTERNAL', 'valid staging context', false];
    $actual = 'unknown';
    $pdo = $GLOBALS['lehrfahrer_cutover_pdo'] ?? null;
    if ($pdo instanceof PDO) {
        try {
            $state = lehrfahrer_auth_cutover_state($pdo);
            $actual = $state['mode'] . '/' . $state['lock'];
        } catch (Throwable $ignored) { /* Fail report must never mask the original failure. */ }
    }
    lehrfahrer_cutover_log($phase, 'FAIL', ['expected' => $expected, 'actual' => $actual,
        'error_class' => get_class($error), 'mutated' => $mutated,
        'recovery_required' => $mutated]);
}

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
    if (in_array($action, ['open', 'recover', 'diagnostic-unlock', 'finalize'], true)) {
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

function lehrfahrer_cutover_active_sessions(PDO $pdo, string $table): int {
    $query = $pdo->query('SELECT revoked_at, idle_expires_at, absolute_expires_at FROM ' . $table
        . " WHERE environment = 'staging' AND revoked_at IS NULL");
    $now = time();
    $active = 0;
    foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if ((strtotime((string)$row['idle_expires_at']) ?: 0) > $now
            && (strtotime((string)$row['absolute_expires_at']) ?: 0) > $now) $active++;
    }
    return $active;
}

function lehrfahrer_cutover_unrevoked_sessions(PDO $pdo): array {
    $counts = [];
    foreach (['legacy' => 'sessions', 'account' => 'account_sessions'] as $name => $table) {
        $counts[$name] = (int)$pdo->query("SELECT COUNT(*) FROM $table WHERE environment = 'staging' AND revoked_at IS NULL")->fetchColumn();
    }
    return $counts;
}

function lehrfahrer_cutover_revoke_sessions(PDO $pdo, bool $diagnostic = false): array {
    $now = gmdate('Y-m-d\TH:i:s\Z');
    $result = [];
    foreach (['sessions' => 'legacy', 'account_sessions' => 'account'] as $table => $name) {
        $phase = $name === 'legacy' ? 'CUTOVER-06 LEGACY_SESSION_REVOKE' : 'CUTOVER-07 ACCOUNT_SESSION_REVOKE';
        $before = $diagnostic ? lehrfahrer_cutover_active_sessions($pdo, $table) : null;
        if ($diagnostic) lehrfahrer_cutover_start($phase, 'all staging sessions revoked', true);
        $statement = $pdo->prepare('UPDATE ' . $table . ' SET revoked_at = ? WHERE environment = ? AND revoked_at IS NULL');
        $statement->execute([$now, 'staging']);
        $result[$name] = $statement->rowCount();
        if ($diagnostic) lehrfahrer_cutover_pass($phase, [
            $name . '_active_before' => $before, $name . '_revoked' => $result[$name],
            $name . '_active_after' => lehrfahrer_cutover_active_sessions($pdo, $table)]);
    }
    return $result;
}

function lehrfahrer_cutover_run(): array {
    [$pdo, $point, $marker, $run] = lehrfahrer_cutover_context();
    $GLOBALS['lehrfahrer_cutover_pdo'] = $pdo;
    $action = (string)getenv('LEHRFAHRER_CUTOVER_ACTION');
    $state = lehrfahrer_auth_cutover_state($pdo);
    if ($action === 'inspect') return ['ok' => true, 'auth' => $state,
        'restore_point_valid' => true, 'marker_present' => is_file($marker),
        'unrevoked_sessions' => lehrfahrer_cutover_unrevoked_sessions($pdo)];
    if ($action === 'begin' || $action === 'diagnostic-lock') {
        if ($state !== ['mode' => 'PARALLEL', 'lock' => 'OPEN'] || file_exists($marker)) {
            throw new RuntimeException('Cutover erwartet PARALLEL/OPEN ohne bestehenden Marker.');
        }
        if ($action === 'begin') putenv('LEHRFAHRER_CUTOVER_PREFLIGHT_REQUIRE_DRIVER_SMOKE=1');
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
        lehrfahrer_cutover_start('CUTOVER-03 LOCK_ACQUIRE', 'PARALLEL/LOCKED', false);
        lehrfahrer_auth_cutover_set_lock($pdo, 'LOCKED', $run);
        lehrfahrer_cutover_pass('CUTOVER-03 LOCK_ACQUIRE');
        lehrfahrer_cutover_start('CUTOVER-04 LOCK_VERIFY', 'PARALLEL/LOCKED with matching owner', true);
        lehrfahrer_cutover_assert_owner($pdo, $run);
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
            throw new RuntimeException('Cutover-Sperre ist inkonsistent.');
        }
        lehrfahrer_cutover_pass('CUTOVER-04 LOCK_VERIFY');
        lehrfahrer_cutover_start('CUTOVER-05 AUTH_MUTATION_BLOCK_VERIFY', 'authentication mutation blocked', true);
        $blocked = false;
        try { lehrfahrer_with_auth_mutation_gate($pdo, static fn(): bool => true); }
        catch (LehrfahrerAuthCutoverBusy $error) { $blocked = true; }
        if (!$blocked) throw new RuntimeException('Auth-Mutation wurde trotz Sperre erlaubt.');
        lehrfahrer_cutover_pass('CUTOVER-05 AUTH_MUTATION_BLOCK_VERIFY');
        if ($action === 'diagnostic-lock') {
            return ['ok' => true, 'auth' => lehrfahrer_auth_cutover_state($pdo), 'dry_run' => true];
        }
        $revoked = lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run): array {
            lehrfahrer_cutover_assert_owner($pdo, $run);
            if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
                throw new RuntimeException('Cutover-Sperre ist inkonsistent.');
            }
            $revoked = lehrfahrer_cutover_revoke_sessions($pdo, true);
            lehrfahrer_cutover_start('CUTOVER-08 SESSION_VERIFY', 'zero unrevoked staging sessions', true);
            foreach (['sessions', 'account_sessions'] as $table) {
                $count = (int)$pdo->query("SELECT COUNT(*) FROM $table WHERE environment = 'staging' AND revoked_at IS NULL")->fetchColumn();
                if ($count !== 0) throw new RuntimeException('Staging-Session blieb offen.');
            }
            lehrfahrer_cutover_pass('CUTOVER-08 SESSION_VERIFY');
            lehrfahrer_cutover_start('CUTOVER-09 MODE_SWITCH', 'ACCOUNT_PRIMARY/LOCKED', true);
            lehrfahrer_cutover_write_state($pdo, 'ACCOUNT_PRIMARY', 'LOCKED');
            lehrfahrer_cutover_pass('CUTOVER-09 MODE_SWITCH');
            return $revoked;
        });
        lehrfahrer_cutover_start('CUTOVER-10 MODE_VERIFY', 'ACCOUNT_PRIMARY/LOCKED', true);
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED']) {
            throw new RuntimeException('ACCOUNT_PRIMARY wurde nicht eindeutig gespeichert.');
        }
        lehrfahrer_cutover_pass('CUTOVER-10 MODE_VERIFY');
        return ['ok' => true, 'auth' => ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED'], 'revoked' => $revoked];
    }
    if ($action === 'open') {
        lehrfahrer_cutover_start('CUTOVER-11 LOCK_RELEASE', 'ACCOUNT_PRIMARY/OPEN', true);
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
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN']) {
            throw new RuntimeException('Cutover-Lock blieb aktiv.');
        }
        lehrfahrer_cutover_pass('CUTOVER-11 LOCK_RELEASE');
        return ['ok' => true, 'auth' => lehrfahrer_auth_cutover_state($pdo)];
    }
    if ($action === 'recover' || $action === 'diagnostic-unlock') {
        $dryRun = $action === 'diagnostic-unlock';
        lehrfahrer_cutover_start('RECOVERY-01 STATE_READ', $dryRun ? 'PARALLEL/LOCKED or untouched PARALLEL/OPEN' : 'recoverable state', true);
        lehrfahrer_cutover_marker($marker, $run);
        $initial = lehrfahrer_auth_cutover_state($pdo);
        if ($dryRun && !in_array($initial, [
            ['mode' => 'PARALLEL', 'lock' => 'LOCKED'],
            ['mode' => 'PARALLEL', 'lock' => 'OPEN'],
        ], true)) {
            throw new RuntimeException('Dry-Run darf nur PARALLEL/LOCKED entsperren.');
        }
        lehrfahrer_cutover_pass('RECOVERY-01 STATE_READ', ['actual' => $initial['mode'] . '/' . $initial['lock']]);
        lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo, $run, $dryRun): void {
            lehrfahrer_cutover_start('RECOVERY-02 LOCK_VERIFY', 'matching owner or untouched PARALLEL/OPEN', true);
            $state = lehrfahrer_auth_cutover_state($pdo);
            if ($state === ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
                $query = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
                $query->execute(['auth_cutover_owner']);
                if ($query->fetchColumn() !== false) throw new RuntimeException('Recovery-Owner blieb aktiv.');
                lehrfahrer_cutover_pass('RECOVERY-02 LOCK_VERIFY');
                return;
            }
            lehrfahrer_cutover_assert_owner($pdo, $run);
            if ($dryRun ? $state !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']
                : !in_array($state, [
                ['mode' => 'PARALLEL', 'lock' => 'LOCKED'],
                ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED'],
                ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'OPEN'],
            ], true)) throw new RuntimeException('Recovery-Zustand ist widerspruechlich.');
            lehrfahrer_cutover_pass('RECOVERY-02 LOCK_VERIFY');
            lehrfahrer_cutover_start('RECOVERY-03 MODE_RESTORE_PARALLEL', 'PARALLEL', true);
            if (!$dryRun) lehrfahrer_cutover_revoke_sessions($pdo);
            lehrfahrer_cutover_write_state($pdo, 'PARALLEL', 'OPEN');
            lehrfahrer_cutover_pass('RECOVERY-03 MODE_RESTORE_PARALLEL');
            lehrfahrer_cutover_start('RECOVERY-04 SESSION_STATE_VERIFY',
                $dryRun ? 'sessions untouched' : 'zero unrevoked staging sessions', true);
            if (!$dryRun) foreach (['sessions', 'account_sessions'] as $table) {
                $count = (int)$pdo->query("SELECT COUNT(*) FROM $table WHERE environment = 'staging' AND revoked_at IS NULL")->fetchColumn();
                if ($count !== 0) throw new RuntimeException('Recovery liess Staging-Session offen.');
            }
            lehrfahrer_cutover_pass('RECOVERY-04 SESSION_STATE_VERIFY');
            $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ?')->execute(['auth_cutover_owner']);
        });
        lehrfahrer_cutover_start('RECOVERY-05 LOCK_RELEASE', 'OPEN', true);
        if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']) {
            throw new RuntimeException('Recovery ist nicht konsistent.');
        }
        lehrfahrer_cutover_pass('RECOVERY-05 LOCK_RELEASE');
        lehrfahrer_cutover_start('RECOVERY-06 FINAL_VERIFY', 'PARALLEL/OPEN without marker', true);
        if (!unlink($marker)) throw new RuntimeException('Recovery-Marker konnte nicht entfernt werden.');
        lehrfahrer_cutover_pass('RECOVERY-06 FINAL_VERIFY', ['actual' => 'PARALLEL/OPEN']);
        lehrfahrer_cutover_log('RECOVERY RESULT', 'PASS', ['actual' => 'PARALLEL/OPEN']);
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
        lehrfahrer_cutover_fail($error);
        if (in_array((string)getenv('LEHRFAHRER_CUTOVER_ACTION'), ['recover', 'diagnostic-unlock'], true)) {
            lehrfahrer_cutover_log('RECOVERY RESULT', 'FAIL', ['error_class' => get_class($error)]);
        }
        exit(1);
    }
}
