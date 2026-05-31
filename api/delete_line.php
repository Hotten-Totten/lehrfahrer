<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || !is_array($data)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Ungültige JSON-Daten'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$baseDir = dirname(__DIR__);

$city = trim($data['city'] ?? 'cottbus');
$city = strtolower($city);
$city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

if ($city === '') {
    $city = 'cottbus';
}

$line = trim($data['line'] ?? '');
$line = preg_replace('/\.json$/i', '', $line);
$line = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $line);

$lineFolder = trim($data['lineFolder'] ?? '');
$lineFolder = sanitizeForFilesystem($lineFolder);

if ($line === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlende Linien-ID'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$cityDir  = $baseDir . '/linien/' . $city;

// Neues Format: linien/{city}/{lineFolder}/{line}.json + .gpx
// Fallback:     linien/{city}/{line}.json + /gpx/{line}.gpx
if ($lineFolder !== '' && file_exists($cityDir . '/' . $lineFolder . '/' . $line . '.json')) {
    $jsonPath = $cityDir . '/' . $lineFolder . '/' . $line . '.json';
    $gpxPath  = $cityDir . '/' . $lineFolder . '/' . $line . '.gpx';
    $folderToClean = $cityDir . '/' . $lineFolder;
} else {
    $jsonPath = $cityDir . '/' . $line . '.json';
    $gpxPath  = $cityDir . '/gpx/' . $line . '.gpx';
    $folderToClean = null;
}

if (!file_exists($jsonPath)) {
    http_response_code(404);
    echo json_encode([
        'ok' => false,
        'error' => 'Linie nicht gefunden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$deletedJson = unlink($jsonPath);
$deletedGpx = false;

if (file_exists($gpxPath)) {
    $deletedGpx = unlink($gpxPath);
}

// Leeren Linienordner aufräumen
if ($folderToClean && is_dir($folderToClean)) {
    $remaining = array_diff(scandir($folderToClean), ['.', '..']);
    if (empty($remaining)) {
        rmdir($folderToClean);
    }
}

if (!$deletedJson) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'JSON-Datei konnte nicht gelöscht werden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok' => true,
    'city' => $city,
    'line' => $line,
    'deletedJson' => $deletedJson,
    'deletedGpx' => $deletedGpx
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);