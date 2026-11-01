<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/_sysop_passkey_management.php';
lehrfahrer_account_test_only();
$action = (string)($_GET['action'] ?? '');
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? ''));
if (($action === 'list' && $method !== 'GET')
    || ($action !== 'list' && (!in_array($action, ['begin', 'finish', 'rename', 'revoke'], true)
        || $method !== 'POST'))) {
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
if ($method === 'POST') lehrfahrer_auth_require_same_origin();

try {
    $pdo = lehrfahrer_control_database();
    if ($action === 'list') {
        $keys = lehrfahrer_sysop_passkeys_list($pdo);
        if ($keys === null) {
            lehrfahrer_sysop_passkeys_audit_denial($pdo, 'FORBIDDEN');
            lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Nicht berechtigt.']);
        }
        lehrfahrer_auth_json_response(200, ['ok' => true, 'passkeys' => $keys]);
    }
    $csrf = lehrfahrer_auth_header('X-CSRF-Token');
    if (lehrfahrer_sysop_passkeys_session($pdo, $csrf) === null) {
        lehrfahrer_sysop_passkeys_audit_denial($pdo, 'FORBIDDEN');
        lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Nicht berechtigt.']);
    }
    $raw = (string)file_get_contents('php://input');
    $input = strlen($raw) <= 65536 ? json_decode($raw, true, 32) : null;
    if (!is_array($input) || array_is_list($input)) {
        lehrfahrer_sysop_passkeys_audit_denial($pdo, 'INVALID_INPUT');
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Anfrage ungueltig.']);
    }
    if ($action === 'begin') {
        $name = $input['name'] ?? null;
        if (!is_string($name)) {
            lehrfahrer_sysop_passkeys_audit_denial($pdo, 'INVALID_INPUT');
            lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Name fehlt.']);
        }
        $result = lehrfahrer_sysop_passkeys_begin($pdo, $csrf, $name);
        if ($result === null) {
            lehrfahrer_sysop_passkeys_audit_denial($pdo, 'FORBIDDEN');
            lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Sicherheitspruefung abgelehnt.']);
        }
        lehrfahrer_auth_json_response(200, ['ok' => true, 'options' => $result['options']]);
    }
    if ($action === 'finish') {
        $success = lehrfahrer_sysop_passkeys_finish($pdo, $csrf, $input);
        if (!$success) lehrfahrer_auth_json_response(403, ['ok' => false, 'error' => 'Passkey-Bestaetigung fehlgeschlagen.']);
        lehrfahrer_auth_json_response(200, ['ok' => true]);
    }
    $id = $input['id'] ?? null;
    if (!is_string($id) || $id === '' || strlen($id) > 64) {
        lehrfahrer_sysop_passkeys_audit_denial($pdo, 'INVALID_INPUT');
        lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Passkey ungueltig.']);
    }
    if ($action === 'rename') {
        $name = $input['name'] ?? null;
        if (!is_string($name)) {
            lehrfahrer_sysop_passkeys_audit_denial($pdo, 'INVALID_INPUT');
            lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Name fehlt.']);
        }
        $success = lehrfahrer_sysop_passkeys_rename($pdo, $csrf, $id, $name);
    } else {
        $success = lehrfahrer_sysop_passkeys_revoke($pdo, $csrf, $id);
    }
    if (!$success) lehrfahrer_auth_json_response(409, ['ok' => false, 'error' => 'Passkey-Aktion abgelehnt.']);
    lehrfahrer_auth_json_response(200, ['ok' => true]);
} catch (LehrfahrerMfaRejected $error) {
    if (isset($pdo) && $pdo instanceof PDO) lehrfahrer_sysop_passkeys_audit_denial($pdo, 'INVALID_INPUT');
    lehrfahrer_auth_json_response(400, ['ok' => false, 'error' => 'Passkey-Daten ungueltig.']);
} catch (LehrfahrerAuthCutoverBusy $error) {
    lehrfahrer_auth_json_response(503, ['ok' => false, 'error' => 'Anmeldung wird gerade aktualisiert.']);
} catch (Throwable $error) {
    error_log('Lehrfahrer SYSOP Passkey management failed internally.');
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Passkeys derzeit nicht verfuegbar.']);
}
