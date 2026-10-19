<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';
$authContext = lehrfahrer_api_authorize('routes.read');
$companyId = lehrfahrer_route_company_id($authContext);
$driverOnly = strtolower(trim(strval($_GET['scope'] ?? ''))) === 'driver';
$includeUnreleased = !$driverOnly && lehrfahrer_auth_has_capability($authContext, 'routes.write');

function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

function buildPdfStorageFileName(string $lineFolder, string $fileBase): string {
    $prefix = trim(sanitizeForFilesystem($lineFolder));
    $base = trim(sanitizeForFilesystem($fileBase));
    if ($base === '') {
        $base = 'linie';
    }
    if ($prefix !== '') {
        return $prefix . '__' . $base . '.pdf';
    }
    return $base . '.pdf';
}

$city = trim($_GET['city'] ?? 'cottbus');
$city = strtolower($city);
$city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

if ($city === '') {
    $city = 'cottbus';
}

$lineDir = lehrfahrer_route_line_city_path($companyId, $city);

$line = $_GET['line'] ?? '';
$line = preg_replace('/\.json$/i', '', $line);
$line = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $line);

$lineFolder = trim($_GET['lineFolder'] ?? '');
$lineFolder = sanitizeForFilesystem($lineFolder);
$categoryFolder = trim($_GET['categoryFolder'] ?? '');
$categoryFolder = sanitizeForFilesystem($categoryFolder);

if ($line === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlender Linienname'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Neues Format: linien/{city}/{lineFolder}/{categoryFolder}/{line}.json
// Zwischenformat: linien/{city}/{lineFolder}/{line}.json
// Fallback:     linien/{city}/{line}.json  (alte Dateien)
$filePath = lehrfahrer_route_find_file($companyId, $city, $line, 'json', $lineFolder, $categoryFolder);

if (!$filePath || !file_exists($filePath)) {
    http_response_code(404);
    echo json_encode([
        'ok' => false,
        'error' => 'Linie nicht gefunden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$content = file_get_contents($filePath);
$data = json_decode($content, true);

if (!$data || !is_array($data)) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Dateiinhalt ist ungültig'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
if (!$includeUnreleased && !lehrfahrer_gtfs_work_route_is_released($companyId, $data)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Linie nicht gefunden'], JSON_UNESCAPED_UNICODE);
    exit;
}

$baseName = pathinfo($filePath, PATHINFO_FILENAME);
$dirName = dirname($filePath);

$gpx = null;
$gpxPath = lehrfahrer_route_sibling_path($companyId, $filePath, $baseName . '.gpx');
if (!file_exists($gpxPath)) {
    $legacyGpxPath = lehrfahrer_tenant_path($companyId, 'lines', $city . '/gpx/' . $baseName . '.gpx');
    if (file_exists($legacyGpxPath)) {
        $gpxPath = $legacyGpxPath;
    }
}
if (file_exists($gpxPath)) {
    $gpxContent = @file_get_contents($gpxPath);
    if ($gpxContent !== false) {
        $gpx = $gpxContent;
    }
}

$pdfFile = null;
$pdfPath = lehrfahrer_tenant_path($companyId, 'lines', $city . '/pdf/' . buildPdfStorageFileName(trim($lineFolder . '_' . $categoryFolder, '_'), $baseName));
if (!file_exists($pdfPath)) {
    $pdfPath = lehrfahrer_route_sibling_path($companyId, $filePath, $baseName . '.pdf');
}
if (file_exists($pdfPath)) {
    $pdfFile = basename($pdfPath);
}

if ($lineFolder !== '') {
    $data['lineFolder'] = $lineFolder;
    if (isset($data['line']) && is_array($data['line'])) {
        $data['line']['lineFolder'] = $lineFolder;
    }
}
if ($categoryFolder !== '') {
    $data['categoryFolder'] = $categoryFolder;
    if (isset($data['line']) && is_array($data['line'])) {
        $data['line']['categoryFolder'] = $categoryFolder;
    }
}

echo json_encode([
    'ok' => true,
    'city' => $city,
    'line' => $data,
    'gpx' => $gpx,
    'hasPdf' => $pdfFile !== null,
    'pdfFile' => $pdfFile
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
