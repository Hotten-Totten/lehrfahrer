<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_account_auth.php';
lehrfahrer_account_test_only();

$action = (string)($_GET['action'] ?? '');
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($action, ['login', 'me', 'memberships', 'select', 'switch', 'logout'], true)
    || (in_array($action, ['me', 'memberships'], true) ? $method !== 'GET' : $method !== 'POST')) {
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
if ($method === 'POST') lehrfahrer_auth_require_same_origin();

try {
    $pdo = lehrfahrer_control_database();
    if ($action === 'login') {
        $input = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($input) || array_diff(array_keys($input), ['login', 'password', 'deviceLabel']) !== []
            || !is_string($input['login'] ?? null) || !is_string($input['password'] ?? null)
            || (isset($input['deviceLabel']) && !is_string($input['deviceLabel']))) {
            lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
        }
        $created = lehrfahrer_account_login($pdo, (string)($input['login'] ?? ''),
            (string)($input['password'] ?? ''), (string)($input['deviceLabel'] ?? ''));
        if ($created === null) {
            usleep(random_int(20000, 50000));
            lehrfahrer_auth_json_response(401, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
        }
        lehrfahrer_account_set_cookie($created['token'], $created['absoluteExpiresAt']);
        $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $created['token'];
    } elseif ($action === 'select' || $action === 'switch') {
        $input = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($input) || array_keys($input) !== ['membershipId']
            || !is_string($input['membershipId'])) {
            lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Auswahl abgelehnt.']);
        }
        $created = lehrfahrer_account_rotate_to_membership($pdo, $input['membershipId'],
            lehrfahrer_auth_header('X-CSRF-Token'), $action);
        if ($created === null) lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Auswahl abgelehnt.']);
        lehrfahrer_account_set_cookie($created['token'], $created['absoluteExpiresAt']);
        $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $created['token'];
    } elseif ($action === 'logout') {
        $session = lehrfahrer_account_current_session($pdo, false);
        $csrf = lehrfahrer_auth_header('X-CSRF-Token');
        if ($session === null || $csrf === ''
            || !hash_equals((string)$session['csrf_token_hash'], lehrfahrer_auth_token_hash($csrf))) {
            lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Anfrage wurde abgelehnt.']);
        }
        $revoke = $pdo->prepare('UPDATE account_sessions SET revoked_at = ?
            WHERE id = ? AND environment = ? AND revoked_at IS NULL');
        $revoke->execute([lehrfahrer_auth_timestamp(time()), $session['id'], lehrfahrer_environment()]);
        if ($revoke->rowCount() !== 1) throw new RuntimeException('Account-Logout fehlgeschlagen.');
        lehrfahrer_account_clear_cookie();
        lehrfahrer_auth_json_response(200, ['ok' => true]);
    }
    $session = lehrfahrer_account_current_session($pdo,
        in_array($action, ['me', 'memberships'], true));
    if ($session === null) lehrfahrer_auth_json_response(401, ['ok' => false, 'error' => 'Anmeldung erforderlich.']);
    if ($action === 'memberships') {
        $memberships = lehrfahrer_account_available_memberships($pdo, $session);
        if ($memberships === null) lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Auswahl abgelehnt.']);
        lehrfahrer_auth_json_response(200, ['ok' => true, 'memberships' => $memberships,
            'currentMembershipId' => $session['context_type'] === 'TENANT' ? $session['membership_id'] : null]);
    }
    $response = lehrfahrer_account_public_session($pdo, $session);
    if (in_array($action, ['select', 'switch'], true)) {
        $response['contextChanged'] = true;
        $response['invalidateTenantCache'] = true;
    }
    lehrfahrer_auth_json_response(200, $response);
} catch (LehrfahrerAuthCutoverBusy $error) {
    lehrfahrer_auth_json_response(503, ['ok' => false,
        'error' => 'Anmeldung wird gerade aktualisiert. Bitte erneut versuchen.']);
} catch (Throwable $error) {
    error_log('Lehrfahrer account test authentication failed internally.');
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Anfrage fehlgeschlagen.']);
}
