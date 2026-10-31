<?php

require_once __DIR__ . '/api/_session_auth.php';
require_once __DIR__ . '/api/_api_authorization.php';

function lehrfahrer_editor_response(int $status, string $message): never {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    echo '<!doctype html><html lang="de"><meta charset="utf-8"><title>Lehrfahrer</title>'
        . '<p>' . htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>';
    exit;
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if (!in_array($method, ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD');
    lehrfahrer_editor_response(405, 'Methode nicht erlaubt.');
}

try {
    $pdo = lehrfahrer_control_database();
    $auth = lehrfahrer_api_resolve_session($pdo);
    if ($auth === null) {
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        header('Location: ' . (lehrfahrer_environment() === 'staging'
            ? 'account-login.php?next=%2F' : 'login.html'), true, 302);
        exit;
    }

    $capabilities = $auth['capabilities'];
    if (!in_array('routes.read', $capabilities, true)) {
        lehrfahrer_editor_response(403, 'Keine Berechtigung für diese Oberfläche.');
    }
} catch (Throwable $error) {
    error_log('Lehrfahrer editor access check failed internally: ' . $error->getMessage());
    lehrfahrer_editor_response(503, 'Anmeldung kann derzeit nicht geprüft werden.');
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
if ($method === 'HEAD') exit;

$editor = __DIR__ . '/index.html';
if (!is_file($editor)) {
    lehrfahrer_editor_response(500, 'Oberfläche konnte nicht geladen werden.');
}

$editorHtml = file_get_contents($editor);
if ($editorHtml === false) {
    lehrfahrer_editor_response(500, 'Oberfläche konnte nicht geladen werden.');
}

$csrfToken = lehrfahrer_auth_csrf_token((string)($auth['auth_source'] === 'ACCOUNT'
    ? $auth['session']['_token'] : $auth['session']['_session_token']));
$csrfMeta = '<meta name="lehrfahrer-csrf-token" content="'
    . htmlspecialchars($csrfToken, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">';
$editorHtml = str_replace(
    '<meta name="lehrfahrer-csrf-token" content="">',
    $csrfMeta,
    $editorHtml,
    $csrfPlaceholderCount
);
if ($csrfPlaceholderCount !== 1) {
    lehrfahrer_editor_response(500, 'Oberfläche konnte nicht sicher initialisiert werden.');
}

if ($auth['auth_source'] === 'ACCOUNT') {
    $editorHtml = str_replace('id="accountMenuRoot" style="display:none"',
        'id="accountMenuRoot"', $editorHtml);
}

echo $editorHtml;
