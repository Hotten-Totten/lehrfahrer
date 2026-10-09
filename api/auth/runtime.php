<?php

require_once dirname(__DIR__) . '/_control_database.php';

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    echo json_encode(['ok' => false, 'error' => 'Methode nicht erlaubt.'], JSON_UNESCAPED_UNICODE);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Pragma: no-cache');
try {
    $pdo = lehrfahrer_control_database();
    echo json_encode(['ok' => true, 'runtime' => lehrfahrer_runtime_info($pdo)], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('Lehrfahrer runtime info failed internally: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Runtime-Information nicht verfügbar.'], JSON_UNESCAPED_UNICODE);
}
