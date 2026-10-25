<?php
declare(strict_types=1);

// TEMPORARY STAGING DIAGNOSTIC. Remove after the Line 16 storage incident is resolved.
require_once __DIR__ . '/_api_authorization.php';

if (strtolower(trim((string)getenv('LEHRFAHRER_ENV'))) !== 'staging') {
    lehrfahrer_auth_json_response(404, ['ok' => false, 'error' => 'Nicht verfügbar.']);
}
if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    header('Allow: GET');
    lehrfahrer_auth_json_response(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}
$auth = lehrfahrer_api_require_session();
lehrfahrer_auth_require_capability($auth, 'routes.read');
header('X-Lehrfahrer-Auth-Mode: session');

try {
    $company = (string)$auth['company_id'];
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', $company) !== 1) throw new RuntimeException('Ungültiger Tenant.');
    $private = realpath(trim((string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR')));
    if ($private === false || !is_dir($private) || is_link($private)) throw new RuntimeException('Privatablage nicht verfügbar.');
    $tenant = $private . '/companies/' . $company;
    $cities = $tenant . '/cities';
    $lines = $tenant . '/lines';
    $cityDir = $cities . '/cottbus';
    $lineDir = $lines . '/cottbus';
    foreach ([$tenant, $cities, $lines, $cityDir, $lineDir, $lineDir . '/Linie_16',
        $lineDir . '/Linie_16/Standard'] as $path) {
        if (is_link($path)) throw new RuntimeException('Unsicherer Tenant-Pfad.');
    }
    $places = [];
    if (is_dir($cities)) foreach (scandir($cities) ?: [] as $name) {
        if ($name === '.' || $name === '..' || preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/D', $name) !== 1) continue;
        if (is_dir($cities . '/' . $name) && !is_link($cities . '/' . $name)) $places[] = $name;
    }
    sort($places, SORT_NATURAL | SORT_FLAG_CASE);
    $routes = [];
    foreach (['01', '02'] as $number) {
        $relative = 'lines/cottbus/Linie_16/Standard/Route_' . $number . '.json';
        $path = $tenant . '/' . $relative;
        if (is_link($path)) throw new RuntimeException('Unsicherer Routenpfad.');
        $exists = is_file($path);
        $data = $exists ? json_decode((string)file_get_contents($path), true) : null;
        $routePoints = is_array($data['routePoints'] ?? null) ? $data['routePoints']
            : ($data['route']['original'] ?? null);
        $routes[$number] = [
            'relativePath' => $relative,
            'exists' => $exists,
            'validJson' => $exists && json_last_error() === JSON_ERROR_NONE && is_array($data),
            'city' => is_array($data) ? ($data['city'] ?? null) : null,
            'line' => is_array($data) ? ($data['lineName'] ?? ($data['line']['lineName'] ?? null)) : null,
            'route' => is_array($data) ? ($data['routeName'] ?? ($data['line']['routeName'] ?? null)) : null,
            'category' => is_array($data) ? ($data['variantCategory'] ?? ($data['line']['variantCategory'] ?? null)) : null,
            'variant' => is_array($data) ? ($data['variantName'] ?? ($data['line']['variantName'] ?? null)) : null,
            'lineFolder' => is_array($data) ? ($data['lineFolder'] ?? null) : null,
            'categoryFolder' => is_array($data) ? ($data['categoryFolder'] ?? null) : null,
            'fileBase' => is_array($data) ? ($data['fileBase'] ?? null) : null,
            'stops' => is_array($data['stops'] ?? null) ? count($data['stops']) : null,
            'routePoints' => is_array($routePoints) ? count($routePoints) : null,
        ];
    }
    lehrfahrer_auth_json_response(200, [
        'ok' => true,
        'temporaryDiagnostic' => true,
        'sessionCompanyId' => $company,
        'gtfsCreationCompanyId' => 'cmp_2ff1b82166c99988ed6f7eb51cca7b56',
        'sameTenant' => hash_equals('cmp_2ff1b82166c99988ed6f7eb51cca7b56', $company),
        'citiesCottbusExists' => is_dir($cityDir),
        'places' => $places,
        'linesCottbusExists' => is_dir($lineDir),
        'routes' => $routes,
    ]);
} catch (Throwable $error) {
    lehrfahrer_auth_json_response(500, ['ok' => false, 'error' => 'Staging-Diagnose nicht verfügbar.']);
}
