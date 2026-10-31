<?php
declare(strict_types=1);

$appRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT')) ?: dirname(__DIR__);
require_once $appRoot . '/api/_control_database.php';
require_once $appRoot . '/api/_auth_cutover_gate.php';
require_once __DIR__ . '/_control-db-restore-point.php';

function lehrfahrer_recovery_fail(string $message): never {
    file_put_contents('php://stderr', $message . "\n");
    exit(1);
}

function lehrfahrer_control_db_fingerprint(array $configuration): string {
    $pdo = cottbusPdoConnection($configuration);
    $pdo->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    $hash = hash_init('sha256');
    try {
        $tables = $pdo->query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")->fetchAll(PDO::FETCH_COLUMN);
        sort($tables, SORT_STRING);
        foreach ($tables as $table) {
            $table = (string)$table;
            $quoted = cottbusSqlIdentifier($table);
            $columns = $pdo->query('SHOW COLUMNS FROM ' . $quoted)->fetchAll(PDO::FETCH_ASSOC);
            $names = array_map(static fn(array $row): string => (string)$row['Field'], $columns);
            $primary = array_values(array_map(
                static fn(array $row): string => (string)$row['Field'],
                array_filter($columns, static fn(array $row): bool => (string)($row['Key'] ?? '') === 'PRI')
            ));
            $order = $primary ?: $names;
            $query = 'SELECT * FROM ' . $quoted;
            if ($order !== []) $query .= ' ORDER BY ' . implode(',', array_map('cottbusSqlIdentifier', $order));
            hash_update($hash, $table . "\0");
            foreach ($pdo->query($query, PDO::FETCH_NUM) as $row) {
                hash_update($hash, serialize($row) . "\0");
            }
        }
    } finally {
        if ($pdo->inTransaction()) $pdo->rollBack();
    }
    return hash_final($hash);
}

function lehrfahrer_latest_restore_point(string $privateRoot, ?string $restoreId = null): array {
    $base = $privateRoot . DIRECTORY_SEPARATOR . 'backups' . DIRECTORY_SEPARATOR . 'control-db';
    if (!is_dir($base) || is_link($base)) throw new RuntimeException('Control-DB-Backup-Verzeichnis fehlt oder ist unsicher.');
    if ($restoreId !== null) {
        if (!preg_match('/^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{12}$/D', $restoreId)) {
            throw new RuntimeException('Restore-Punkt-ID ist ungueltig.');
        }
        $directory = $base . DIRECTORY_SEPARATOR . $restoreId;
        if (!is_dir($directory) || is_link($directory)) throw new RuntimeException('Restore-Punkt fehlt oder ist unsicher.');
    } else {
        $directories = array_values(array_filter(glob($base . DIRECTORY_SEPARATOR . '*') ?: [], static fn(string $path): bool => is_dir($path) && !is_link($path)));
        rsort($directories, SORT_STRING);
        if ($directories === []) throw new RuntimeException('Kein Control-DB-Restore-Punkt vorhanden.');
        $directory = $directories[0];
    }
    $manifestPath = $directory . DIRECTORY_SEPARATOR . 'manifest.json';
    $dumpPath = $directory . DIRECTORY_SEPARATOR . 'control.sql';
    if (!is_file($manifestPath) || is_link($manifestPath) || !is_file($dumpPath) || is_link($dumpPath)) {
        throw new RuntimeException('Restore-Punkt ist unvollstaendig oder unsicher.');
    }
    $manifest = json_decode((string)file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($manifest)
        || !hash_equals((string)($manifest['sha256'] ?? ''), (string)hash_file('sha256', $dumpPath))
        || (int)($manifest['bytes'] ?? -1) !== (int)filesize($dumpPath)
        || ($manifest['restore']['client_validated'] ?? false) !== true) {
        throw new RuntimeException('Restore-Punkt-Manifest ist nicht verifiziert.');
    }
    return ['directory' => $directory, 'manifest' => $manifest, 'dump' => $dumpPath];
}

function lehrfahrer_without_database_dsn(string $dsn): string {
    $parts = array_values(array_filter(explode(';', $dsn), static fn(string $part): bool => stripos(trim($part), 'dbname=') !== 0));
    return implode(';', $parts);
}

function lehrfahrer_with_database_dsn(string $dsn, string $database): string {
    $parts = explode(';', $dsn);
    $found = false;
    foreach ($parts as &$part) {
        if (stripos(trim($part), 'dbname=') === 0) {
            $part = 'dbname=' . $database;
            $found = true;
        }
    }
    unset($part);
    if (!$found) $parts[] = 'dbname=' . $database;
    return implode(';', $parts);
}

function lehrfahrer_run_control_db_recovery_drill(): array {
    if ((string)getenv('LEHRFAHRER_ENV') !== 'staging') {
        throw new RuntimeException('Recovery-Drill ist nur in Staging erlaubt.');
    }
    $privateRoot = (string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR');
    if ($privateRoot === '' || !is_dir($privateRoot) || is_link($privateRoot)) {
        throw new RuntimeException('Privater Staging-Root ist ungueltig.');
    }
    $configuration = lehrfahrer_control_mysql_configuration();
    $configuration['tls_ca'] = trim((string)getenv('LEHRFAHRER_DB_TLS_CA')) ?: null;
    $sourceIdentity = cottbusControlDbIdentity((string)$configuration['dsn']);
    $sourcePdo = cottbusPdoConnection($configuration);
    $environment = $sourcePdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
    $environment->execute(['environment']);
    if (!hash_equals('staging', (string)$environment->fetchColumn())) {
        throw new RuntimeException('Control-DB ist nicht eindeutig an Staging gebunden.');
    }
    $auth = $sourcePdo->query("SELECT `key`, value FROM control_metadata WHERE `key` IN ('auth_mode','auth_cutover_lock')")->fetchAll(PDO::FETCH_KEY_PAIR);
    if (($auth['auth_mode'] ?? 'PARALLEL') !== 'PARALLEL' || ($auth['auth_cutover_lock'] ?? 'OPEN') !== 'OPEN') {
        throw new RuntimeException('Recovery-Drill erwartet PARALLEL/OPEN.');
    }

    $restorePoint = lehrfahrer_latest_restore_point($privateRoot);
    if (!hash_equals((string)$sourceIdentity['database'], (string)($restorePoint['manifest']['database']['database'] ?? ''))) {
        throw new RuntimeException('Restore-Punkt gehoert nicht zur aktuellen Control-DB.');
    }
    $capability = cottbusDbBackupCapability($configuration, $privateRoot);
    if (($capability['DB_RESTORE_PATH_VALID'] ?? 'NO') !== 'YES') {
        throw new RuntimeException('Restore-Pfad ist nicht freigegeben.');
    }

    $sourceBefore = lehrfahrer_control_db_fingerprint($configuration);
    $testDatabase = 'lf_recovery_' . strtolower(bin2hex(random_bytes(6)));
    $serverConfiguration = $configuration;
    $serverConfiguration['dsn'] = lehrfahrer_without_database_dsn((string)$configuration['dsn']);
    $serverPdo = cottbusPdoConnection($serverConfiguration);
    $targetConfiguration = $configuration;
    $targetConfiguration['dsn'] = lehrfahrer_with_database_dsn((string)$configuration['dsn'], $testDatabase);
    $created = false;
    try {
        $serverPdo->exec('CREATE DATABASE ' . cottbusSqlIdentifier($testDatabase) . ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $created = true;
        cottbusRestoreControlDbIsolated($restorePoint['manifest'], $restorePoint['dump'], $targetConfiguration, $capability);
        $restored = lehrfahrer_control_db_fingerprint($targetConfiguration);
        if (!hash_equals($sourceBefore, $restored)) {
            throw new RuntimeException('Erster isolierter Restore entspricht nicht dem Staging-Ausgangszustand.');
        }

        $testPdo = cottbusPdoConnection($targetConfiguration);
        lehrfahrer_auth_cutover_set_lock($testPdo, 'LOCKED');
        if (lehrfahrer_auth_cutover_state($testPdo)['lock'] !== 'LOCKED') {
            throw new RuntimeException('Isolierter Fehlerzustand konnte nicht gesetzt werden.');
        }
        $mutated = lehrfahrer_control_db_fingerprint($targetConfiguration);
        if (hash_equals($restored, $mutated)) throw new RuntimeException('Isolierter Fehlerzustand hat den Fingerprint nicht veraendert.');

        cottbusRestoreControlDbIsolated($restorePoint['manifest'], $restorePoint['dump'], $targetConfiguration, $capability);
        $recovered = lehrfahrer_control_db_fingerprint($targetConfiguration);
        if (!hash_equals($restored, $recovered)) {
            throw new RuntimeException('Rollback-Restore stellt den Ausgangsfingerprint nicht wieder her.');
        }
        $testPdo = cottbusPdoConnection($targetConfiguration);
        $recoveredAuth = $testPdo->query("SELECT `key`, value FROM control_metadata WHERE `key` IN ('auth_mode','auth_cutover_lock')")->fetchAll(PDO::FETCH_KEY_PAIR);
        if (($recoveredAuth['auth_mode'] ?? 'PARALLEL') !== 'PARALLEL' || ($recoveredAuth['auth_cutover_lock'] ?? 'OPEN') !== 'OPEN') {
            throw new RuntimeException('Rollback-Restore stellt PARALLEL/OPEN nicht wieder her.');
        }
        $sourceAfter = lehrfahrer_control_db_fingerprint($configuration);
        if (!hash_equals($sourceBefore, $sourceAfter)) {
            throw new RuntimeException('Staging-Control-DB wurde durch den Recovery-Drill veraendert.');
        }
        return [
            'ok' => true,
            'restore_point_id' => basename((string)$restorePoint['directory']),
            'backup_sha256' => (string)$restorePoint['manifest']['sha256'],
            'backup_bytes' => (int)$restorePoint['manifest']['bytes'],
            'restore_mechanism' => (string)($restorePoint['manifest']['restore']['mechanism'] ?? ''),
            'isolated_database_created' => true,
            'initial_restore_matches_source' => true,
            'fault_injected' => 'auth_cutover_lock=LOCKED',
            'rollback_restored_fingerprint' => true,
            'rollback_restored_auth_state' => 'PARALLEL/OPEN',
            'source_unchanged' => true,
            'source_fingerprint_before' => $sourceBefore,
            'source_fingerprint_after' => $sourceAfter,
        ];
    } finally {
        if ($created) {
            try {
                $serverPdo->exec('DROP DATABASE IF EXISTS ' . cottbusSqlIdentifier($testDatabase));
            } catch (Throwable $cleanupError) {
                file_put_contents('php://stderr', 'Recovery-Testdatenbank konnte nicht geloescht werden.\n');
                throw $cleanupError;
            }
        }
    }
}

if (getenv('LEHRFAHRER_RECOVERY_DRILL_RUN') === '1') {
    try {
        $result = lehrfahrer_run_control_db_recovery_drill();
        echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    } catch (Throwable $error) {
        lehrfahrer_recovery_fail('Control-DB-Recovery-Drill fehlgeschlagen: ' . $error->getMessage());
    }
}
