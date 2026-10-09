<?php
require_once __DIR__ . '/_tenant_route_storage.php';
$companyId = lehrfahrer_route_authorize('routes.read');

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

$line = trim((string)($_GET['line'] ?? ''));
$line = preg_replace('/\.(json|pdf)$/i', '', $line);
$line = sanitizeForFilesystem($line);

$lineFolder = trim((string)($_GET['lineFolder'] ?? ''));
$lineFolder = sanitizeForFilesystem($lineFolder);
$categoryFolder = trim((string)($_GET['categoryFolder'] ?? ''));
$categoryFolder = sanitizeForFilesystem($categoryFolder);

if ($line === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlender Linienname'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$pdfPath = '';

$pdfStorageFile = buildPdfStorageFileName(trim($lineFolder . '_' . $categoryFolder, '_'), $line);
if (lehrfahrer_route_city_exists($companyId, $city)) {
    $candidates = [];
    if ($lineFolder !== '' && $categoryFolder !== '') {
        $candidates[] = lehrfahrer_route_file($companyId, $city, $line, 'pdf', $lineFolder, $categoryFolder);
    }
    $candidates[] = lehrfahrer_tenant_path($companyId, 'lines', $city . '/pdf/' . $pdfStorageFile);
    if ($lineFolder !== '') {
        $candidates[] = lehrfahrer_route_file($companyId, $city, $line, 'pdf', $lineFolder);
        $candidates[] = lehrfahrer_tenant_path($companyId, 'lines', $city . '/' . $lineFolder . '/gpx/' . $line . '.pdf');
    }
    $candidates[] = lehrfahrer_route_file($companyId, $city, $line, 'pdf');
    $candidates[] = lehrfahrer_tenant_path($companyId, 'lines', $city . '/gpx/' . $line . '.pdf');
    foreach ($candidates as $candidate) {
        if (is_file($candidate)) { $pdfPath = $candidate; break; }
    }
}

if ($pdfPath === '' || !file_exists($pdfPath)) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'PDF nicht gefunden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$fileName = basename($pdfPath);

header('Content-Type: application/pdf');
header('Content-Length: ' . filesize($pdfPath));
header('Content-Disposition: attachment; filename="' . rawurlencode($fileName) . '"; filename*=UTF-8\'\'' . rawurlencode($fileName));
header('X-Content-Type-Options: nosniff');

readfile($pdfPath);
exit;
