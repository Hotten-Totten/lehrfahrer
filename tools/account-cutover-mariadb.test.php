<?php
declare(strict_types=1);

if ((string)getenv('LEHRFAHRER_TEST_LOCAL_MARIADB') !== '1') {
    echo "SKIP: local MariaDB not requested\n";
    exit(0);
}
putenv('LEHRFAHRER_ENV=staging');
putenv('LEHRFAHRER_APP_ROOT=' . dirname(__DIR__));
require_once __DIR__ . '/control-account-cutover-staging.php';

$server = new PDO('mysql:host=127.0.0.1;charset=utf8mb4', 'root', '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$database = 'lf_p24_test_' . bin2hex(random_bytes(5));
$server->exec('CREATE DATABASE `' . $database . '` CHARACTER SET utf8mb4');
try {
    $pdo = new PDO('mysql:host=127.0.0.1;dbname=' . $database . ';charset=utf8mb4', 'root', '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE control_metadata (`key` VARCHAR(80) PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) ENGINE=InnoDB');
    foreach (['sessions', 'account_sessions'] as $table) {
        $pdo->exec('CREATE TABLE ' . $table . ' (id INT PRIMARY KEY AUTO_INCREMENT, environment VARCHAR(20) NOT NULL, revoked_at VARCHAR(40) NULL) ENGINE=InnoDB');
        $pdo->exec("INSERT INTO $table (environment,revoked_at) VALUES ('staging',NULL)");
    }
    lehrfahrer_auth_cutover_set_lock($pdo, 'LOCKED', '123-1');
    $revoked = lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo): array {
        lehrfahrer_cutover_assert_owner($pdo, '123-1');
        $revoked = lehrfahrer_cutover_revoke_sessions($pdo);
        lehrfahrer_cutover_write_state($pdo, 'ACCOUNT_PRIMARY', 'LOCKED');
        return $revoked;
    });
    if ($revoked !== ['legacy' => 1, 'account' => 1]
        || lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'ACCOUNT_PRIMARY', 'lock' => 'LOCKED']) {
        throw new RuntimeException('Cutover-Transaktion ist inkonsistent.');
    }
    $blocked = false;
    try { lehrfahrer_with_auth_mutation_gate($pdo, static fn(): bool => true); }
    catch (LehrfahrerAuthCutoverBusy $error) { $blocked = true; }
    if (!$blocked) throw new RuntimeException('Authentifizierung ging durch Cutover-Lock.');
    lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo): void {
        lehrfahrer_cutover_assert_owner($pdo, '123-1');
        lehrfahrer_cutover_write_state($pdo, 'ACCOUNT_PRIMARY', 'OPEN');
    });
    if (lehrfahrer_with_auth_mutation_gate($pdo, static fn(): bool => true) !== true) {
        throw new RuntimeException('Account-Mutation nach Lock-Freigabe blockiert.');
    }
    $pdo->exec("INSERT INTO account_sessions (environment,revoked_at) VALUES ('staging',NULL)");
    lehrfahrer_cutover_with_lock($pdo, static function () use ($pdo): void {
        lehrfahrer_cutover_assert_owner($pdo, '123-1');
        lehrfahrer_cutover_revoke_sessions($pdo);
        lehrfahrer_cutover_write_state($pdo, 'PARALLEL', 'OPEN');
        $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ?')->execute(['auth_cutover_owner']);
    });
    if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']
        || (int)$pdo->query('SELECT COUNT(*) FROM account_sessions WHERE revoked_at IS NULL')->fetchColumn() !== 0) {
        throw new RuntimeException('Recovery hat Sessions oder Modus nicht gesichert.');
    }
    $pdo->exec("INSERT INTO account_sessions (environment,revoked_at) VALUES ('staging',NULL)");
    $before = lehrfahrer_cutover_unrevoked_sessions($pdo);
    lehrfahrer_auth_cutover_set_lock($pdo, 'LOCKED', '123-2');
    if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'LOCKED']) {
        throw new RuntimeException('Diagnose-Lock veraenderte den Modus.');
    }
    $blocked = false;
    try { lehrfahrer_with_auth_mutation_gate($pdo, static fn(): bool => true); }
    catch (LehrfahrerAuthCutoverBusy $error) { $blocked = true; }
    if (!$blocked) throw new RuntimeException('Diagnose-Lock blockierte Auth-Mutation nicht.');
    lehrfahrer_auth_cutover_set_lock($pdo, 'OPEN', '123-2');
    $pdo->prepare('DELETE FROM control_metadata WHERE `key` = ?')->execute(['auth_cutover_owner']);
    if (lehrfahrer_auth_cutover_state($pdo) !== ['mode' => 'PARALLEL', 'lock' => 'OPEN']
        || $before !== lehrfahrer_cutover_unrevoked_sessions($pdo)) {
        throw new RuntimeException('Diagnose-Dry-Run veraenderte Sitzungen oder Auth-Modus.');
    }
    echo "PASS: MariaDB cutover lock, revocation, primary mode and recovery\n";
} finally {
    $server->exec('DROP DATABASE `' . $database . '`');
}
