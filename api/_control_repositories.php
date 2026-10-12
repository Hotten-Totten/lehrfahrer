<?php

require_once __DIR__ . '/_control_database.php';
require_once __DIR__ . '/_control_passwords.php';

function lehrfahrer_control_id(string $prefix): string {
    return $prefix . '_' . bin2hex(random_bytes(16));
}

function lehrfahrer_control_normalize_login(string $value): string {
    $normalized = trim($value);
    if (function_exists('mb_strtolower')) return mb_strtolower($normalized, 'UTF-8');
    return strtolower($normalized);
}

function lehrfahrer_control_normalize_email(?string $value): ?string {
    $normalized = lehrfahrer_control_normalize_login((string)$value);
    return $normalized === '' ? null : $normalized;
}

final class LehrfahrerCompanyRepository {
    public function __construct(private PDO $pdo) {}

    public function create(array $company): array {
        $slug = strtolower(trim((string)($company['slug'] ?? '')));
        $name = trim((string)($company['name'] ?? ''));
        $status = trim((string)($company['status'] ?? 'active'));
        if (!preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $slug)) {
            throw new InvalidArgumentException('Ungültiger Gesellschafts-Slug.');
        }
        if ($name === '') throw new InvalidArgumentException('Gesellschaftsname fehlt.');
        if (!in_array($status, ['active', 'inactive'], true)) {
            throw new InvalidArgumentException('Ungültiger Gesellschaftsstatus.');
        }

        $id = trim((string)($company['id'] ?? '')) ?: lehrfahrer_control_id('cmp');
        $now = gmdate('c');
        $statement = $this->pdo->prepare(
            'INSERT INTO companies
             (id, slug, name, status, license_id, license_status, created_at, updated_at)
             VALUES
             (:id, :slug, :name, :status, :license_id, :license_status, :created_at, :updated_at)'
        );
        $statement->execute([
            ':id' => $id,
            ':slug' => $slug,
            ':name' => $name,
            ':status' => $status,
            ':license_id' => ($company['license_id'] ?? null) ?: null,
            ':license_status' => trim((string)($company['license_status'] ?? 'inactive')),
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);
        return $this->findById($id) ?? throw new RuntimeException('Gesellschaft konnte nicht gelesen werden.');
    }

    public function findById(string $companyId): ?array {
        $statement = $this->pdo->prepare(
            'SELECT id, slug, name, status, license_id, license_status, created_at, updated_at
             FROM companies WHERE id = :company_id'
        );
        $statement->execute([':company_id' => $companyId]);
        $company = $statement->fetch();
        return is_array($company) ? $company : null;
    }

    public function findBySlug(string $slug): ?array {
        $statement = $this->pdo->prepare(
            'SELECT id, slug, name, status, license_id, license_status, created_at, updated_at
             FROM companies WHERE slug = :slug'
        );
        $statement->execute([':slug' => strtolower(trim($slug))]);
        $company = $statement->fetch();
        return is_array($company) ? $company : null;
    }
}

final class LehrfahrerUserRepository {
    public function __construct(private PDO $pdo) {}

    public function create(string $companyId, array $user): array {
        $this->requireCompany($companyId);
        $login = lehrfahrer_control_normalize_login((string)($user['login'] ?? ''));
        $displayName = trim((string)($user['display_name'] ?? ''));
        $password = (string)($user['password'] ?? '');
        if ($login === '') throw new InvalidArgumentException('Loginname fehlt.');
        if ($displayName === '') throw new InvalidArgumentException('Anzeigename fehlt.');

        $id = trim((string)($user['id'] ?? '')) ?: lehrfahrer_control_id('usr');
        $now = gmdate('c');
        $statement = $this->pdo->prepare(
            'INSERT INTO users
             (id, company_id, login_normalized, email_normalized, display_name, password_hash,
              active, must_change_password, last_login, blocked_until, created_at, updated_at)
             VALUES
             (:id, :company_id, :login, :email, :display_name, :password_hash,
              :active, :must_change_password, NULL, NULL, :created_at, :updated_at)'
        );
        try {
            $statement->execute([
                ':id' => $id,
                ':company_id' => $companyId,
                ':login' => $login,
                ':email' => lehrfahrer_control_normalize_email($user['email'] ?? null),
                ':display_name' => $displayName,
                ':password_hash' => lehrfahrer_password_hash($password),
                ':active' => array_key_exists('active', $user) ? (int)(bool)$user['active'] : 1,
                ':must_change_password' => (int)(bool)($user['must_change_password'] ?? false),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') {
                throw new DomainException('Loginname ist in dieser Gesellschaft bereits vergeben.', 0, $error);
            }
            throw $error;
        }
        return $this->findById($companyId, $id)
            ?? throw new RuntimeException('Benutzer konnte nicht gelesen werden.');
    }

    public function findById(string $companyId, string $userId): ?array {
        $statement = $this->pdo->prepare(
            'SELECT id, company_id, login_normalized, email_normalized, display_name,
                    active, must_change_password, last_login, blocked_until, created_at, updated_at
             FROM users
             WHERE company_id = :company_id AND id = :user_id'
        );
        $statement->execute([':company_id' => $companyId, ':user_id' => $userId]);
        $user = $statement->fetch();
        return is_array($user) ? $user : null;
    }

    public function findByLogin(string $companyId, string $login): ?array {
        $statement = $this->pdo->prepare(
            'SELECT id, company_id, login_normalized, email_normalized, display_name,
                    active, must_change_password, last_login, blocked_until, created_at, updated_at
             FROM users
             WHERE company_id = :company_id AND login_normalized = :login'
        );
        $statement->execute([
            ':company_id' => $companyId,
            ':login' => lehrfahrer_control_normalize_login($login),
        ]);
        $user = $statement->fetch();
        return is_array($user) ? $user : null;
    }

    public function findAuthenticationRecordByLogin(string $companyId, string $login): ?array {
        $statement = $this->pdo->prepare(
            'SELECT id, company_id, login_normalized, email_normalized, display_name, password_hash,
                    active, must_change_password, last_login, blocked_until, created_at, updated_at
             FROM users
             WHERE company_id = :company_id AND login_normalized = :login'
        );
        $statement->execute([
            ':company_id' => $companyId,
            ':login' => lehrfahrer_control_normalize_login($login),
        ]);
        $user = $statement->fetch();
        return is_array($user) ? $user : null;
    }

    public function markSuccessfulLogin(string $companyId, string $userId, string $timestamp): void {
        $statement = $this->pdo->prepare(
            'UPDATE users
             SET last_login = :last_login, updated_at = :updated_at
             WHERE company_id = :company_id AND id = :user_id'
        );
        $statement->execute([
            ':last_login' => $timestamp,
            ':updated_at' => $timestamp,
            ':company_id' => $companyId,
            ':user_id' => $userId,
        ]);
        if ($statement->rowCount() !== 1) {
            throw new InvalidArgumentException('Benutzer wurde in dieser Gesellschaft nicht gefunden.');
        }
    }

    public function listForCompany(string $companyId): array {
        $statement = $this->pdo->prepare(
            'SELECT id, company_id, login_normalized, email_normalized, display_name,
                    active, must_change_password, last_login, blocked_until, created_at, updated_at
             FROM users
             WHERE company_id = :company_id
             ORDER BY LOWER(display_name), id'
        );
        $statement->execute([':company_id' => $companyId]);
        return $statement->fetchAll();
    }

    private function requireCompany(string $companyId): void {
        $statement = $this->pdo->prepare('SELECT 1 FROM companies WHERE id = :company_id');
        $statement->execute([':company_id' => $companyId]);
        if ($statement->fetchColumn() === false) {
            throw new InvalidArgumentException('Gesellschaft wurde nicht gefunden.');
        }
    }
}

final class LehrfahrerRoleRepository {
    public function __construct(private PDO $pdo) {}

    public function roleCapabilities(string $roleCode): array {
        $statement = $this->pdo->prepare(
            'SELECT capabilities.code
             FROM capabilities
             JOIN role_capabilities ON role_capabilities.capability_id = capabilities.id
             JOIN roles ON roles.id = role_capabilities.role_id
             WHERE roles.code = :role_code
             ORDER BY capabilities.code'
        );
        $statement->execute([':role_code' => strtoupper(trim($roleCode))]);
        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    public function assignRole(string $companyId, string $userId, string $roleCode): void {
        $userStatement = $this->pdo->prepare(
            'SELECT 1 FROM users WHERE company_id = :company_id AND id = :user_id'
        );
        $userStatement->execute([':company_id' => $companyId, ':user_id' => $userId]);
        if ($userStatement->fetchColumn() === false) {
            throw new InvalidArgumentException('Benutzer wurde in dieser Gesellschaft nicht gefunden.');
        }

        $statement = $this->pdo->prepare(
            'INSERT INTO user_roles (user_id, role_id)
             SELECT :user_id, roles.id FROM roles
             WHERE roles.code = :role_code
               AND NOT EXISTS (
                   SELECT 1 FROM user_roles
                   WHERE user_id = :existing_user_id AND role_id = roles.id
               )'
        );
        $statement->execute([
            ':user_id' => $userId,
            ':existing_user_id' => $userId,
            ':role_code' => strtoupper(trim($roleCode)),
        ]);
        if ($statement->rowCount() === 0 && !$this->hasRole($companyId, $userId, $roleCode)) {
            throw new InvalidArgumentException('Rolle wurde nicht gefunden.');
        }
    }

    public function userCapabilities(string $companyId, string $userId): array {
        $statement = $this->pdo->prepare(
            'SELECT DISTINCT capabilities.code
             FROM users
             JOIN user_roles ON user_roles.user_id = users.id
             JOIN role_capabilities ON role_capabilities.role_id = user_roles.role_id
             JOIN capabilities ON capabilities.id = role_capabilities.capability_id
             WHERE users.company_id = :company_id AND users.id = :user_id
             ORDER BY capabilities.code'
        );
        $statement->execute([':company_id' => $companyId, ':user_id' => $userId]);
        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    private function hasRole(string $companyId, string $userId, string $roleCode): bool {
        $statement = $this->pdo->prepare(
            'SELECT 1
             FROM users
             JOIN user_roles ON user_roles.user_id = users.id
             JOIN roles ON roles.id = user_roles.role_id
             WHERE users.company_id = :company_id AND users.id = :user_id AND roles.code = :role_code'
        );
        $statement->execute([
            ':company_id' => $companyId,
            ':user_id' => $userId,
            ':role_code' => strtoupper(trim($roleCode)),
        ]);
        return $statement->fetchColumn() !== false;
    }
}
