<?php

require_once __DIR__ . '/api/_session_auth.php';

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
    $session = lehrfahrer_auth_current_session($pdo);
    if ($session === null) {
        lehrfahrer_auth_clear_session_cookie();
        header('Cache-Control: no-store, private');
        header('Pragma: no-cache');
        header('Location: login.html', true, 302);
        exit;
    }

    $capabilities = (new LehrfahrerRoleRepository($pdo))->userCapabilities(
        (string)$session['company_id'],
        (string)$session['user_id']
    );
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
if (!is_file($editor) || readfile($editor) === false) {
    lehrfahrer_editor_response(500, 'Oberfläche konnte nicht geladen werden.');
}
