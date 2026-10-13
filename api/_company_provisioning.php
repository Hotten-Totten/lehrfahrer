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

// Internal provisioning operation only. Callers must be trusted server-side operators;
// never expose this function through an HTTP endpoint or log its returned token.
function lehrfahrer_reissue_company_admin_activation(PDO $pdo, string $companyId, string $login): array {
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Reissue benoetigt eine eigene Datenbanktransaktion.');
    }
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', $companyId) !== 1
        || $login === '' || lehrfahrer_control_normalize_login($login) !== $login) {
        throw new InvalidArgumentException('Ungueltige Reissue-Zuordnung.');
    }

    $sqlite = lehrfahrer_control_driver($pdo) === 'sqlite';
    $transactionOpen = false;
    try {
        if ($sqlite) $pdo->exec('BEGIN IMMEDIATE');
        else $pdo->beginTransaction();
        $transactionOpen = true;

        $sql = 'SELECT users.id, users.active, users.must_change_password
            FROM users JOIN user_roles ON user_roles.user_id = users.id
            JOIN roles ON roles.id = user_roles.role_id AND roles.code = :role_code
            WHERE users.company_id = :company_id AND users.login_normalized = :login';
        if (!$sqlite) $sql .= ' FOR UPDATE';
        $user = $pdo->prepare($sql);
        $user->execute([
            ':role_code' => 'ADMIN', ':company_id' => $companyId, ':login' => $login,
        ]);
        $admins = $user->fetchAll();
        if (count($admins) !== 1 || (int)$admins[0]['active'] !== 0
            || (int)$admins[0]['must_change_password'] !== 1) {
            throw new DomainException('Reissue nicht zulaessig.');
        }

        $sql = 'SELECT id, token_hash, used_at FROM user_activation_tokens
            WHERE company_id = :company_id AND user_id = :user_id';
        if (!$sqlite) $sql .= ' FOR UPDATE';
        $existing = $pdo->prepare($sql);
        $existing->execute([':company_id' => $companyId, ':user_id' => $admins[0]['id']]);
        $records = $existing->fetchAll();
        if (count($records) !== 1 || $records[0]['used_at'] !== null) {
            throw new DomainException('Reissue nicht zulaessig.');
        }

        $token = lehrfahrer_company_activation_token();
        $now = gmdate('c');
        $expiresAt = gmdate('c', time() + LEHRFAHRER_COMPANY_ACTIVATION_TTL_SECONDS);
        $replace = $pdo->prepare('UPDATE user_activation_tokens
            SET token_hash = :new_hash, created_at = :created_at, expires_at = :expires_at
            WHERE id = :id AND company_id = :company_id AND user_id = :user_id
                AND token_hash = :old_hash AND used_at IS NULL');
        $replace->execute([
            ':new_hash' => lehrfahrer_company_activation_token_hash($token),
            ':created_at' => $now, ':expires_at' => $expiresAt,
            ':id' => $records[0]['id'], ':company_id' => $companyId,
            ':user_id' => $admins[0]['id'], ':old_hash' => $records[0]['token_hash'],
        ]);
        if ($replace->rowCount() !== 1) {
            throw new RuntimeException('Reissue konnte nicht atomar abgeschlossen werden.');
        }

        if ($sqlite) $pdo->exec('COMMIT');
        else $pdo->commit();
        $transactionOpen = false;
        return ['token' => $token, 'expires_at' => $expiresAt];
    } catch (Throwable $error) {
        if ($transactionOpen) {
            if ($sqlite) $pdo->exec('ROLLBACK');
            else $pdo->rollBack();
        }
        throw $error;
    }
}

function lehrfahrer_activate_company_admin(PDO $pdo, string $token, string $password): array {
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Aktivierung benoetigt eine eigene Datenbanktransaktion.');
    }
    if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
        throw new InvalidArgumentException('Ungueltiger Aktivierungstoken.');
    }
    if (strlen($password) < 14) {
        throw new InvalidArgumentException('Das neue Passwort muss mindestens 14 Zeichen lang sein.');
    }

    $sqlite = lehrfahrer_control_driver($pdo) === 'sqlite';
    $transactionOpen = false;
    try {
        if ($sqlite) {
            $pdo->exec('BEGIN IMMEDIATE');
        } else {
            $pdo->beginTransaction();
        }
        $transactionOpen = true;
        $sql =
            'SELECT user_activation_tokens.id, user_activation_tokens.user_id,
                    user_activation_tokens.company_id, user_activation_tokens.expires_at,
                    user_activation_tokens.used_at
             FROM user_activation_tokens
             JOIN user_roles ON user_roles.user_id = user_activation_tokens.user_id
             JOIN roles ON roles.id = user_roles.role_id AND roles.code = :role_code
             WHERE user_activation_tokens.token_hash = :token_hash';
        if (lehrfahrer_control_driver($pdo) === 'mysql') $sql .= ' FOR UPDATE';
        $statement = $pdo->prepare($sql);
        $statement->execute([
            ':role_code' => 'ADMIN',
            ':token_hash' => lehrfahrer_company_activation_token_hash($token),
        ]);
        $activation = $statement->fetch();
        $expiresAt = is_array($activation) ? strtotime((string)$activation['expires_at']) : false;
        if (!is_array($activation) || $activation['used_at'] !== null
            || $expiresAt === false || $expiresAt <= time()) {
            throw new DomainException('Aktivierungstoken ist ungueltig, abgelaufen oder bereits verwendet.');
        }

        $now = gmdate('c');
        $updateUser = $pdo->prepare(
            'UPDATE users
             SET password_hash = :password_hash, active = 1, must_change_password = 0, updated_at = :updated_at
             WHERE id = :user_id AND company_id = :company_id AND active = 0'
        );
        $updateUser->execute([
            ':password_hash' => lehrfahrer_password_hash($password),
            ':updated_at' => $now,
            ':user_id' => $activation['user_id'],
            ':company_id' => $activation['company_id'],
        ]);
        if ($updateUser->rowCount() !== 1) {
            throw new DomainException('Der zugehoerige Admin kann nicht aktiviert werden.');
        }
        // The token hash and its expiry must not remain usable or stored after activation.
        $consume = $pdo->prepare(
            'DELETE FROM user_activation_tokens
             WHERE id = :id AND token_hash = :token_hash AND used_at IS NULL'
        );
        $consume->execute([
            ':id' => $activation['id'],
            ':token_hash' => lehrfahrer_company_activation_token_hash($token),
        ]);
        if ($consume->rowCount() !== 1) {
            throw new DomainException('Aktivierungstoken wurde bereits verwendet.');
        }
        if ($sqlite) {
            $pdo->exec('COMMIT');
        } else {
            $pdo->commit();
        }
        $transactionOpen = false;
        return [
            'company_id' => $activation['company_id'],
            'user_id' => $activation['user_id'],
            'activated_at' => $now,
        ];
    } catch (Throwable $error) {
        if ($transactionOpen) {
            if ($sqlite) $pdo->exec('ROLLBACK');
            else $pdo->rollBack();
        }
        throw $error;
    }
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
