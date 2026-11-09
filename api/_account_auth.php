<?php
declare(strict_types=1);

require_once __DIR__ . '/_session_auth.php';
require_once __DIR__ . '/_auth_cutover_gate.php';
require_once __DIR__ . '/_sysop_mfa.php';
require_once __DIR__ . '/_audit.php';

/** Retain the host-bound cookie name across the explicit production opt-in. */
const LEHRFAHRER_ACCOUNT_TEST_COOKIE = '__Host-lehrfahrer_account_test';

function lehrfahrer_account_test_only(): void {
    if (!lehrfahrer_account_login_enabled()) {
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
    ?string $membershipId, ?string $deviceLabel = null, bool $mfaVerified = false): array {
    return lehrfahrer_with_auth_mutation_gate($pdo,
        static fn(): array => lehrfahrer_account_create_session_unguarded($pdo, $accountId, $context, $membershipId, $deviceLabel, $mfaVerified));
}

function lehrfahrer_account_create_session_unguarded(PDO $pdo, string $accountId, string $context,
    ?string $membershipId, ?string $deviceLabel = null, bool $mfaVerified = false): array {
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
         absolute_expires_at, revoked_at, ip_hash, user_agent_hash, device_label, mfa_verified_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)');
    $query->execute([lehrfahrer_control_id('ases'), $accountId, $tokenHash,
        lehrfahrer_auth_token_hash($csrf), $context, $membershipId, lehrfahrer_environment(),
        lehrfahrer_auth_timestamp($now), lehrfahrer_auth_timestamp($now),
        lehrfahrer_auth_timestamp($now + LEHRFAHRER_SESSION_IDLE_SECONDS),
        lehrfahrer_auth_timestamp($now + LEHRFAHRER_SESSION_ABSOLUTE_SECONDS),
        $ip === '' ? null : hash_hmac('sha256', $ip, $tokenHash),
        $agent === '' ? null : hash_hmac('sha256', $agent, $tokenHash),
        $label === '' ? null : $label, $mfaVerified ? lehrfahrer_auth_timestamp($now) : null]);
    return ['token' => $token, 'csrf' => $csrf,
        'absoluteExpiresAt' => $now + LEHRFAHRER_SESSION_ABSOLUTE_SECONDS];
}

function lehrfahrer_account_login(PDO $pdo, string $login, string $password, ?string $deviceLabel = null, ?string $enrollmentCode = null): ?array {
    try {
        return lehrfahrer_with_auth_mutation_gate($pdo,
            static fn(): ?array => lehrfahrer_account_login_unguarded($pdo, $login, $password, $deviceLabel, $enrollmentCode));
    } catch (Throwable $error) {
        if (!$error instanceof LehrfahrerAuditWriteFailure && !$error instanceof LehrfahrerAuthCutoverBusy) {
            lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::unauthenticated(),
                ['action' => 'AUTH_LOGIN', 'result' => 'FAILED', 'reasonCode' => 'INTERNAL_FAILURE'],
                LEHRFAHRER_AUDIT_OPERATIONAL);
        }
        throw $error;
    }
}

/** Called only after the endpoint has verified the current session and CSRF. */
function lehrfahrer_account_logout_session(PDO $pdo, array $session): void {
    lehrfahrer_with_auth_mutation_gate($pdo,
        static fn() => lehrfahrer_account_logout_session_unguarded($pdo, $session));
}

function lehrfahrer_account_logout_session_unguarded(PDO $pdo, array $session): void {
    $actor = LehrfahrerAuditActor::currentAccount($pdo);
    if ($actor->accountId !== (string)$session['account_id']) throw new RuntimeException('Logout-Session abweichend.');
    $sqlite = lehrfahrer_control_driver($pdo) === 'sqlite';
    if (!$sqlite) $pdo->beginTransaction();
    try {
        $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
            WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $revoke->execute([lehrfahrer_auth_timestamp(time()), $session['id'], lehrfahrer_environment()]);
        if ($revoke->rowCount() !== 1) throw new RuntimeException('Account-Logout fehlgeschlagen.');
        lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_LOGOUT',
            'objectType' => 'SESSION', 'objectId' => (string)$session['id'], 'result' => 'SUCCESS']);
        if (!$sqlite) $pdo->commit();
    } catch (Throwable $error) {
        if (!$sqlite && $pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function lehrfahrer_account_login_unguarded(PDO $pdo, string $login, string $password, ?string $deviceLabel = null, ?string $enrollmentCode = null): ?array {
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
    $actor = is_array($account) ? LehrfahrerAuditActor::knownAccount($pdo, (string)$account['id'])
        : LehrfahrerAuditActor::unauthenticated();
    if (!is_array($account) || $normalized === '' || $password === '' || !$passwordValid
        || (int)$account['active'] !== 1 || (int)$account['must_change_password'] !== 0
        || ($blocked !== null && ($blockedUntil === false || $blockedUntil > time()))) {
        $reason = !is_array($account) || !$passwordValid ? 'INVALID_CREDENTIALS'
            : ((int)$account['active'] !== 1 ? 'ACCOUNT_DISABLED'
                : ($blocked !== null && ($blockedUntil === false || $blockedUntil > time())
                    ? 'ACCOUNT_LOCKED' : 'FORBIDDEN'));
        lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_LOGIN', 'result' => 'DENIED',
            'reasonCode' => $reason], LEHRFAHRER_AUDIT_OPERATIONAL);
        return null;
    }
    $mysql = lehrfahrer_control_driver($pdo) === 'mysql';
    if ($mysql) $pdo->beginTransaction();
    try {
        $previous = lehrfahrer_account_cookie_token();
        if ($previous !== '') {
            $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, ?)
                WHERE session_token_hash = ? AND environment = ?');
            $revoke->execute([lehrfahrer_auth_timestamp(time()), lehrfahrer_auth_token_hash($previous),
                lehrfahrer_environment()]);
            if ($revoke->rowCount() > 0) {
                lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_SESSION_REVOKE',
                    'objectType' => 'SESSION', 'result' => 'SUCCESS']);
            }
        }
        if (lehrfahrer_sysop_mfa_required($pdo, (string)$account['id'])) {
            $pending = lehrfahrer_sysop_mfa_start_unguarded($pdo, (string)$account['id'], $deviceLabel, $enrollmentCode);
            if ($pending === null) {
                lehrfahrer_audit_append($pdo, $actor, ['action'=>'AUTH_LOGIN', 'result'=>'DENIED', 'reasonCode'=>'FORBIDDEN'], LEHRFAHRER_AUDIT_OPERATIONAL);
                if ($mysql) $pdo->commit();
                return null;
            }
            lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_MFA_PENDING',
                'objectType' => 'PASSKEY', 'result' => 'SUCCESS']);
            if ($mysql) $pdo->commit();
            return $pending;
        }
        $memberships = lehrfahrer_account_memberships($pdo, (string)$account['id']);
        $platform = lehrfahrer_account_platform_capabilities($pdo, (string)$account['id']);
        if ($platform === [] && $memberships !== []) {
            $roles = $pdo->prepare("SELECT DISTINCT r.code FROM account_memberships m
                JOIN companies c ON c.id = m.company_id
                JOIN membership_roles mr ON mr.membership_id = m.id
                JOIN roles r ON r.id = mr.role_id
                WHERE m.account_id = ? AND m.status = 'active' AND c.status = 'active'");
            $roles->execute([$account['id']]);
            if ($roles->fetchAll(PDO::FETCH_COLUMN) === ['FAHRER']) {
                $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
                    WHERE account_id = ? AND environment = ? AND revoked_at IS NULL');
                $revoke->execute([lehrfahrer_auth_timestamp(time()), $account['id'], lehrfahrer_environment()]);
            }
        }
        $count = count($memberships);
        $context = $count === 1 ? 'TENANT' : ($count === 0 && $platform !== [] ? 'PLATFORM' : 'PENDING');
        $membershipId = $context === 'TENANT' ? (string)$memberships[0]['id'] : null;
        $created = lehrfahrer_account_create_session($pdo, (string)$account['id'], $context, $membershipId, $deviceLabel);
        lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::createdSession($pdo, $created['token']),
            ['action' => 'AUTH_LOGIN', 'result' => 'SUCCESS']);
        if ($mysql) $pdo->commit();
        return $created + ['accountId' => (string)$account['id'], 'context' => $context];
    } catch (Throwable $error) {
        if ($mysql && $pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function lehrfahrer_account_current_session(PDO $pdo, bool $touch = true,
    bool $lock = false): ?array {
    if (lehrfahrer_environment() === 'production' && !lehrfahrer_account_login_enabled()) return null;
    if (lehrfahrer_auth_cutover_state($pdo)['lock'] !== 'OPEN') return null;
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
    if (lehrfahrer_sysop_mfa_required($pdo, (string)$session['account_id'])
        && (lehrfahrer_environment() === 'production' || lehrfahrer_sysop_mfa_credentials($pdo, (string)$session['account_id']) !== [])
        && $session['mfa_verified_at'] === null) return null;
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
        // Recheck the shared lock after resolving the session; no expiry extension
        // or logout may race a production maintenance boundary.
        $updated = lehrfahrer_with_auth_mutation_gate($pdo, static function () use ($pdo, $now, $absolute, $session): bool {
        $query = $pdo->prepare('UPDATE account_sessions
            SET last_activity_at = ?, idle_expires_at = ? WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $query->execute([lehrfahrer_auth_timestamp($now),
            lehrfahrer_auth_timestamp(min($now + LEHRFAHRER_SESSION_IDLE_SECONDS, $absolute)),
            $session['id'], lehrfahrer_environment()]);
        return $query->rowCount() === 1;
        });
        if (!$updated) return null;
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
            if ($ownsTransaction) $pdo->rollBack();
            $actor = $session === null ? LehrfahrerAuditActor::unauthenticated()
                : LehrfahrerAuditActor::currentAccount($pdo);
            lehrfahrer_audit_append($pdo, $actor, ['action' => 'AUTH_CONTEXT_CHANGE',
                'objectType' => 'MEMBERSHIP', 'result' => 'DENIED', 'reasonCode' => 'CSRF_REJECTED'],
                LEHRFAHRER_AUDIT_OPERATIONAL);
            return null;
        }
        $available = lehrfahrer_account_memberships($pdo, (string)$session['account_id']);
        if ($action === 'switch' && (count($available) < 2
            || $membershipId === (string)$session['membership_id'])) {
            if ($ownsTransaction) $pdo->rollBack();
            lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::currentAccount($pdo),
                ['action' => 'AUTH_CONTEXT_CHANGE', 'objectType' => 'MEMBERSHIP',
                    'result' => 'DENIED', 'reasonCode' => 'FORBIDDEN'], LEHRFAHRER_AUDIT_OPERATIONAL);
            return null;
        }
        $matches = array_values(array_filter($available,
            static fn(array $item): bool => (string)$item['id'] === $membershipId));
        if (count($matches) !== 1) {
            if ($ownsTransaction) $pdo->rollBack();
            lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::currentAccount($pdo),
                ['action' => 'AUTH_CONTEXT_CHANGE', 'objectType' => 'MEMBERSHIP',
                    'result' => 'DENIED', 'reasonCode' => 'FORBIDDEN'], LEHRFAHRER_AUDIT_OPERATIONAL);
            return null;
        }
        $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
            WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $revoke->execute([lehrfahrer_auth_timestamp(time()), $session['id'], lehrfahrer_environment()]);
        if ($revoke->rowCount() !== 1) throw new RuntimeException('Sessionrotation fehlgeschlagen.');
        $created = lehrfahrer_account_create_session($pdo, (string)$session['account_id'],
            'TENANT', $membershipId, $session['device_label'], $session['mfa_verified_at'] !== null);
        lehrfahrer_audit_append($pdo, LehrfahrerAuditActor::createdSession($pdo, $created['token']),
            ['action' => 'AUTH_CONTEXT_CHANGE', 'objectType' => 'MEMBERSHIP',
                'objectId' => $membershipId, 'result' => 'SUCCESS']);
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
