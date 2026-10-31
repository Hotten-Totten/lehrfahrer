<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_account_auth.php';
lehrfahrer_account_test_only();

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? '')) !== 'POST'
    || !in_array((string)($_GET['action'] ?? ''), ['begin', 'finish'], true)) {
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
lehrfahrer_auth_require_same_origin();

try {
    $pdo = lehrfahrer_control_database();
    $csrf = lehrfahrer_auth_header('X-CSRF-Token');
    if ($csrf === '') lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Sicherheitspruefung abgelehnt.']);
    if ($_GET['action'] === 'begin') {
        $result = lehrfahrer_sysop_mfa_begin($pdo, $csrf);
        if ($result === null) lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Sicherheitspruefung abgelehnt.']);
        lehrfahrer_auth_json_response(200, ['ok' => true, 'purpose' => $result['purpose'],
            'options' => $result['options']]);
    }
    $raw = (string)file_get_contents('php://input');
    $input = strlen($raw) <= 65536 ? json_decode($raw, true, 32) : null;
    if (!is_array($input) || array_diff(array_keys($input),
        ['id', 'clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle']) !== []) $input = [];
    $result = lehrfahrer_sysop_mfa_finish($pdo, $csrf, $input);
    if ($result === null) lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Passkey-Bestaetigung fehlgeschlagen.']);
    lehrfahrer_sysop_mfa_clear_cookie();
    unset($_COOKIE[LEHRFAHRER_SYSOP_MFA_COOKIE]);
    if ($result['enrolled']) {
        lehrfahrer_auth_json_response(200, ['ok' => true, 'enrolled' => true]);
    }
    $session = $result['session'];
    lehrfahrer_account_set_cookie($session['token'], $session['absoluteExpiresAt']);
    $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE] = $session['token'];
    $current = lehrfahrer_account_current_session($pdo, false);
    if ($current === null) throw new RuntimeException('Session nach Passkey-Bestaetigung ungueltig.');
    lehrfahrer_auth_json_response(200, lehrfahrer_account_public_session($pdo, $current));
} catch (LehrfahrerAuthCutoverBusy $error) {
    lehrfahrer_auth_json_response(503, ['ok' => false, 'error' => 'Anmeldung wird gerade aktualisiert.']);
} catch (Throwable $error) {
    error_log('Lehrfahrer SYSOP MFA failed internally.');
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Sicherheitspruefung derzeit nicht moeglich.']);
}
