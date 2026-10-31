<?php

require_once __DIR__ . '/_control_repositories.php';
require_once __DIR__ . '/_runtime_info.php';
require_once __DIR__ . '/_auth_cutover_gate.php';

const LEHRFAHRER_SESSION_COOKIE = '__Host-lehrfahrer_session';
const LEHRFAHRER_SESSION_IDLE_SECONDS = 1800;
const LEHRFAHRER_SESSION_ABSOLUTE_SECONDS = 43200;
const LEHRFAHRER_SESSION_TOUCH_INTERVAL_SECONDS = 300;

function lehrfahrer_auth_timestamp(int $timestamp): string {
    return gmdate('Y-m-d\TH:i:s\Z', $timestamp);
}

function lehrfahrer_auth_random_token(): string {
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function lehrfahrer_auth_token_hash(string $token): string {
    return hash('sha256', $token);
}

function lehrfahrer_auth_csrf_token(string $sessionToken): string {
    return rtrim(strtr(base64_encode(hash_hmac('sha256', 'lehrfahrer-csrf-v1', $sessionToken, true)), '+/', '-_'), '=');
}

function lehrfahrer_auth_header(string $name): string {
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER[$serverKey] ?? '';
    return is_string($value) ? trim($value) : '';
}

function lehrfahrer_auth_request_origin(string $value): ?string {
    $parts = parse_url(trim($value));
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) return null;
    $scheme = strtolower((string)$parts['scheme']);
    $host = strtolower((string)$parts['host']);
    $port = isset($parts['port']) ? ':' . (int)$parts['port'] : '';
    return $scheme . '://' . $host . $port;
}

function lehrfahrer_auth_require_same_origin(): void {
    try {
        $expected = lehrfahrer_auth_request_origin(lehrfahrer_public_origin());
    } catch (Throwable $error) {
        error_log('Lehrfahrer origin configuration failed: ' . $error->getMessage());
        lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Authentifizierung ist nicht konfiguriert.']);
    }
    $provided = lehrfahrer_auth_request_origin(lehrfahrer_auth_header('Origin'));
    if ($provided === null) {
        $provided = lehrfahrer_auth_request_origin(lehrfahrer_auth_header('Referer'));
    }
    if ($expected === null || $provided === null || !hash_equals($expected, $provided)) {
        lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Anfrage wurde abgelehnt.']);
    }
}

function lehrfahrer_auth_json_response(int $status, array $payload): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function lehrfahrer_auth_cookie_options(int $expires): array {
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ];
}

function lehrfahrer_auth_set_session_cookie(string $token, int $expires): void {
    if (!setcookie(LEHRFAHRER_SESSION_COOKIE, $token, lehrfahrer_auth_cookie_options($expires))) {
        throw new RuntimeException('Sessioncookie konnte nicht gesetzt werden.');
    }
}

function lehrfahrer_auth_clear_session_cookie(): void {
    setcookie(LEHRFAHRER_SESSION_COOKIE, '', lehrfahrer_auth_cookie_options(time() - 3600));
}

function lehrfahrer_auth_session_token_from_request(): string {
    $token = $_COOKIE[LEHRFAHRER_SESSION_COOKIE] ?? '';
    if (!is_string($token) || preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) return '';
    return $token;
}

function lehrfahrer_auth_create_session(
    PDO $pdo,
    array $user,
    array $company,
    ?string $deviceLabel = null
): array {
    return lehrfahrer_with_auth_mutation_gate($pdo,
        static fn(): array => lehrfahrer_auth_create_session_unguarded($pdo, $user, $company, $deviceLabel));
}

function lehrfahrer_auth_create_session_unguarded(
    PDO $pdo,
    array $user,
    array $company,
    ?string $deviceLabel = null
): array {
    if (($user['company_id'] ?? '') !== ($company['id'] ?? '')) {
        throw new InvalidArgumentException('Benutzer und Gesellschaft stimmen nicht überein.');
    }

    $now = time();
    $absoluteExpires = $now + LEHRFAHRER_SESSION_ABSOLUTE_SECONDS;
    $sessionToken = lehrfahrer_auth_random_token();
    $sessionTokenHash = lehrfahrer_auth_token_hash($sessionToken);
    $csrfToken = lehrfahrer_auth_csrf_token($sessionToken);
    $ip = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    $userAgent = trim((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $label = trim((string)$deviceLabel);
    if (function_exists('mb_substr')) $label = mb_substr($label, 0, 120, 'UTF-8');
    else $label = substr($label, 0, 120);

    $statement = $pdo->prepare(
        'INSERT INTO sessions
         (id, session_token_hash, user_id, company_id, csrf_token_hash, environment,
          created_at, last_activity_at, idle_expires_at, absolute_expires_at, revoked_at,
          ip_hash, user_agent_hash, device_label)
         VALUES
         (:id, :session_token_hash, :user_id, :company_id, :csrf_token_hash, :environment,
          :created_at, :last_activity_at, :idle_expires_at, :absolute_expires_at, NULL,
          :ip_hash, :user_agent_hash, :device_label)'
    );
    $statement->execute([
        ':id' => lehrfahrer_control_id('ses'),
        ':session_token_hash' => $sessionTokenHash,
        ':user_id' => $user['id'],
        ':company_id' => $company['id'],
        ':csrf_token_hash' => lehrfahrer_auth_token_hash($csrfToken),
        ':environment' => lehrfahrer_environment(),
        ':created_at' => lehrfahrer_auth_timestamp($now),
        ':last_activity_at' => lehrfahrer_auth_timestamp($now),
        ':idle_expires_at' => lehrfahrer_auth_timestamp($now + LEHRFAHRER_SESSION_IDLE_SECONDS),
        ':absolute_expires_at' => lehrfahrer_auth_timestamp($absoluteExpires),
        ':ip_hash' => $ip === '' ? null : hash_hmac('sha256', $ip, $sessionTokenHash),
        ':user_agent_hash' => $userAgent === '' ? null : hash_hmac('sha256', $userAgent, $sessionTokenHash),
        ':device_label' => $label === '' ? null : $label,
    ]);

    return [
        'sessionToken' => $sessionToken,
        'csrfToken' => $csrfToken,
        'absoluteExpiresAt' => $absoluteExpires,
    ];
}

function lehrfahrer_auth_revoke_session_by_token(PDO $pdo, string $sessionToken): void {
    if ($sessionToken === '') return;
    $statement = $pdo->prepare(
        'UPDATE sessions SET revoked_at = COALESCE(revoked_at, :revoked_at)
         WHERE session_token_hash = :session_token_hash AND environment = :environment'
    );
    $statement->execute([
        ':revoked_at' => lehrfahrer_auth_timestamp(time()),
        ':session_token_hash' => lehrfahrer_auth_token_hash($sessionToken),
        ':environment' => lehrfahrer_environment(),
    ]);
}

function lehrfahrer_auth_revoke_user_sessions(PDO $pdo, string $companyId, string $userId): int {
    $statement = $pdo->prepare(
        'UPDATE sessions SET revoked_at = COALESCE(revoked_at, :revoked_at)
         WHERE company_id = :company_id AND user_id = :user_id
           AND environment = :environment AND revoked_at IS NULL'
    );
    $statement->execute([
        ':revoked_at' => lehrfahrer_auth_timestamp(time()),
        ':company_id' => $companyId,
        ':user_id' => $userId,
        ':environment' => lehrfahrer_environment(),
    ]);
    return $statement->rowCount();
}

function lehrfahrer_auth_current_session(PDO $pdo, bool $touch = true): ?array {
    $sessionToken = lehrfahrer_auth_session_token_from_request();
    if ($sessionToken === '') return null;

    $statement = $pdo->prepare(
        'SELECT sessions.id AS session_id, sessions.session_token_hash, sessions.csrf_token_hash,
                sessions.created_at, sessions.last_activity_at, sessions.idle_expires_at,
                sessions.absolute_expires_at, sessions.revoked_at, sessions.device_label,
                users.id AS user_id, users.company_id, users.login_normalized,
                users.display_name, users.active AS user_active, users.must_change_password,
                companies.slug AS company_slug, companies.name AS company_name,
                companies.status AS company_status, companies.license_status
         FROM sessions
         JOIN users ON users.id = sessions.user_id AND users.company_id = sessions.company_id
         JOIN companies ON companies.id = sessions.company_id
         WHERE sessions.session_token_hash = :session_token_hash
           AND sessions.environment = :environment'
    );
    $statement->execute([
        ':session_token_hash' => lehrfahrer_auth_token_hash($sessionToken),
        ':environment' => lehrfahrer_environment(),
    ]);
    $session = $statement->fetch();
    if (!is_array($session)) return null;

    $now = time();
    $idleExpires = strtotime((string)$session['idle_expires_at']);
    $absoluteExpires = strtotime((string)$session['absolute_expires_at']);
    $invalid = $session['revoked_at'] !== null
        || $idleExpires === false || $idleExpires <= $now
        || $absoluteExpires === false || $absoluteExpires <= $now
        || (int)$session['user_active'] !== 1
        || $session['company_status'] !== 'active';
    if ($invalid) {
        if ($session['revoked_at'] === null) lehrfahrer_auth_revoke_session_by_token($pdo, $sessionToken);
        return null;
    }

    $lastActivity = strtotime((string)$session['last_activity_at']);
    if ($touch && ($lastActivity === false || $now - $lastActivity >= LEHRFAHRER_SESSION_TOUCH_INTERVAL_SECONDS)) {
        $newIdleExpires = min($now + LEHRFAHRER_SESSION_IDLE_SECONDS, $absoluteExpires);
        $update = $pdo->prepare(
            'UPDATE sessions
             SET last_activity_at = :last_activity_at, idle_expires_at = :idle_expires_at
             WHERE id = :session_id AND company_id = :company_id
               AND environment = :environment AND revoked_at IS NULL'
        );
        $update->execute([
            ':last_activity_at' => lehrfahrer_auth_timestamp($now),
            ':idle_expires_at' => lehrfahrer_auth_timestamp($newIdleExpires),
            ':session_id' => $session['session_id'],
            ':company_id' => $session['company_id'],
            ':environment' => lehrfahrer_environment(),
        ]);
        if ($update->rowCount() !== 1) return null;
        $session['last_activity_at'] = lehrfahrer_auth_timestamp($now);
        $session['idle_expires_at'] = lehrfahrer_auth_timestamp($newIdleExpires);
    }

    $session['_session_token'] = $sessionToken;
    return $session;
}

function lehrfahrer_auth_require_session(PDO $pdo, bool $touch = true): array {
    $session = lehrfahrer_auth_current_session($pdo, $touch);
    if ($session === null) {
        lehrfahrer_auth_clear_session_cookie();
        lehrfahrer_auth_json_response(401, ['ok' => false, 'error' => 'Anmeldung erforderlich.']);
    }
    return $session;
}

function lehrfahrer_auth_require_csrf(array $session): void {
    $provided = lehrfahrer_auth_header('X-CSRF-Token');
    $expectedHash = (string)($session['csrf_token_hash'] ?? '');
    if ($provided === '' || $expectedHash === ''
        || !hash_equals($expectedHash, lehrfahrer_auth_token_hash($provided))) {
        lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Anfrage wurde abgelehnt.']);
    }
}

function lehrfahrer_auth_public_session(array $session, PDO $pdo): array {
    $roleStatement = $pdo->prepare(
        'SELECT roles.code
         FROM roles
         JOIN user_roles ON user_roles.role_id = roles.id
         JOIN users ON users.id = user_roles.user_id
         WHERE users.company_id = :company_id AND users.id = :user_id
         ORDER BY roles.code'
    );
    $roleStatement->execute([
        ':company_id' => $session['company_id'],
        ':user_id' => $session['user_id'],
    ]);
    $capabilities = (new LehrfahrerRoleRepository($pdo))->userCapabilities(
        (string)$session['company_id'],
        (string)$session['user_id']
    );
    return [
        'user' => [
            'id' => $session['user_id'],
            'login' => $session['login_normalized'],
            'displayName' => $session['display_name'],
            'mustChangePassword' => (bool)$session['must_change_password'],
            'roles' => $roleStatement->fetchAll(PDO::FETCH_COLUMN),
            'capabilities' => $capabilities,
        ],
        'company' => [
            'id' => $session['company_id'],
            'slug' => $session['company_slug'],
            'name' => $session['company_name'],
            'licenseStatus' => $session['license_status'],
        ],
        'session' => [
            'createdAt' => $session['created_at'],
            'lastActivityAt' => $session['last_activity_at'],
            'idleExpiresAt' => $session['idle_expires_at'],
            'absoluteExpiresAt' => $session['absolute_expires_at'],
            'deviceLabel' => $session['device_label'],
        ],
        'csrfToken' => lehrfahrer_auth_csrf_token($session['_session_token']),
    ];
}
