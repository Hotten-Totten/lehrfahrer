<?php

function lehrfahrer_cottbus_provision_error(string $message): void {
    file_put_contents('php://stderr', $message . "\n");
}

$cgiProvision = PHP_SAPI !== 'cli'
    && getenv('LEHRFAHRER_STAGING_CGI_PROVISION') === '1';
if (PHP_SAPI !== 'cli' && !$cgiProvision) {
    http_response_code(404);
    exit;
}

$configuredRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
$appRoot = $configuredRoot !== '' ? realpath($configuredRoot) : dirname(__DIR__);
if (!is_string($appRoot) || !is_file($appRoot . '/api/_company_provisioning.php')) {
    lehrfahrer_cottbus_provision_error('LEHRFAHRER_APP_ROOT ist ungueltig.');
    exit(2);
}
require_once $appRoot . '/api/_company_provisioning.php';

if (lehrfahrer_environment() !== 'staging') {
    lehrfahrer_cottbus_provision_error('Dieses Werkzeug darf nur in der Staging-Umgebung laufen.');
    exit(2);
}

$resultFile = '';
if ($cgiProvision) {
    $resultFile = trim((string)getenv('LEHRFAHRER_STAGING_PROVISION_RESULT_FILE'));
    $resultDirectory = $resultFile !== '' ? realpath(dirname($resultFile)) : false;
    $privateRoot = realpath(lehrfahrer_private_storage_root());
    if ($resultDirectory === false || $privateRoot === false
        || $resultDirectory !== $privateRoot || basename($resultFile) !== 'cottbus-provision-result.json') {
        lehrfahrer_cottbus_provision_error('CGI-Ergebnisdatei liegt nicht im privaten Staging-Speicher.');
        exit(2);
    }
}

function lehrfahrer_cottbus_rows(PDO $pdo, string $sql, array $parameters): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($parameters);
    return $statement->fetchAll();
}

function lehrfahrer_cottbus_fingerprint(PDO $pdo, array $company): string {
    $companyId = (string)$company['id'];
    $parameters = [':company_id' => $companyId];
    $database = [
        'company' => $company,
        'users' => lehrfahrer_cottbus_rows(
            $pdo,
            'SELECT id, company_id, login, display_name, email, password_hash, active,
                    must_change_password, created_at, updated_at
             FROM users WHERE company_id = :company_id ORDER BY id',
            $parameters
        ),
        'user_roles' => lehrfahrer_cottbus_rows(
            $pdo,
            'SELECT user_roles.user_id, user_roles.role_id
             FROM user_roles JOIN users ON users.id = user_roles.user_id
             WHERE users.company_id = :company_id ORDER BY user_roles.user_id, user_roles.role_id',
            $parameters
        ),
        'activation_tokens' => lehrfahrer_cottbus_rows(
            $pdo,
            'SELECT id, user_id, company_id, token_hash, created_at, expires_at, used_at
             FROM user_activation_tokens WHERE company_id = :company_id ORDER BY id',
            $parameters
        ),
        'sessions' => lehrfahrer_cottbus_rows(
            $pdo,
            'SELECT id, session_token_hash, user_id, company_id, csrf_token_hash, environment,
                    created_at, last_activity_at, idle_expires_at, absolute_expires_at,
                    revoked_at, ip_hash, user_agent_hash, device_label
             FROM sessions WHERE company_id = :company_id ORDER BY id',
            $parameters
        ),
    ];

    $root = lehrfahrer_tenant_root($companyId);
    $files = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink()) throw new RuntimeException('Symlink im Test-Tenant gefunden.');
        $relative = str_replace('\\', '/', $iterator->getSubPathname());
        $files[$relative] = $item->isDir()
            ? ['type' => 'directory', 'mode' => substr(sprintf('%o', $item->getPerms()), -4)]
            : [
                'type' => 'file',
                'mode' => substr(sprintf('%o', $item->getPerms()), -4),
                'size' => $item->getSize(),
                'sha256' => hash_file('sha256', $item->getPathname()),
            ];
    }
    ksort($files, SORT_STRING);
    return hash('sha256', json_encode(
        ['database' => $database, 'files' => $files],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ));
}

function lehrfahrer_cottbus_validate(PDO $pdo, array $company, ?string $activationToken): array {
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', (string)$company['id']) !== 1
        || $company['slug'] !== 'cottbusverkehr'
        || $company['name'] !== 'Cottbusverkehr'
        || $company['status'] !== 'active'
        || $company['license_status'] !== 'active'
        || $company['license_id'] !== null
        || (int)$company['template_version_created'] !== LEHRFAHRER_MASTER_TEMPLATE_VERSION
        || (int)$company['template_version_current'] !== LEHRFAHRER_MASTER_TEMPLATE_VERSION) {
        throw new RuntimeException('Cottbus-Gesellschaft entspricht nicht den freigegebenen Werten.');
    }

    $users = lehrfahrer_cottbus_rows(
        $pdo,
        'SELECT id, company_id, login, display_name, email, active, must_change_password
         FROM users WHERE company_id = :company_id ORDER BY id',
        [':company_id' => $company['id']]
    );
    if (count($users) !== 1 || $users[0]['company_id'] !== $company['id']
        || $users[0]['login'] !== 'cottbus-admin' || $users[0]['display_name'] !== 'Cottbus Admin'
        || $users[0]['email'] !== null || (int)$users[0]['active'] !== 0
        || (int)$users[0]['must_change_password'] !== 1) {
        throw new RuntimeException('Cottbus-Erstadmin ist nicht eindeutig oder nicht deaktiviert.');
    }
    $roles = lehrfahrer_cottbus_rows(
        $pdo,
        'SELECT roles.code FROM user_roles
         JOIN roles ON roles.id = user_roles.role_id
         WHERE user_roles.user_id = :user_id ORDER BY roles.code',
        [':user_id' => $users[0]['id']]
    );
    if (array_column($roles, 'code') !== ['ADMIN']) {
        throw new RuntimeException('Cottbus-Erstadmin besitzt unerwartete Rollen.');
    }
    $tokens = lehrfahrer_cottbus_rows(
        $pdo,
        'SELECT token_hash, created_at, expires_at, used_at FROM user_activation_tokens
         WHERE company_id = :company_id AND user_id = :user_id ORDER BY id',
        [':company_id' => $company['id'], ':user_id' => $users[0]['id']]
    );
    if (count($tokens) !== 1 || preg_match('/^[0-9a-f]{64}$/D', (string)$tokens[0]['token_hash']) !== 1
        || $tokens[0]['used_at'] !== null || strtotime((string)$tokens[0]['expires_at']) === false
        || strtotime((string)$tokens[0]['created_at']) === false
        || strtotime((string)$tokens[0]['expires_at']) - strtotime((string)$tokens[0]['created_at'])
            !== LEHRFAHRER_COMPANY_ACTIVATION_TTL_SECONDS) {
        throw new RuntimeException('Cottbus-Aktivierungstoken ist nicht sicher oder nicht plausibel.');
    }
    if ($activationToken !== null
        && !hash_equals((string)$tokens[0]['token_hash'], lehrfahrer_company_activation_token_hash($activationToken))) {
        throw new RuntimeException('Cottbus-Aktivierungstoken stimmt nicht mit seinem DB-Hash ueberein.');
    }

    $root = lehrfahrer_tenant_root((string)$company['id']);
    $privateRoot = realpath(lehrfahrer_private_storage_root());
    $resolvedRoot = realpath($root);
    if ($privateRoot === false || $resolvedRoot === false || is_link($root)
        || !str_starts_with($resolvedRoot . DIRECTORY_SEPARATOR, $privateRoot . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('Cottbus-Tenant liegt nicht sicher im privaten Staging-Speicher.');
    }

    $counts = array_fill_keys(
        ['cities', 'lines', 'routes', 'drivers', 'trainings', 'packages', 'documents',
         'catalog_entries', 'gtfs', 'variants_index'],
        0
    );
    $areaModes = [];
    foreach (LEHRFAHRER_TENANT_AREAS as $area) {
        $directory = lehrfahrer_tenant_area((string)$company['id'], $area);
        if (is_link($directory)) throw new RuntimeException('Symlink im Cottbus-Tenant gefunden.');
        $areaModes[$area] = substr(sprintf('%o', fileperms($directory)), -4);
        if ((fileperms($directory) & 0077) !== 0) {
            throw new RuntimeException('Cottbus-Tenant-Verzeichnisrechte sind zu weit.');
        }
        $files = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $item) {
            if ($item->isLink()) throw new RuntimeException('Symlink im Cottbus-Tenant gefunden.');
            if ($item->isFile()) $files[] = str_replace('\\', '/', $iterator->getSubPathname());
        }
        sort($files, SORT_STRING);
        if ($files !== ($area === 'settings' ? ['company.json'] : [])) {
            throw new RuntimeException('Cottbus-Nullbestand ist im Bereich ' . $area . ' verletzt.');
        }
    }
    $configFile = lehrfahrer_tenant_path((string)$company['id'], 'settings', 'company.json');
    if ((fileperms($configFile) & 0077) !== 0) {
        throw new RuntimeException('Cottbus-Config-Rechte sind zu weit.');
    }
    $config = json_decode((string)file_get_contents($configFile), true, 512, JSON_THROW_ON_ERROR);
    $template = lehrfahrer_master_tenant_template();
    if (($config['company']['company_id'] ?? '') !== $company['id']
        || ($config['company']['slug'] ?? '') !== 'cottbusverkehr'
        || ($config['defaults']['feature_flags'] ?? null) !== $template['feature_flags']
        || ($config['defaults']['system_settings'] ?? null) !== $template['system_settings']) {
        throw new RuntimeException('Cottbus-Config entspricht nicht dem neutralen Mastertemplate.');
    }

    return [
        'admin_login' => $users[0]['login'],
        'admin_active' => false,
        'admin_roles' => ['ADMIN'],
        'activation_hash_only' => true,
        'activation_expires_at' => $tokens[0]['expires_at'],
        'tenant_root' => $resolvedRoot,
        'tenant_root_mode' => substr(sprintf('%o', fileperms($root)), -4),
        'company_config_mode' => substr(sprintf('%o', fileperms($configFile)), -4),
        'area_modes' => $areaModes,
        'null_inventory' => $counts,
        'no_symlinks' => true,
        'neutral_template' => true,
    ];
}

$stage = 'database';
try {
    $pdo = lehrfahrer_control_database();
    if (lehrfahrer_control_driver($pdo) !== 'mysql') {
        throw new RuntimeException('Staging-Control-DB ist nicht MariaDB.');
    }
    $stage = 'tls';
    $tlsStatus = $pdo->query("SHOW STATUS LIKE 'Ssl_cipher'")->fetch();
    if (!is_array($tlsStatus) || trim((string)($tlsStatus['Value'] ?? '')) === '') {
        throw new RuntimeException('MariaDB-Verbindung verwendet kein TLS.');
    }

    $stage = 'test-company';
    $companies = new LehrfahrerCompanyRepository($pdo);
    $testCompany = $companies->findBySlug('lehrfahrer-test');
    if (!is_array($testCompany)) {
        throw new RuntimeException('Staging-Testgesellschaft fehlt.');
    }
    $stage = 'test-fingerprint-before';
    $testFingerprintBefore = lehrfahrer_cottbus_fingerprint($pdo, $testCompany);

    $stage = 'cottbus-lookup';
    $company = $companies->findBySlug('cottbusverkehr');
    $created = false;
    $activationToken = null;
    if ($company === null) {
        $stage = 'cottbus-create';
        $provisioned = lehrfahrer_create_company_from_template($pdo, [
            'name' => 'Cottbusverkehr',
            'slug' => 'cottbusverkehr',
            'license_status' => 'active',
            'license_id' => null,
            'admin_display_name' => 'Cottbus Admin',
            'admin_login' => 'cottbus-admin',
            'admin_email' => null,
        ]);
        $company = $provisioned['company'];
        $activationToken = $provisioned['activation']['token'];
        $created = true;
    }

    $stage = 'cottbus-validate';
    $validation = lehrfahrer_cottbus_validate($pdo, $company, $activationToken);
    $stage = 'test-fingerprint-after';
    $testCompanyAfter = $companies->findBySlug('lehrfahrer-test');
    if (!is_array($testCompanyAfter)) throw new RuntimeException('Staging-Testgesellschaft fehlt nach Provisionierung.');
    $testFingerprintAfter = lehrfahrer_cottbus_fingerprint($pdo, $testCompanyAfter);
    if (!hash_equals($testFingerprintBefore, $testFingerprintAfter)) {
        throw new RuntimeException('Staging-Testgesellschaft wurde waehrend der Provisionierung veraendert.');
    }
    $stage = 'cottbus-uniqueness';
    $duplicateCount = $pdo->prepare('SELECT COUNT(*) FROM companies WHERE slug = :slug');
    $duplicateCount->execute([':slug' => 'cottbusverkehr']);
    if ((int)$duplicateCount->fetchColumn() !== 1) {
        throw new RuntimeException('Cottbus-Gesellschaft ist nicht eindeutig.');
    }

    $stage = 'result';
    $result = array_merge([
        'ok' => true,
        'company_id' => $company['id'],
        'name' => $company['name'],
        'slug' => $company['slug'],
        'license_status' => $company['license_status'],
        'license_id' => $company['license_id'],
        'template_version' => (int)$company['template_version_current'],
        'created' => $created,
        'activation_token_generated' => $activationToken !== null,
        'test_company_fingerprint_before' => $testFingerprintBefore,
        'test_company_fingerprint_after' => $testFingerprintAfter,
        'test_company_unchanged' => true,
    ], $validation);
    $json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    $activationToken = null;
    unset($provisioned);

    if ($cgiProvision) {
        $temporaryResult = $resultFile . '.tmp.' . getmypid();
        try {
            if (file_put_contents($temporaryResult, $json, LOCK_EX) !== strlen($json)
                || !chmod($temporaryResult, 0600) || !rename($temporaryResult, $resultFile)) {
                throw new RuntimeException('CGI-Ergebnisdatei konnte nicht atomar geschrieben werden.');
            }
        } finally {
            if (is_file($temporaryResult)) unlink($temporaryResult);
        }
    } else {
        fwrite(STDOUT, $json);
    }
} catch (Throwable $error) {
    lehrfahrer_cottbus_provision_error('Cottbus-Staging-Provisioning fehlgeschlagen [' . $stage . '].');
    exit(1);
}
