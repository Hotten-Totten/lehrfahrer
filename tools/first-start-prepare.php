<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/_first_start.php';

try {
    if (PHP_SAPI !== 'cli' || isset($_SERVER['REQUEST_METHOD'])
        || getenv('LEHRFAHRER_FIRST_START_PREPARE') !== '1' || !lehrfahrer_first_start_configured()) {
        throw new RuntimeException('SETUP_PREPARE_CONTEXT');
    }
    $private = lehrfahrer_first_start_private_root();
    if ($private === null || scandir($private) !== ['.','..']) throw new RuntimeException('SETUP_PRIVATE_NOT_EMPTY');
    $pdo = lehrfahrer_first_start_connection();
    if ((int)$pdo->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchColumn() !== 0) {
        throw new RuntimeException('SETUP_DATABASE_NOT_EMPTY');
    }
    lehrfahrer_control_migrate($pdo);
    lehrfahrer_control_bind_environment($pdo, lehrfahrer_environment());
    $pdo->beginTransaction();
    try {
        $write = $pdo->prepare('INSERT INTO control_metadata (`key`,value,updated_at) VALUES (?,?,?)');
        $now = gmdate('c');
        foreach (['auth_mode'=>'ACCOUNT_PRIMARY','auth_cutover_lock'=>'OPEN','first_start_pending'=>hash('sha256',$private)] as $key=>$value) {
            $write->execute([$key,$value,$now]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    echo "FIRST_START_PREPARED\n";
} catch (Throwable $error) {
    fwrite(STDERR, "FIRST_START_PREPARATION_BLOCKED\n");
    exit(2);
}
