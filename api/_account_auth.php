<?php
declare(strict_types=1);

require_once __DIR__ . '/_session_auth.php';
require_once __DIR__ . '/_auth_cutover_gate.php';

/** P2.1 is a staging-only, parallel test lane; the old session cookie remains untouched. */
const LEHRFAHRER_ACCOUNT_TEST_COOKIE = '__Host-lehrfahrer_account_test';

function lehrfahrer_account_test_only(): void {
    if (lehrfahrer_environment() !== 'staging') {
        lehrfahrer_auth_json_response(404, ['ok' => false, 'error' => 'Nicht verfügbar.']);
    }
}

function lehrfahrer_account_cookie_token(): string {
    $token = $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] ?? '';
    return is_string($token) && preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) === 1 ? $token : '';
}

function lehrfahrer_account_set_cookie(string $token, int $expires): void {
    if (!setcookie(LEHRFAHRER_ACCOUNT_TEST_COOKIE, $token, lehrfahrer_auth_cookie_options($expires))) {
        throw new RuntimeException('Account-Sessioncookie konnte nicht gesetzt werden.');
    }
}

function lehrfahrer_account_clear_cookie(): void {
    setcookie(LEHRFAHRER_ACCOUNT_TEST_COOKIE, '', lehrfahrer_auth_cookie_options(time() - 3600));
}

function lehrfahrer_account_memberships(PDO $pdo, string $accountId): array {
    $query = $pdo->prepare('SELECT m.id, c.id AS company_id, c.slug, c.name
        FROM account_memberships m JOIN companies c ON c.id = m.company_id
        WHERE m.account_id = ? AND m.status = ? AND c.status = ? ORDER BY c.slug, m.id');
    $query->execute([$accountId, 'active', 'active']);
    return $query->fetchAll(PDO::FETCH_ASSOC);
}

function lehrfahrer_account_platform_capabilities(PDO $pdo, string $accountId): array {
    $query = $pdo->prepare("SELECT DISTINCT pc.code FROM platform_capabilities pc
        JOIN platform_role_capabilities prc ON prc.capability_id = pc.id
        JOIN platform_roles pr ON pr.id = prc.role_id
        WHERE (pr.code = 'COSYSOP' AND EXISTS
            (SELECT 1 FROM account_platform_roles apr WHERE apr.account_id = ? AND apr.role_code = pr.code))
           OR (pr.code = 'SYSOP' AND EXISTS
            (SELECT 1 FROM sysop_assignment sa WHERE sa.account_id = ?))
        ORDER BY pc.code");
    $query->execute([$accountId, $accountId]);
    return $query->fetchAll(PDO::FETCH_COLUMN);
}

function lehrfahrer_account_tenant_capabilities(PDO $pdo, string $accountId, string $membershipId): array {
    $query = $pdo->prepare("SELECT DISTINCT cap.code FROM account_memberships m
        JOIN companies c ON c.id = m.company_id
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        JOIN role_capabilities rc ON rc.role_id = r.id
        JOIN capabilities cap ON cap.id = rc.capability_id
        WHERE m.id = ? AND m.account_id = ? AND m.status = 'active' AND c.status = 'active'
        ORDER BY cap.code");
    $query->execute([$membershipId, $accountId]);
    return $query->fetchAll(PDO::FETCH_COLUMN);
}

function lehrfahrer_account_create_session(PDO $pdo, string $accountId, string $context,
    ?string $membershipId, ?string $deviceLabel = null): array {
    return lehrfahrer_with_auth_mutation_gate($pdo,
        static fn(): array => lehrfahrer_account_create_session_unguarded($pdo, $accountId, $context, $membershipId, $deviceLabel));
}

function lehrfahrer_account_create_session_unguarded(PDO $pdo, string $accountId, string $context,
    ?string $membershipId, ?string $deviceLabel = null): array {
    if (!in_array($context, ['PENDING', 'TENANT', 'PLATFORM'], true)
        || ($context === 'TENANT') !== ($membershipId !== null)) {
        throw new InvalidArgumentException('Ungültiger Account-Sessionkontext.');
    }
    $now = time();
    $token = lehrfahrer_auth_random_token();
    $tokenHash = lehrfahrer_auth_token_hash($token);
    $csrf = lehrfahrer_auth_csrf_token($token);
    $label = trim((string)$deviceLabel);
    $label = function_exists('mb_substr') ? mb_substr($label, 0, 120, 'UTF-8') : substr($label, 0, 120);
    $ip = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    $agent = trim((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $query = $pdo->prepare('INSERT INTO account_sessions
        (id, account_id, session_token_hash, csrf_token_hash, context_type, membership_id,
         technical_company_id, environment, created_at, last_activity_at, idle_expires_at,
         absolute_expires_at, revoked_at, ip_hash, user_agent_hash, device_label)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?)');
    $query->execute([lehrfahrer_control_id('ases'), $accountId, $tokenHash,
        lehrfahrer_auth_token_hash($csrf), $context, $membershipId, lehrfahrer_environment(),
        lehrfahrer_auth_timestamp($now), lehrfahrer_auth_timestamp($now),
        lehrfahrer_auth_timestamp($now + LEHRFAHRER_SESSION_IDLE_SECONDS),
        lehrfahrer_auth_timestamp($now + LEHRFAHRER_SESSION_ABSOLUTE_SECONDS),
        $ip === '' ? null : hash_hmac('sha256', $ip, $tokenHash),
        $agent === '' ? null : hash_hmac('sha256', $agent, $tokenHash),
        $label === '' ? null : $label]);
    return ['token' => $token, 'csrf' => $csrf,
        'absoluteExpiresAt' => $now + LEHRFAHRER_SESSION_ABSOLUTE_SECONDS];
}

function lehrfahrer_account_login(PDO $pdo, string $login, string $password, ?string $deviceLabel = null): ?array {
    return lehrfahrer_with_auth_mutation_gate($pdo,
        static fn(): ?array => lehrfahrer_account_login_unguarded($pdo, $login, $password, $deviceLabel));
}

function lehrfahrer_account_login_unguarded(PDO $pdo, string $login, string $password, ?string $deviceLabel = null): ?array {
    $normalized = lehrfahrer_control_normalize_login($login);
    $query = $pdo->prepare('SELECT id, password_hash, active, must_change_password, blocked_until
        FROM accounts WHERE login_normalized = ?');
    $query->execute([$normalized]);
    $account = $query->fetch(PDO::FETCH_ASSOC);
    $dummyHash = '$2y$10$WfMzXGqoRwpCEPrb53v.7O7P7JbGfIxV9qz2nMVRRb6wjXZXUPmPe';
    $passwordValid = lehrfahrer_password_verify($password,
        is_array($account) ? (string)$account['password_hash'] : $dummyHash);
    $blocked = is_array($account) ? $account['blocked_until'] : null;
    $blockedUntil = $blocked === null ? null : strtotime((string)$blocked);
    if (!is_array($account) || $normalized === '' || $password === '' || !$passwordValid
        || (int)$account['active'] !== 1 || (int)$account['must_change_password'] !== 0
        || ($blocked !== null && ($blockedUntil === false || $blockedUntil > time()))) return null;
    $memberships = lehrfahrer_account_memberships($pdo, (string)$account['id']);
    $platform = lehrfahrer_account_platform_capabilities($pdo, (string)$account['id']);
    $count = count($memberships);
    $context = $count === 1 ? 'TENANT' : ($count === 0 && $platform !== [] ? 'PLATFORM' : 'PENDING');
    $membershipId = $context === 'TENANT' ? (string)$memberships[0]['id'] : null;
    $previous = lehrfahrer_account_cookie_token();
    if ($previous !== '') {
        $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, ?)
            WHERE session_token_hash = ? AND environment = ?');
        $revoke->execute([lehrfahrer_auth_timestamp(time()), lehrfahrer_auth_token_hash($previous),
            lehrfahrer_environment()]);
    }
    $created = lehrfahrer_account_create_session($pdo, (string)$account['id'], $context, $membershipId, $deviceLabel);
    return $created + ['accountId' => (string)$account['id'], 'context' => $context];
}

function lehrfahrer_account_current_session(PDO $pdo, bool $touch = true,
    bool $lock = false): ?array {
    $token = lehrfahrer_account_cookie_token();
    if ($token === '') return null;
    $query = $pdo->prepare('SELECT s.*, a.active AS account_active, a.must_change_password,
        a.blocked_until FROM account_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.session_token_hash = ? AND s.environment = ?' .
        ($lock && lehrfahrer_control_driver($pdo) === 'mysql' ? ' FOR UPDATE' : ''));
    $query->execute([lehrfahrer_auth_token_hash($token), lehrfahrer_environment()]);
    $session = $query->fetch(PDO::FETCH_ASSOC);
    if (!is_array($session)) return null;
    $now = time();
    $idle = strtotime((string)$session['idle_expires_at']);
    $absolute = strtotime((string)$session['absolute_expires_at']);
    $blocked = $session['blocked_until'];
    $blockedUntil = $blocked === null ? null : strtotime((string)$blocked);
    if ($session['revoked_at'] !== null || $idle === false || $idle <= $now
        || $absolute === false || $absolute <= $now || (int)$session['account_active'] !== 1
        || (int)$session['must_change_password'] !== 0
        || ($blocked !== null && ($blockedUntil === false || $blockedUntil > $now))) return null;
    if ($session['context_type'] === 'TENANT') {
        $memberships = lehrfahrer_account_memberships($pdo, (string)$session['account_id']);
        $allowed = array_filter($memberships,
            static fn(array $item): bool => (string)$item['id'] === (string)$session['membership_id']);
        if (count($allowed) !== 1) return null;
    } elseif ($session['context_type'] === 'PLATFORM') {
        if (lehrfahrer_account_platform_capabilities($pdo, (string)$session['account_id']) === []) return null;
    } elseif ($session['context_type'] !== 'PENDING' || $session['membership_id'] !== null) return null;
    $last = strtotime((string)$session['last_activity_at']);
    if ($touch && ($last === false || $now - $last >= LEHRFAHRER_SESSION_TOUCH_INTERVAL_SECONDS)) {
        $query = $pdo->prepare('UPDATE account_sessions
            SET last_activity_at = ?, idle_expires_at = ? WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $query->execute([lehrfahrer_auth_timestamp($now),
            lehrfahrer_auth_timestamp(min($now + LEHRFAHRER_SESSION_IDLE_SECONDS, $absolute)),
            $session['id'], lehrfahrer_environment()]);
        if ($query->rowCount() !== 1) return null;
        $session['last_activity_at'] = lehrfahrer_auth_timestamp($now);
        $session['idle_expires_at'] = lehrfahrer_auth_timestamp(min($now + LEHRFAHRER_SESSION_IDLE_SECONDS, $absolute));
    }
    $session['_token'] = $token;
    return $session;
}

function lehrfahrer_account_public_session(PDO $pdo, array $session): array {
    $context = (string)$session['context_type'];
    $accountId = (string)$session['account_id'];
    $memberships = $context === 'PENDING' ? lehrfahrer_account_memberships($pdo, $accountId) : [];
    $tenantCapabilities = $context === 'TENANT'
        ? lehrfahrer_account_tenant_capabilities($pdo, $accountId, (string)$session['membership_id']) : [];
    $accountQuery = $pdo->prepare('SELECT display_name FROM accounts WHERE id = ? AND active = 1');
    $accountQuery->execute([$accountId]);
    $displayName = $accountQuery->fetchColumn();
    if (!is_string($displayName)) throw new RuntimeException('Account ungültig.');
    $number = lehrfahrer_control_user_number_for_account($pdo, $accountId);
    $companyId = null;
    $companyName = null;
    $tenantRoles = [];
    if ($context === 'TENANT') {
        $company = $pdo->prepare('SELECT c.id, c.name FROM account_memberships m
            JOIN companies c ON c.id = m.company_id
            WHERE m.id = ? AND m.account_id = ? AND m.status = ? AND c.status = ?');
        $company->execute([(string)$session['membership_id'], $accountId, 'active', 'active']);
        $companyRow = $company->fetch(PDO::FETCH_ASSOC);
        if (!is_array($companyRow)) throw new RuntimeException('Mandantenkontext ungültig.');
        $companyId = (string)$companyRow['id'];
        $companyName = (string)$companyRow['name'];
        $roles = $pdo->prepare('SELECT DISTINCT r.code FROM membership_roles mr
            JOIN roles r ON r.id = mr.role_id WHERE mr.membership_id = ? ORDER BY r.code');
        $roles->execute([(string)$session['membership_id']]);
        $tenantRoles = $roles->fetchAll(PDO::FETCH_COLUMN);
    }
    $sysop = $pdo->prepare('SELECT 1 FROM sysop_assignment WHERE account_id = ?');
    $sysop->execute([$accountId]);
    $cosysop = $pdo->prepare("SELECT 1 FROM account_platform_roles WHERE account_id = ? AND role_code = 'COSYSOP'");
    $cosysop->execute([$accountId]);
    $platformRoles = array_merge($sysop->fetchColumn() === false ? [] : ['SYSOP'],
        $cosysop->fetchColumn() === false ? [] : ['COSYSOP']);
    $platformCapabilities = lehrfahrer_account_platform_capabilities($pdo, $accountId);
    return ['ok' => true,
        'accountId' => $accountId,
        'companyId' => $companyId,
        'displayName' => $displayName,
        'userNumber' => $number === null ? null : lehrfahrer_control_format_user_number($number),
        'companyName' => $companyName,
        'tenantRoles' => $tenantRoles,
        'platformRoles' => $platformRoles,
        'context' => $context === 'PENDING'
            ? ($memberships === [] ? 'NO_MEMBERSHIP' : 'SELECTION_PENDING') : $context,
        'membershipId' => $context === 'TENANT' ? $session['membership_id'] : null,
        'memberships' => $memberships,
        'tenantCapabilities' => $tenantCapabilities,
        'platformCapabilities' => $platformCapabilities,
        'session' => ['idleExpiresAt' => $session['idle_expires_at'],
            'absoluteExpiresAt' => $session['absolute_expires_at']],
        'csrfToken' => lehrfahrer_auth_csrf_token((string)$session['_token'])];
}

/** Only the authenticated account's currently active tenant memberships are offered. */
function lehrfahrer_account_available_memberships(PDO $pdo, array $session): ?array {
    if (!in_array($session['context_type'], ['PENDING', 'TENANT'], true)) return null;
    return lehrfahrer_account_memberships($pdo, (string)$session['account_id']);
}

function lehrfahrer_account_rotate_to_membership(PDO $pdo, string $membershipId,
    string $csrf, string $action = 'select'): ?array {
    return lehrfahrer_with_auth_mutation_gate($pdo,
        static fn(): ?array => lehrfahrer_account_rotate_to_membership_unguarded($pdo, $membershipId, $csrf, $action));
}

function lehrfahrer_account_rotate_to_membership_unguarded(PDO $pdo, string $membershipId,
    string $csrf, string $action = 'select'): ?array {
    if (!in_array($action, ['select', 'switch'], true)) throw new InvalidArgumentException('Ungültige Kontextaktion.');
    if (lehrfahrer_control_driver($pdo) === 'mysql') {
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    }
    $ownsTransaction = lehrfahrer_control_driver($pdo) === 'mysql';
    if ($ownsTransaction) $pdo->beginTransaction();
    try {
        $session = lehrfahrer_account_current_session($pdo, false, true);
        $requiredContext = $action === 'select' ? 'PENDING' : 'TENANT';
        if ($session === null || $session['context_type'] !== $requiredContext
            || $csrf === '' || !hash_equals((string)$session['csrf_token_hash'], lehrfahrer_auth_token_hash($csrf))) {
            if ($ownsTransaction) $pdo->rollBack(); return null;
        }
        $available = lehrfahrer_account_memberships($pdo, (string)$session['account_id']);
        if ($action === 'switch' && (count($available) < 2
            || $membershipId === (string)$session['membership_id'])) {
            if ($ownsTransaction) $pdo->rollBack(); return null;
        }
        $matches = array_values(array_filter($available,
            static fn(array $item): bool => (string)$item['id'] === $membershipId));
        if (count($matches) !== 1) { if ($ownsTransaction) $pdo->rollBack(); return null; }
        $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
            WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $revoke->execute([lehrfahrer_auth_timestamp(time()), $session['id'], lehrfahrer_environment()]);
        if ($revoke->rowCount() !== 1) throw new RuntimeException('Sessionrotation fehlgeschlagen.');
        $created = lehrfahrer_account_create_session($pdo, (string)$session['account_id'],
            'TENANT', $membershipId, $session['device_label']);
        if ($ownsTransaction) $pdo->commit();
        return $created + ['contextEvent' => ['action' => $action,
            'accountId' => (string)$session['account_id'],
            'fromMembershipId' => $action === 'switch' ? (string)$session['membership_id'] : null,
            'toMembershipId' => $membershipId]];
    } catch (Throwable $error) {
        if ($ownsTransaction && $pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
