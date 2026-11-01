<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';

// Standalone GPX export is a browser download. Only the shared route save
// may persist a GPX companion on the server.
lehrfahrer_route_require_account_write();
http_response_code(410);
echo json_encode(['ok' => false, 'error' => 'Eigenstaendiger GPX-Export ist nur als Download moeglich.'], JSON_UNESCAPED_UNICODE);
