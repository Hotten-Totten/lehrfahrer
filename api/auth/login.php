<?php

require_once dirname(__DIR__) . '/_session_auth.php';

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    header('Allow: POST');
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
lehrfahrer_auth_require_same_origin();

try {
    $input = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($input)) {
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
    }

    $companySlug = strtolower(trim((string)($input['company'] ?? '')));
    $login = trim((string)($input['login'] ?? ''));
    $password = (string)($input['password'] ?? '');
    $deviceLabel = trim((string)($input['deviceLabel'] ?? ''));
    if ($companySlug === '' || $login === '' || $password === '') {
        lehrfahrer_auth_json_response(401, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
    }

    $pdo = lehrfahrer_control_database();
    $companies = new LehrfahrerCompanyRepository($pdo);
    $users = new LehrfahrerUserRepository($pdo);
    $company = $companies->findBySlug($companySlug);
    $user = is_array($company) ? $users->findAuthenticationRecordByLogin($company['id'], $login) : null;

    $dummyHash = '$2y$10$WfMzXGqoRwpCEPrb53v.7O7P7JbGfIxV9qz2nMVRRb6wjXZXUPmPe';
    $passwordValid = lehrfahrer_password_verify($password, is_array($user) ? (string)$user['password_hash'] : $dummyHash);
    $blockedValue = is_array($user) ? ($user['blocked_until'] ?? null) : null;
    $blockedUntil = $blockedValue !== null ? strtotime((string)$blockedValue) : null;
    $notBlocked = $blockedValue === null
        || ($blockedUntil !== false && $blockedUntil <= time());
    $loginAllowed = is_array($company)
        && $company['status'] === 'active'
        && is_array($user)
        && (int)$user['active'] === 1
        && $notBlocked
        && $passwordValid
        && hash_equals((string)$company['id'], (string)$user['company_id']);
    if (!$loginAllowed) {
        usleep(random_int(20000, 50000));
        lehrfahrer_auth_json_response(401, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
    }

    $previousToken = lehrfahrer_auth_session_token_from_request();
    if ($previousToken !== '') lehrfahrer_auth_revoke_session_by_token($pdo, $previousToken);

    $created = lehrfahrer_auth_create_session($pdo, $user, $company, $deviceLabel);
    $users->markSuccessfulLogin($company['id'], $user['id'], lehrfahrer_auth_timestamp(time()));
    lehrfahrer_auth_set_session_cookie($created['sessionToken'], $created['absoluteExpiresAt']);

    $_COOKIE[LEHRFAHRER_SESSION_COOKIE] = $created['sessionToken'];
    $session = lehrfahrer_auth_current_session($pdo, false);
    if ($session === null) throw new RuntimeException('Neue Session konnte nicht gelesen werden.');
    lehrfahrer_auth_json_response(200, array_merge(
        ['ok' => true],
        lehrfahrer_auth_public_session($session, $pdo),
        ['runtime' => lehrfahrer_runtime_info($pdo)]
    ));
} catch (Throwable $error) {
    error_log('Lehrfahrer login failed internally: ' . $error->getMessage());
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Anmeldung nicht möglich.']);
}
