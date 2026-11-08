<?php
declare(strict_types=1);

// Import definitions only. Never call the schema-creating database factory.
require_once __DIR__ . '/control-account-preflight.php';

/** Dedicated connection required: read-only mode remains enabled after return. */
function lehrfahrer_production_login_preflight(PDO $pdo): array {
    $blocked = static fn(string $code): array => [
        'inventoryStatus' => 'BLOCKIERT', 'releaseReady' => false,
        'findings' => [['level' => 'BLOCKER', 'code' => $code]],
    ];
    if ($pdo->inTransaction()) return $blocked('CONNECTION_TRANSACTION_ACTIVE');
    $driver = (string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    if (!in_array($driver, ['mysql', 'sqlite'], true)) return $blocked('DATABASE_DRIVER_UNSUPPORTED');
    try {
        $pdo->exec($driver === 'mysql' ? 'SET SESSION TRANSACTION READ ONLY' : 'PRAGMA query_only = ON');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT value FROM control_metadata WHERE `key` = ?');
        $query->execute(['environment']);
        if ($query->fetchColumn() !== 'production') {
            $pdo->rollBack();
            return $blocked('DATABASE_ENVIRONMENT_MISMATCH');
        }
        $query->execute(['auth_mode']);
        $mode = $query->fetchColumn();
        $query->execute(['auth_cutover_lock']);
        $lock = $query->fetchColumn();
        if ($mode !== 'PARALLEL' || $lock !== 'OPEN') {
            $pdo->rollBack();
            return $blocked('AUTH_STATE_NOT_INITIAL_PARALLEL_OPEN');
        }
        $inventory = lehrfahrer_control_account_preflight_read($pdo, $driver);
        $pdo->rollBack();
        // Only fixed codes and aggregate integers escape the inventory scanner.
        $report = ['inventoryStatus' => $inventory['status'], 'releaseReady' => false,
            'scope' => 'IDENTITY_INVENTORY_ONLY', 'findings' => []];
        foreach ($inventory['findings'] as $finding) {
            $report['findings'][] = ['level' => $finding['level'], 'code' => $finding['code']];
        }
        foreach (['counts', 'newTables', 'definitionCounts', 'company', 'roles', 'password', 'email', 'activation', 'sessions'] as $section) {
            if (!isset($inventory[$section]) || !is_array($inventory[$section])) continue;
            $report[$section] = array_filter($inventory[$section], static fn($value): bool => is_int($value));
        }
        $report['pendingChecks'] = ['PRODUCTION_AUTH_IMPLEMENTATION', 'ORIGIN_AND_MFA_SETUP',
            'PRIVATE_PATH_AND_BACKUP_RESTORE', 'AUDIT_AND_CUTOVER_REHEARSAL', 'EXPLICIT_RELEASE_APPROVAL'];
        return $report;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        return $blocked('DATABASE_OR_SCHEMA_UNREADABLE');
    }
}

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    try {
        if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])
            || getenv('LEHRFAHRER_PRODUCTION_PREFLIGHT') !== 'READ_ONLY'
            || lehrfahrer_environment() !== 'production'
            || lehrfahrer_control_database_driver() !== 'mysql') throw new RuntimeException();
        $expected = (string)getenv('LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE');
        if (!preg_match('/^[A-Za-z0-9_]+$/D', $expected)) throw new RuntimeException();
        $config = lehrfahrer_control_mysql_configuration();
        $pdo = new PDO($config['dsn'], $config['user'], $config['password'], $config['options']);
        $pdo->exec('SET SESSION TRANSACTION READ ONLY');
        if (!hash_equals($expected, (string)$pdo->query('SELECT DATABASE()')->fetchColumn())) throw new RuntimeException();
        $report = lehrfahrer_production_login_preflight($pdo);
        echo json_encode($report, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
        exit($report['inventoryStatus'] === 'PASS' ? 0 : 1);
    } catch (Throwable $error) {
        // Never emit connection exceptions (DSN, paths or credentials).
        file_put_contents('php://stderr', "PRODUCTION_PREFLIGHT_CONTEXT_REJECTED\n");
        exit(2);
    }
}
