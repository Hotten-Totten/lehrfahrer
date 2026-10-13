<?php

// Read-only verification for the isolated staging reissue workflow.
if (getenv('REQUEST_METHOD') !== false || getenv('REMOTE_ADDR') !== false
    || getenv('HTTP_HOST') !== false || !is_file(__DIR__ . '/runtime-env.php')) exit(2);
require __DIR__ . '/runtime-env.php';
$appRoot = realpath((string)getenv('LEHRFAHRER_APP_ROOT'));
if (!is_string($appRoot) || !is_file($appRoot . '/api/_control_database.php')) exit(2);
require_once $appRoot . '/api/_control_database.php';
require_once $appRoot . '/api/_tenant_storage.php';

function lehrfahrer_reissue_file_fingerprint(string $companyId): string {
    $root = lehrfahrer_tenant_root($companyId);
    if (!is_dir($root) || is_link($root)) throw new RuntimeException('Tenant-Root fehlt.');
    $records = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink()) throw new RuntimeException('Symlink im Tenant.');
        $relative = str_replace('\\', '/', $iterator->getSubPathname());
        $records[$relative] = $item->isDir()
            ? ['dir', substr(sprintf('%o', $item->getPerms()), -4)]
            : ['file', $item->getSize(), hash_file('sha256', $item->getPathname())];
    }
    ksort($records, SORT_STRING);
    return hash('sha256', json_encode($records, JSON_THROW_ON_ERROR));
}

try {
    if (lehrfahrer_environment() !== 'staging'
        || realpath(__DIR__) !== realpath(lehrfahrer_private_storage_root())) {
        throw new RuntimeException('Kein privater Staging-Kontext.');
    }
    $config = lehrfahrer_control_mysql_configuration();
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], $config['options']);
    $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    $companyId = 'cmp_2ff1b82166c99988ed6f7eb51cca7b56';
    $admin = $pdo->prepare('SELECT id, active, must_change_password FROM users
        WHERE company_id = :company_id AND login_normalized = :login');
    $admin->execute([':company_id' => $companyId, ':login' => 'cottbus-admin']);
    $admins = $admin->fetchAll();
    if (count($admins) !== 1) throw new RuntimeException('Cottbus-Admin nicht eindeutig.');
    $token = $pdo->prepare('SELECT token_hash, expires_at, used_at FROM user_activation_tokens
        WHERE company_id = :company_id AND user_id = :user_id');
    $token->execute([':company_id' => $companyId, ':user_id' => $admins[0]['id']]);
    $tokens = $token->fetchAll();
    if (count($tokens) !== 1) throw new RuntimeException('Cottbus-Token nicht eindeutig.');

    $testCompany = $pdo->query("SELECT id FROM companies WHERE slug = 'lehrfahrer-test'")->fetchAll();
    if (count($testCompany) !== 1) throw new RuntimeException('Testgesellschaft nicht eindeutig.');
    $testId = $testCompany[0]['id'];
    $testDatabase = [];
    foreach ([
        'companies' => 'SELECT * FROM companies WHERE id = :company_id ORDER BY id',
        'users' => 'SELECT * FROM users WHERE company_id = :company_id ORDER BY id',
        'user_roles' => 'SELECT user_roles.* FROM user_roles JOIN users ON users.id = user_roles.user_id
            WHERE users.company_id = :company_id ORDER BY user_roles.user_id, user_roles.role_id',
        'tokens' => 'SELECT * FROM user_activation_tokens WHERE company_id = :company_id ORDER BY id',
        'sessions' => 'SELECT * FROM sessions WHERE company_id = :company_id ORDER BY id',
    ] as $name => $sql) {
        $statement = $pdo->prepare($sql);
        $statement->execute([':company_id' => $testId]);
        $testDatabase[$name] = $statement->fetchAll();
    }
    echo json_encode([
        'admin_active' => (int)$admins[0]['active'],
        'admin_must_change_password' => (int)$admins[0]['must_change_password'],
        'token_hash' => $tokens[0]['token_hash'],
        'token_expires_at' => $tokens[0]['expires_at'],
        'token_used_at' => $tokens[0]['used_at'],
        'cottbus_files' => lehrfahrer_reissue_file_fingerprint($companyId),
        'test_state' => hash('sha256', json_encode([
            'database' => $testDatabase,
            'files' => lehrfahrer_reissue_file_fingerprint($testId),
        ], JSON_THROW_ON_ERROR)),
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    file_put_contents('php://stderr', "Read-only-Reissue-Pruefung fehlgeschlagen.\n");
    exit(1);
}
