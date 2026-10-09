<?php

require_once dirname(__DIR__) . '/_session_auth.php';

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    header('Allow: POST');
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
lehrfahrer_auth_require_same_origin();

try {
    $pdo = lehrfahrer_control_database();
    $session = lehrfahrer_auth_require_session($pdo, false);
    lehrfahrer_auth_require_csrf($session);
    lehrfahrer_auth_revoke_session_by_token($pdo, $session['_session_token']);
    lehrfahrer_auth_clear_session_cookie();
    lehrfahrer_auth_json_response(200, ['ok' => true]);
} catch (Throwable $error) {
    error_log('Lehrfahrer logout failed internally: ' . $error->getMessage());
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Abmeldung nicht möglich.']);
}
