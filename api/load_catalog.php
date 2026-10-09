<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
require_once __DIR__ . '/_tenant_catalog_storage.php';
$companyId = lehrfahrer_route_authorize('stops.fetch');
try {
    $stops = lehrfahrer_catalog_load($companyId);
    echo json_encode(['ok' => true, 'stops' => $stops], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('Tenant-Katalog konnte nicht gelesen werden: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Katalog konnte nicht geladen werden.']);
}
