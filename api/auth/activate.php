<?php

require_once dirname(__DIR__) . '/_session_auth.php';
require_once dirname(__DIR__) . '/_company_provisioning.php';
require_once dirname(__DIR__) . '/_activation_rate_limit.php';

header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    header('Allow: POST');
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
lehrfahrer_auth_require_same_origin();

try {
    if (!lehrfahrer_activation_allow_attempt((string)($_SERVER['REMOTE_ADDR'] ?? ''))) {
        header('Retry-After: 900');
        lehrfahrer_auth_json_response(429, ['ok' => false, 'error' => 'Aktivierung derzeit nicht möglich.']);
    }
    $raw = (string)file_get_contents('php://input', false, null, 0, 8193);
    if (strlen($raw) > 8192) {
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Aktivierung nicht möglich oder Link nicht mehr gültig.']);
    }
    $input = json_decode($raw, true);
    if (!is_array($input)) {
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Aktivierung nicht möglich oder Link nicht mehr gültig.']);
    }
    $token = $input['token'] ?? null;
    $password = $input['password'] ?? null;
    $confirmation = $input['passwordConfirmation'] ?? null;
    if (!is_string($token) || !is_string($password) || !is_string($confirmation)
        || !hash_equals($password, $confirmation)) {
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Aktivierung nicht möglich oder Link nicht mehr gültig.']);
    }
    lehrfahrer_activate_company_admin(lehrfahrer_control_database(), $token, $password);
    lehrfahrer_auth_json_response(200, ['ok' => true, 'message' => 'Konto erfolgreich aktiviert. Sie können sich jetzt anmelden.']);
} catch (InvalidArgumentException | DomainException $error) {
    lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Aktivierung nicht möglich oder Link nicht mehr gültig.']);
} catch (Throwable $error) {
    error_log('Lehrfahrer activation failed internally.');
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Aktivierung nicht möglich oder Link nicht mehr gültig.']);
}
