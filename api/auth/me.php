<?php

require_once dirname(__DIR__) . '/_session_auth.php';

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    header('Allow: GET');
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}

try {
    $pdo = lehrfahrer_control_database();
    $session = lehrfahrer_auth_require_session($pdo);
    lehrfahrer_auth_json_response(200, array_merge(
        ['ok' => true],
        lehrfahrer_auth_public_session($session, $pdo),
        ['runtime' => lehrfahrer_runtime_info($pdo)]
    ));
} catch (Throwable $error) {
    error_log('Lehrfahrer session lookup failed internally: ' . $error->getMessage());
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Session konnte nicht geprüft werden.']);
}
