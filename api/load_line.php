<?php
header('Content-Type: application/json; charset=utf-8');

function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

$baseDir = dirname(__DIR__);

$city = trim($_GET['city'] ?? 'cottbus');
$city = strtolower($city);
$city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

if ($city === '') {
    $city = 'cottbus';
}

$lineDir = $baseDir . '/linien/' . $city;

$line = $_GET['line'] ?? '';
$line = preg_replace('/\.json$/i', '', $line);
$line = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $line);

$lineFolder = trim($_GET['lineFolder'] ?? '');
$lineFolder = sanitizeForFilesystem($lineFolder);

if ($line === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlender Linienname'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Neues Format: linien/{city}/{lineFolder}/{line}.json
// Fallback:     linien/{city}/{line}.json  (alte Dateien)
$filePath = '';
if ($lineFolder !== '' && file_exists($lineDir . '/' . $lineFolder . '/' . $line . '.json')) {
    $filePath = $lineDir . '/' . $lineFolder . '/' . $line . '.json';
} elseif (file_exists($lineDir . '/' . $line . '.json')) {
    $filePath = $lineDir . '/' . $line . '.json';
}

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

echo json_encode([
    'ok' => true,
    'city' => $city,
    'line' => $data
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);