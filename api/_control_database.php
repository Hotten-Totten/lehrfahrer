<?php

require_once __DIR__ . '/_private_storage.php';
require_once __DIR__ . '/_control_schema.php';
require_once __DIR__ . '/_runtime_info.php';

const LEHRFAHRER_CONTROL_SCHEMA_VERSION = 3;
const LEHRFAHRER_CONTROL_BUSY_TIMEOUT_MS = 5000;

function lehrfahrer_control_database_path(): string {
    return lehrfahrer_private_storage_directory('control') . DIRECTORY_SEPARATOR . 'lehrfahrer.sqlite';
}

function lehrfahrer_control_database(): PDO {
    static $connections = [];

    $databasePath = lehrfahrer_control_database_path();
    if (isset($connections[$databasePath])) return $connections[$databasePath];

    $pdo = new PDO('sqlite:' . $databasePath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = ' . LEHRFAHRER_CONTROL_BUSY_TIMEOUT_MS);
    lehrfahrer_control_migrate($pdo);
    lehrfahrer_control_bind_environment($pdo, lehrfahrer_environment());
    @chmod($databasePath, 0600);

    $connections[$databasePath] = $pdo;
    return $pdo;
}

function lehrfahrer_control_migrate(PDO $pdo): void {
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )'
    );

    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $applied = $pdo->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN);
        $appliedVersions = array_map('intval', $applied);

        if (!in_array(1, $appliedVersions, true)) {
            lehrfahrer_control_apply_initial_schema($pdo);
            lehrfahrer_control_record_migration($pdo, 1);
            $appliedVersions[] = 1;
        }
        if (!in_array(2, $appliedVersions, true)) {
            lehrfahrer_control_apply_session_schema($pdo);
            lehrfahrer_control_record_migration($pdo, 2);
            $appliedVersions[] = 2;
        }
        if (!in_array(3, $appliedVersions, true)) {
            lehrfahrer_control_apply_capability_binding_schema($pdo);
            lehrfahrer_control_record_migration($pdo, 3);
        }

        $pdo->exec('COMMIT');
    } catch (Throwable $error) {
        try {
            $pdo->exec('ROLLBACK');
        } catch (Throwable $_rollbackError) {
            // Der ursprüngliche Migrationsfehler bleibt maßgeblich.
        }
        throw $error;
    }
}

function lehrfahrer_control_record_migration(PDO $pdo, int $version): void {
    $statement = $pdo->prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (:version, :applied_at)'
    );
    $statement->execute([':version' => $version, ':applied_at' => gmdate('c')]);
}

function lehrfahrer_control_bind_environment(PDO $pdo, string $environment): void {
    $insert = $pdo->prepare(
        'INSERT OR IGNORE INTO control_metadata (key, value, updated_at) VALUES (:key, :value, :updated_at)'
    );
    $insert->execute([
        ':key' => 'environment',
        ':value' => $environment,
        ':updated_at' => gmdate('c'),
    ]);

    $statement = $pdo->prepare('SELECT value FROM control_metadata WHERE key = :key');
    $statement->execute([':key' => 'environment']);
    $stored = $statement->fetchColumn();
    if ($stored === false || !hash_equals((string)$stored, $environment)) {
        throw new RuntimeException('Control-Datenbank gehört zu einer anderen Umgebung.');
    }
}

function lehrfahrer_control_sqlite_info(PDO $pdo): array {
    return [
        'foreignKeys' => ((int)$pdo->query('PRAGMA foreign_keys')->fetchColumn()) === 1,
        'busyTimeoutMs' => (int)$pdo->query('PRAGMA busy_timeout')->fetchColumn(),
        'journalMode' => strtolower((string)$pdo->query('PRAGMA journal_mode')->fetchColumn()),
    ];
}
