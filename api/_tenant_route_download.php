<?php

require_once __DIR__ . '/_tenant_route_storage.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';

function lehrfahrer_download_tenant_route(string $extension): never {
    $auth = lehrfahrer_api_authorize('routes.read');
    $companyId = lehrfahrer_route_company_id($auth);
    $city = strtolower(trim((string)($_GET['city'] ?? '')));
    $line = trim((string)($_GET['line'] ?? ''));
    $line = preg_replace('/\.(json|gpx)$/i', '', $line);
    $lineFolder = trim((string)($_GET['lineFolder'] ?? ''));
    $categoryFolder = trim((string)($_GET['categoryFolder'] ?? ''));
    try {
        foreach (array_filter([$city, $line, $lineFolder, $categoryFolder], static fn($value) => $value !== '') as $segment) {
            lehrfahrer_route_segment($segment);
        }
        if ($city === '' || $line === '') throw new InvalidArgumentException('Pflichtangabe fehlt.');
        $path = lehrfahrer_route_find_file($companyId, $city, $line, $extension, $lineFolder, $categoryFolder);
        if ($path === null && $extension === 'gpx' && lehrfahrer_route_city_exists($companyId, $city)) {
            $legacy = lehrfahrer_tenant_path($companyId, 'lines', $city . '/gpx/' . $line . '.gpx');
            if (is_file($legacy)) $path = $legacy;
        }
    } catch (InvalidArgumentException $error) {
        http_response_code(400);
        exit;
    }
    if ($path === null) {
        http_response_code(404);
        exit;
    }
    if ($extension === 'json' && !lehrfahrer_auth_has_capability($auth, 'routes.write')) {
        $route = lehrfahrer_gtfs_work_load_driver_route($companyId, $path);
        if ($route === null) {
            http_response_code(404);
            exit;
        }
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $line . '.json"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($route, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    header('Content-Type: ' . ($extension === 'json' ? 'application/json' : 'application/gpx+xml') . '; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $line . '.' . $extension . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}
