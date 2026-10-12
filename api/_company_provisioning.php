<?php

require_once __DIR__ . '/_control_repositories.php';
require_once __DIR__ . '/_master_tenant_template.php';

const LEHRFAHRER_COMPANY_ACTIVATION_TTL_SECONDS = 172800;

function lehrfahrer_company_activation_token(): string {
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function lehrfahrer_company_activation_token_hash(string $token): string {
    return hash('sha256', $token);
}

function lehrfahrer_company_provision_validate(array $input): array {
    $name = trim((string)($input['name'] ?? ''));
    $slug = strtolower(trim((string)($input['slug'] ?? '')));
    $licenseStatus = strtolower(trim((string)($input['license_status'] ?? '')));
    $licenseId = trim((string)($input['license_id'] ?? ''));
    $adminDisplayName = trim((string)($input['admin_display_name'] ?? ''));
    $adminLogin = trim((string)($input['admin_login'] ?? ''));
    $adminEmail = lehrfahrer_control_normalize_email($input['admin_email'] ?? null);

    if ($name === '' || $adminDisplayName === '' || $adminLogin === '') {
        throw new InvalidArgumentException('Gesellschaftsname und Admin-Angaben sind erforderlich.');
    }
    if (!preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/D', $slug)) {
        throw new InvalidArgumentException('Ungueltiger Gesellschafts-Slug.');
    }
    if (!in_array($licenseStatus, ['active', 'inactive', 'trial', 'suspended', 'expired'], true)) {
        throw new InvalidArgumentException('Ungueltiger Lizenzstatus.');
    }
    if ($adminEmail !== null && filter_var($adminEmail, FILTER_VALIDATE_EMAIL) === false) {
        throw new InvalidArgumentException('Ungueltige Admin-E-Mail-Adresse.');
    }

    return [
        'name' => $name,
        'slug' => $slug,
        'license_status' => $licenseStatus,
        'license_id' => $licenseId === '' ? null : $licenseId,
        'admin_display_name' => $adminDisplayName,
        'admin_login' => $adminLogin,
        'admin_email' => $adminEmail,
    ];
}

function lehrfahrer_company_config(array $company, array $template): array {
    $version = (int)$template['template_version'];
    return [
        'schema_version' => 1,
        'company' => [
            'company_id' => $company['id'],
            'name' => $company['name'],
            'slug' => $company['slug'],
            'license_status' => $company['license_status'],
            'license_id' => $company['license_id'],
        ],
        'template' => [
            'version_created' => $version,
            'version_current' => $version,
        ],
        'defaults' => [
            'feature_flags' => $template['feature_flags'],
            'system_settings' => $template['system_settings'],
        ],
        'overrides' => [
            'feature_flags' => new stdClass(),
            'system_settings' => new stdClass(),
        ],
        'created_at' => $company['created_at'],
    ];
}

function lehrfahrer_company_write_config(string $companyId, array $config): string {
    $path = lehrfahrer_tenant_path($companyId, 'settings', 'company.json', true);
    if (file_exists($path) || is_link($path)) {
        throw new RuntimeException('Gesellschaftsconfig existiert bereits.');
    }
    $json = json_encode(
        $config,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
    $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    try {
        if (file_put_contents($temporary, $json, LOCK_EX) !== strlen($json)) {
            throw new RuntimeException('Gesellschaftsconfig konnte nicht geschrieben werden.');
        }
        @chmod($temporary, 0600);
        if (!@rename($temporary, $path)) {
            throw new RuntimeException('Gesellschaftsconfig konnte nicht aktiviert werden.');
        }
        @chmod($path, 0600);
    } finally {
        if (is_file($temporary)) @unlink($temporary);
    }
    return $path;
}

function lehrfahrer_company_remove_uncommitted_tenant(string $companyId): void {
    $root = lehrfahrer_tenant_root($companyId);
    if (!file_exists($root) && !is_link($root)) return;
    lehrfahrer_tenant_check_existing_path($root, true);
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isDir() && !$item->isLink()) {
            if (!@rmdir($item->getPathname())) {
                throw new RuntimeException('Unvollstaendiger Tenant konnte nicht bereinigt werden.');
            }
        } elseif (!@unlink($item->getPathname())) {
            throw new RuntimeException('Unvollstaendiger Tenant konnte nicht bereinigt werden.');
        }
    }
    if (!@rmdir($root)) {
        throw new RuntimeException('Unvollstaendiger Tenant konnte nicht bereinigt werden.');
    }
}

function lehrfahrer_create_company_from_template(PDO $pdo, array $input): array {
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Provisioning benoetigt eine eigene Datenbanktransaktion.');
    }
    $values = lehrfahrer_company_provision_validate($input);
    $template = lehrfahrer_master_tenant_template();
    $templateVersion = (int)$template['template_version'];
    $companyId = lehrfahrer_control_id('cmp');
    $activationToken = lehrfahrer_company_activation_token();
    $createdAt = gmdate('c');
    $expiresAt = gmdate('c', time() + LEHRFAHRER_COMPANY_ACTIVATION_TTL_SECONDS);
    $tenantCreated = false;

    try {
        $pdo->beginTransaction();
        $companies = new LehrfahrerCompanyRepository($pdo);
        $users = new LehrfahrerUserRepository($pdo);
        $roles = new LehrfahrerRoleRepository($pdo);
        $company = $companies->create([
            'id' => $companyId,
            'name' => $values['name'],
            'slug' => $values['slug'],
            'status' => 'active',
            'license_status' => $values['license_status'],
            'license_id' => $values['license_id'],
            'template_version_created' => $templateVersion,
            'template_version_current' => $templateVersion,
        ]);
        $admin = $users->create($companyId, [
            'login' => $values['admin_login'],
            'display_name' => $values['admin_display_name'],
            'email' => $values['admin_email'],
            'password' => bin2hex(random_bytes(32)),
            'active' => false,
            'must_change_password' => true,
        ]);
        $roles->assignRole($companyId, $admin['id'], 'ADMIN');

        $activation = $pdo->prepare(
            'INSERT INTO user_activation_tokens
             (id, user_id, company_id, token_hash, created_at, expires_at, used_at)
             VALUES (:id, :user_id, :company_id, :token_hash, :created_at, :expires_at, NULL)'
        );
        $activation->execute([
            ':id' => lehrfahrer_control_id('act'),
            ':user_id' => $admin['id'],
            ':company_id' => $companyId,
            ':token_hash' => lehrfahrer_company_activation_token_hash($activationToken),
            ':created_at' => $createdAt,
            ':expires_at' => $expiresAt,
        ]);

        lehrfahrer_tenant_root($companyId, true);
        $tenantCreated = true;
        foreach ($template['tenant_areas'] as $area) {
            lehrfahrer_tenant_area($companyId, (string)$area, true);
        }
        $config = lehrfahrer_company_config($company, $template);
        lehrfahrer_company_write_config($companyId, $config);
        $pdo->commit();

        return [
            'company' => $company,
            'admin' => $admin,
            'activation' => [
                'token' => $activationToken,
                'expires_at' => $expiresAt,
            ],
            'config' => $config,
        ];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($tenantCreated) {
            try {
                lehrfahrer_company_remove_uncommitted_tenant($companyId);
            } catch (Throwable $_cleanupError) {
                throw new RuntimeException(
                    'Provisioning fehlgeschlagen; unvollstaendiger Tenant konnte nicht bereinigt werden.',
                    0,
                    $error
                );
            }
        }
        throw $error;
    }
}
