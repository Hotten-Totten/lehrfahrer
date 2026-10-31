<?php

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_session_auth.php';
require_once __DIR__ . '/_legacy_auth_observation.php';

function lehrfahrer_api_authorization_error(int $status, string $message): never {
    lehrfahrer_auth_json_response($status, ['ok' => false, 'error' => $message]);
}

function lehrfahrer_api_legacy_token_supplied(bool $allowParameterFallback): bool {
    if (lehrfahrer_get_header_ci('X-Api-Token') !== '') return true;
    if (!$allowParameterFallback) return false;
    foreach ([$_POST['apiToken'] ?? null, $_GET['apiToken'] ?? null] as $candidate) {
        if (is_string($candidate) && trim($candidate) !== '') return true;
    }
    return false;
}

function lehrfahrer_auth_effective_capabilities(PDO $pdo, array $session): array {
    $roles = new LehrfahrerRoleRepository($pdo);
    return $roles->userCapabilities((string)$session['company_id'], (string)$session['user_id']);
}

function lehrfahrer_auth_effective_roles(PDO $pdo, array $session): array {
    $statement = $pdo->prepare(
        'SELECT roles.code
         FROM users
         JOIN user_roles ON user_roles.user_id = users.id
         JOIN roles ON roles.id = user_roles.role_id
         WHERE users.company_id = :company_id AND users.id = :user_id
         ORDER BY roles.code'
    );
    $statement->execute([
        ':company_id' => $session['company_id'],
        ':user_id' => $session['user_id'],
    ]);
    return $statement->fetchAll(PDO::FETCH_COLUMN);
}

function lehrfahrer_auth_has_capability(array $authContext, string $capability): bool {
    if (($authContext['mode'] ?? '') === 'legacy-token') return true;
    return in_array($capability, $authContext['capabilities'] ?? [], true);
}

function lehrfahrer_auth_require_capability(array $authContext, string $capability): void {
    if (!array_key_exists($capability, lehrfahrer_control_capability_definitions())) {
        throw new LogicException('Unbekannte Capability in API-Zuordnung.');
    }
    if (!lehrfahrer_auth_has_capability($authContext, $capability)) {
        lehrfahrer_api_authorization_error(403, 'Keine Berechtigung für diese Funktion.');
    }
}

function lehrfahrer_api_require_session(): array {
    $pdo = lehrfahrer_control_database();
    $session = lehrfahrer_auth_require_session($pdo);
    return [
        'mode' => 'session',
        'pdo' => $pdo,
        'session' => $session,
        'company_id' => (string)$session['company_id'],
        'user_id' => (string)$session['user_id'],
        'roles' => lehrfahrer_auth_effective_roles($pdo, $session),
        'capabilities' => lehrfahrer_auth_effective_capabilities($pdo, $session),
    ];
}

function lehrfahrer_api_authorize(
    string $capability,
    bool $mutation = false,
    bool $allowLegacyParameterFallback = false
): array {
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($mutation && in_array($method, ['GET', 'HEAD'], true)) {
        header('Allow: POST');
        lehrfahrer_api_authorization_error(405, 'Methode nicht erlaubt.');
    }

    $sessionCookieSupplied = array_key_exists(LEHRFAHRER_SESSION_COOKIE, $_COOKIE);
    if ($sessionCookieSupplied) {
        $context = lehrfahrer_api_require_session();
        lehrfahrer_auth_require_capability($context, $capability);
        if ($mutation) {
            lehrfahrer_auth_require_same_origin();
            lehrfahrer_auth_require_csrf($context['session']);
        }
        header('X-Lehrfahrer-Auth-Mode: session');
        return $context;
    }

    if (lehrfahrer_api_legacy_token_supplied($allowLegacyParameterFallback)) {
        $transport = lehrfahrer_get_header_ci('X-Api-Token') !== ''
            ? 'HEADER' : 'REQUEST_PARAMETER';
        lehrfahrer_require_write_auth(
            static fn(bool $accepted) => lehrfahrer_observe_legacy_auth($transport, $accepted)
        );
        $context = [
            'mode' => 'legacy-token',
            'pdo' => null,
            'session' => null,
            'company_id' => null,
            'user_id' => null,
            'roles' => ['LEGACY_TOKEN'],
            'capabilities' => ['*'],
        ];
        lehrfahrer_auth_require_capability($context, $capability);
        header('X-Lehrfahrer-Auth-Mode: legacy-token');
        return $context;
    }

    lehrfahrer_api_authorization_error(401, 'Anmeldung erforderlich.');
}
