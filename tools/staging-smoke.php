<?php

function lehrfahrer_staging_smoke_error(string $message): void {
    file_put_contents('php://stderr', $message . "\n");
}

$cgiSmoke = PHP_SAPI !== 'cli' && getenv('LEHRFAHRER_STAGING_CGI_SMOKE') === '1';
if (PHP_SAPI !== 'cli' && !$cgiSmoke) {
    http_response_code(404);
    exit;
}

$configuredRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
$appRoot = $configuredRoot !== '' ? realpath($configuredRoot) : dirname(__DIR__);
if (!is_string($appRoot) || !is_file($appRoot . '/api/_company_provisioning.php')) {
    lehrfahrer_staging_smoke_error('LEHRFAHRER_APP_ROOT ist ungueltig.');
    exit(2);
}
require_once $appRoot . '/api/_company_provisioning.php';

if (lehrfahrer_environment() !== 'staging') {
    lehrfahrer_staging_smoke_error('Dieser Smoketest darf nur in der Staging-Umgebung laufen.');
    exit(2);
}

$resultFile = '';
if ($cgiSmoke) {
    $resultFile = trim((string)getenv('LEHRFAHRER_STAGING_SMOKE_RESULT_FILE'));
    $resultDirectory = $resultFile !== '' ? realpath(dirname($resultFile)) : false;
    $privateRoot = realpath(lehrfahrer_private_storage_root());
    if ($resultDirectory === false || $privateRoot === false
        || $resultDirectory !== $privateRoot || basename($resultFile) !== 'smoke-result.json') {
        lehrfahrer_staging_smoke_error('CGI-Smoke-Ergebnisdatei liegt nicht im privaten Staging-Speicher.');
        exit(2);
    }
}

$expectedSlug = strtolower(trim((string)getenv('LEHRFAHRER_STAGING_COMPANY_SLUG')));
if ($expectedSlug === '') {
    lehrfahrer_staging_smoke_error('LEHRFAHRER_STAGING_COMPANY_SLUG fehlt.');
    exit(2);
}

try {
    $pdo = lehrfahrer_control_database();
    $companies = new LehrfahrerCompanyRepository($pdo);
    $company = $companies->findBySlug($expectedSlug);
    if (!is_array($company) || (int)$pdo->query('SELECT COUNT(*) FROM companies')->fetchColumn() !== 1) {
        throw new RuntimeException('Staging-Testgesellschaft ist nicht eindeutig.');
    }
    $configFile = lehrfahrer_tenant_path($company['id'], 'settings', 'company.json');
    $config = is_file($configFile)
        ? json_decode((string)file_get_contents($configFile), true, 512, JSON_THROW_ON_ERROR)
        : null;
    if (!is_array($config) || ($config['company']['company_id'] ?? '') !== $company['id']) {
        throw new RuntimeException('Staging-Gesellschaftsconfig fehlt oder ist ungueltig.');
    }

    $filesByArea = [];
    foreach (LEHRFAHRER_TENANT_AREAS as $area) {
        $files = [];
        $directory = lehrfahrer_tenant_area($company['id'], $area);
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $item) {
            if ($item->isFile()) $files[] = str_replace('\\', '/', $iterator->getSubPathname());
        }
        sort($files, SORT_STRING);
        $filesByArea[$area] = $files;
    }
    foreach ($filesByArea as $area => $files) {
        $expected = $area === 'settings' ? ['company.json'] : [];
        if ($files !== $expected) {
            throw new RuntimeException('Staging-Nullbestand ist im Bereich ' . $area . ' verletzt.');
        }
    }

    $userCount = $pdo->prepare('SELECT COUNT(*) FROM users WHERE company_id = :company_id');
    $userCount->execute([':company_id' => $company['id']]);
    $adminCount = $pdo->prepare(
        "SELECT COUNT(*) FROM users
         JOIN user_roles ON user_roles.user_id = users.id
         JOIN roles ON roles.id = user_roles.role_id AND roles.code = 'ADMIN'
         WHERE users.company_id = :company_id AND users.active = 1"
    );
    $adminCount->execute([':company_id' => $company['id']]);
    if ((int)$userCount->fetchColumn() !== 1 || (int)$adminCount->fetchColumn() !== 1) {
        throw new RuntimeException('Staging-Testadmin ist nicht eindeutig aktiv.');
    }

    if (lehrfahrer_control_driver($pdo) !== 'mysql') {
        throw new RuntimeException('Staging-Control-DB ist nicht MariaDB.');
    }
    $tlsStatus = $pdo->query("SHOW STATUS LIKE 'Ssl_cipher'")->fetch();
    if (!is_array($tlsStatus) || trim((string)($tlsStatus['Value'] ?? '')) === '') {
        throw new RuntimeException('MariaDB-Verbindung verwendet kein verifiziert konfiguriertes TLS.');
    }
    foreach ($pdo->query('SHOW GRANTS FOR CURRENT_USER')->fetchAll(PDO::FETCH_COLUMN) as $grant) {
        if (preg_match('/^GRANT\s+(?!USAGE\b).+\s+ON\s+\*\.\*/i', (string)$grant) === 1) {
            throw new RuntimeException('Staging-DB-Benutzer besitzt globale Rechte.');
        }
    }
    $expectedTables = [
        'capabilities', 'companies', 'control_metadata', 'role_capabilities', 'roles',
        'schema_migrations', 'sessions', 'user_activation_tokens', 'user_roles', 'users',
    ];
    $tables = $pdo->query(
        'SELECT table_name, engine, table_collation
         FROM information_schema.tables WHERE table_schema = DATABASE()'
    )->fetchAll();
    $tableNames = array_column($tables, 'table_name');
    sort($tableNames, SORT_STRING);
    sort($expectedTables, SORT_STRING);
    if ($tableNames !== $expectedTables) {
        throw new RuntimeException('Staging-Datenbank enthaelt unerwartete Tabellen.');
    }
    foreach ($tables as $table) {
        if (strcasecmp((string)$table['engine'], 'InnoDB') !== 0
            || !str_starts_with(strtolower((string)$table['table_collation']), 'utf8mb4_')) {
            throw new RuntimeException('Staging-Tabelle verwendet Engine oder Zeichensatz nicht korrekt.');
        }
    }

    $json = json_encode([
        'ok' => true,
        'company_id' => $company['id'],
        'slug' => $company['slug'],
        'template_version' => (int)$company['template_version_current'],
        'schema_version' => (int)$pdo->query('SELECT MAX(version) FROM schema_migrations')->fetchColumn(),
        'role_count' => (int)$pdo->query('SELECT COUNT(*) FROM roles')->fetchColumn(),
        'capability_count' => (int)$pdo->query('SELECT COUNT(*) FROM capabilities')->fetchColumn(),
        'null_inventory' => true,
        'tls' => true,
        'minimal_database_scope' => true,
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    if ($cgiSmoke) {
        $temporaryResult = $resultFile . '.tmp.' . getmypid();
        try {
            if (file_put_contents($temporaryResult, $json, LOCK_EX) !== strlen($json)
                || !chmod($temporaryResult, 0600) || !rename($temporaryResult, $resultFile)) {
                throw new RuntimeException('CGI-Smoke-Ergebnisdatei konnte nicht atomar geschrieben werden.');
            }
        } finally {
            if (is_file($temporaryResult)) unlink($temporaryResult);
        }
    } else {
        fwrite(STDOUT, $json);
    }
} catch (Throwable $error) {
    lehrfahrer_staging_smoke_error('Staging-Smoketest fehlgeschlagen: ' . $error->getMessage());
    exit(1);
}
