<?php

require_once __DIR__ . '/_private_storage.php';
require_once __DIR__ . '/_control_schema.php';
require_once __DIR__ . '/_control_phase2_schema.php';
require_once __DIR__ . '/_control_user_numbers.php';
require_once __DIR__ . '/_runtime_info.php';

const LEHRFAHRER_CONTROL_SCHEMA_VERSION = 6;
const LEHRFAHRER_CONTROL_BUSY_TIMEOUT_MS = 5000;
const LEHRFAHRER_CONTROL_MIGRATION_LOCK_SECONDS = 15;

function lehrfahrer_control_database_path(): string {
    if (lehrfahrer_control_database_driver() !== 'sqlite') {
        throw new RuntimeException('Ein Dateipfad existiert nur fuer das explizite DEV/Test-SQLite-Backend.');
    }
    return lehrfahrer_private_storage_directory('control') . DIRECTORY_SEPARATOR . 'lehrfahrer.sqlite';
}

function lehrfahrer_control_database_driver(): string {
    $driver = strtolower(trim((string)getenv('LEHRFAHRER_DB_DRIVER')));
    if ($driver === '') $driver = 'mysql';
    if (!in_array($driver, ['mysql', 'sqlite'], true)) {
        throw new RuntimeException('LEHRFAHRER_DB_DRIVER muss mysql oder sqlite sein.');
    }
    if ($driver === 'sqlite' && lehrfahrer_environment() !== 'dev') {
        throw new RuntimeException('SQLite ist ausschliesslich als explizites DEV/Test-Backend erlaubt.');
    }
    return $driver;
}

function lehrfahrer_control_mysql_configuration(): array {
    $dsn = trim((string)getenv('LEHRFAHRER_DB_DSN'));
    $host = trim((string)getenv('LEHRFAHRER_DB_HOST'));
    $port = trim((string)getenv('LEHRFAHRER_DB_PORT')) ?: '3306';
    $name = trim((string)getenv('LEHRFAHRER_DB_NAME'));
    $user = trim((string)getenv('LEHRFAHRER_DB_USER'));
    $password = (string)getenv('LEHRFAHRER_DB_PASSWORD');

    if ($dsn === '') {
        if ($host === '' || $name === '') {
            throw new RuntimeException('MariaDB-Konfiguration fehlt: DB_HOST und DB_NAME sind erforderlich.');
        }
        if (!ctype_digit($port) || (int)$port < 1 || (int)$port > 65535) {
            throw new RuntimeException('LEHRFAHRER_DB_PORT ist ungueltig.');
        }
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, (int)$port, $name);
    }
    if (!str_starts_with(strtolower($dsn), 'mysql:')) {
        throw new RuntimeException('Die produktive Control-DB muss einen mysql:-DSN verwenden.');
    }
    if ($user === '' || $password === '') {
        throw new RuntimeException('MariaDB-Benutzer oder -Passwort fehlt.');
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    $tlsCa = trim((string)getenv('LEHRFAHRER_DB_TLS_CA'));
    if ($tlsCa !== '') {
        if (!is_file($tlsCa) || !is_readable($tlsCa)) {
            throw new RuntimeException('Die konfigurierte MariaDB-CA-Datei ist nicht lesbar.');
        }
        if (!defined('PDO::MYSQL_ATTR_SSL_CA') || !defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
            throw new RuntimeException('Der PHP-MySQL-Treiber unterstuetzt die geforderte TLS-Pruefung nicht.');
        }
        $options[PDO::MYSQL_ATTR_SSL_CA] = $tlsCa;
        $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
    }
    if (filter_var(getenv('LEHRFAHRER_DB_TLS_REQUIRED'), FILTER_VALIDATE_BOOL) && $tlsCa === '') {
        throw new RuntimeException('TLS ist gefordert, aber LEHRFAHRER_DB_TLS_CA fehlt.');
    }

    return compact('dsn', 'user', 'password', 'options');
}

function lehrfahrer_control_database(): PDO {
    static $connections = [];
    $driver = lehrfahrer_control_database_driver();

    if ($driver === 'sqlite') {
        $databasePath = lehrfahrer_control_database_path();
        $dsn = 'sqlite:' . $databasePath;
        $user = null;
        $password = null;
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ];
        $connectionKey = $dsn;
    } else {
        if (!extension_loaded('pdo_mysql')) {
            throw new RuntimeException('pdo_mysql ist fuer die produktive Control-DB erforderlich.');
        }
        $configuration = lehrfahrer_control_mysql_configuration();
        ['dsn' => $dsn, 'user' => $user, 'password' => $password, 'options' => $options] = $configuration;
        $connectionKey = hash('sha256', $dsn . "\0" . $user . "\0" . $password);
    }
    if (isset($connections[$connectionKey])) return $connections[$connectionKey];

    $pdo = new PDO($dsn, $user, $password, $options);
    if ($driver === 'sqlite') {
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = ' . LEHRFAHRER_CONTROL_BUSY_TIMEOUT_MS);
    } else {
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("SET time_zone = '+00:00'");
    }
    lehrfahrer_control_migrate($pdo);
    lehrfahrer_control_bind_environment($pdo, lehrfahrer_environment());
    if ($driver === 'sqlite') @chmod($databasePath, 0600);

    $connections[$connectionKey] = $pdo;
    return $pdo;
}

function lehrfahrer_control_driver(PDO $pdo): string {
    $driver = strtolower((string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME));
    if (!in_array($driver, ['mysql', 'sqlite'], true)) {
        throw new RuntimeException('Nicht unterstuetzter Control-DB-Treiber.');
    }
    return $driver;
}

function lehrfahrer_control_ensure_migration_table(PDO $pdo): void {
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                version INT NOT NULL PRIMARY KEY,
                applied_at VARCHAR(35) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        return;
    }
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )'
    );
}

function lehrfahrer_control_mysql_lock_name(PDO $pdo): string {
    $database = (string)$pdo->query('SELECT DATABASE()')->fetchColumn();
    return 'lehrfahrer_control_' . substr(hash('sha256', $database), 0, 24);
}

function lehrfahrer_control_migrate(PDO $pdo): void {
    lehrfahrer_control_ensure_migration_table($pdo);
    $driver = lehrfahrer_control_driver($pdo);
    $lockName = null;
    $sqliteTransaction = false;

    if ($driver === 'mysql') {
        $lockName = lehrfahrer_control_mysql_lock_name($pdo);
        $lock = $pdo->prepare('SELECT GET_LOCK(:lock_name, :timeout_seconds)');
        $lock->bindValue(':lock_name', $lockName, PDO::PARAM_STR);
        $lock->bindValue(':timeout_seconds', LEHRFAHRER_CONTROL_MIGRATION_LOCK_SECONDS, PDO::PARAM_INT);
        $lock->execute();
        if ((int)$lock->fetchColumn() !== 1) {
            throw new RuntimeException('MariaDB-Migrations-Lock konnte nicht bezogen werden.');
        }
    } else {
        $pdo->exec('BEGIN IMMEDIATE');
        $sqliteTransaction = true;
    }

    try {
        $applied = $pdo->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN);
        $appliedVersions = array_map('intval', $applied);
        $migrations = [
            1 => 'lehrfahrer_control_apply_initial_schema',
            2 => 'lehrfahrer_control_apply_session_schema',
            3 => 'lehrfahrer_control_apply_capability_binding_schema',
            4 => 'lehrfahrer_control_apply_company_template_schema',
            5 => 'lehrfahrer_control_apply_phase2_schema',
            6 => 'lehrfahrer_control_apply_user_number_schema',
        ];
        foreach ($migrations as $version => $migration) {
            if (in_array($version, $appliedVersions, true)) continue;
            $migration($pdo);
            lehrfahrer_control_record_migration($pdo, $version);
        }
        if ($sqliteTransaction) $pdo->exec('COMMIT');
    } catch (Throwable $error) {
        if ($sqliteTransaction) {
            try { $pdo->exec('ROLLBACK'); } catch (Throwable $_rollbackError) {}
        }
        throw $error;
    } finally {
        if ($lockName !== null) {
            try {
                $release = $pdo->prepare('SELECT RELEASE_LOCK(:lock_name)');
                $release->execute([':lock_name' => $lockName]);
            } catch (Throwable $_releaseError) {}
        }
    }
}

function lehrfahrer_control_record_migration(PDO $pdo, int $version): void {
    $statement = $pdo->prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (:version, :applied_at)'
    );
    $statement->execute([':version' => $version, ':applied_at' => gmdate('c')]);
}

function lehrfahrer_control_bind_environment(PDO $pdo, string $environment): void {
    $statement = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = :key');
    $statement->execute([':key' => 'environment']);
    $stored = $statement->fetchColumn();
    if ($stored === false) {
        try {
            $insert = $pdo->prepare(
                'INSERT INTO control_metadata (`key`, value, updated_at) VALUES (:key, :value, :updated_at)'
            );
            $insert->execute([
                ':key' => 'environment',
                ':value' => $environment,
                ':updated_at' => gmdate('c'),
            ]);
            $stored = $environment;
        } catch (PDOException $error) {
            if ($error->getCode() !== '23000') throw $error;
            $statement->execute([':key' => 'environment']);
            $stored = $statement->fetchColumn();
        }
    }
    if ($stored === false || !hash_equals((string)$stored, $environment)) {
        throw new RuntimeException('Control-Datenbank gehoert zu einer anderen Umgebung.');
    }
}

function lehrfahrer_control_database_info(PDO $pdo): array {
    $driver = lehrfahrer_control_driver($pdo);
    $info = [
        'driver' => $driver,
        'serverVersion' => (string)$pdo->getAttribute(PDO::ATTR_SERVER_VERSION),
    ];
    if ($driver === 'mysql') {
        $info['database'] = (string)$pdo->query('SELECT DATABASE()')->fetchColumn();
        $info['transactionIsolation'] = (string)$pdo->query('SELECT @@transaction_isolation')->fetchColumn();
        return $info;
    }
    $info['foreignKeys'] = ((int)$pdo->query('PRAGMA foreign_keys')->fetchColumn()) === 1;
    $info['busyTimeoutMs'] = (int)$pdo->query('PRAGMA busy_timeout')->fetchColumn();
    $info['journalMode'] = strtolower((string)$pdo->query('PRAGMA journal_mode')->fetchColumn());
    return $info;
}
