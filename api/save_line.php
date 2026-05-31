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

$baseDir = dirname(__DIR__);

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Ungültige JSON-Daten'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$city = trim($data['city'] ?? 'cottbus');
$city = strtolower($city);
$city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

if ($city === '') {
    $city = 'cottbus';
}

// lineFolder aus lineName ableiten (z.B. "Linie 16" → "Linie_16")
$lineFolder = trim($data['lineFolder'] ?? ($data['lineName'] ?? ''));
$lineFolder = sanitizeForFilesystem($lineFolder);
if ($lineFolder === '') {
    $lineFolder = 'Linie';
}

$cityDir = $baseDir . '/linien/' . $city;
$lineDir = $cityDir . '/' . $lineFolder;

if (!is_dir($lineDir)) {
    if (!mkdir($lineDir, 0775, true)) {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'error' => 'Linienordner konnte nicht erstellt werden'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

$fileBase = trim($data['fileBase'] ?? '');

if ($fileBase === '') {
    $fileBase = trim(($data['id'] ?? ''));
}

$fileBase = sanitizeForFilesystem($fileBase);

if ($fileBase === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlender Dateiname'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$data['savedAt'] = date('c');

$filePath = $lineDir . '/' . $fileBase . '.json';

// Konfliktvermeidung: Existiert die Datei bereits mit einer ANDEREN Route,
// wird ein freier Dateiname mit Zählsuffix gesucht.
// Selbe Route (gleicher routeName + directionName) → Update/Überschreiben erlaubt.
if (file_exists($filePath)) {
    $existingRaw  = @file_get_contents($filePath);
    $existingData = $existingRaw ? @json_decode($existingRaw, true) : null;
    if (is_array($existingData)) {
        $exLine  = isset($existingData['line']) && is_array($existingData['line'])
                   ? $existingData['line'] : $existingData;
        $exRoute = $exLine['routeName']     ?? ($existingData['routeName']     ?? '');
        $exDir   = $exLine['directionName'] ?? ($existingData['directionName'] ?? '');

        $inLine  = isset($data['line']) && is_array($data['line'])
                   ? $data['line'] : $data;
        $inRoute = $inLine['routeName']     ?? ($data['routeName']     ?? '');
        $inDir   = $inLine['directionName'] ?? ($data['directionName'] ?? '');

        if ($exRoute !== $inRoute || $exDir !== $inDir) {
            // Andere Route im selben Dateinamen – freie Datei mit Suffix suchen
            $origBase = $fileBase;
            $i = 1;
            while (file_exists($filePath) && $i <= 99) {
                $fileBase = $origBase . '_' . str_pad($i, 2, '0', STR_PAD_LEFT);
                $filePath = $lineDir . '/' . $fileBase . '.json';
                $i++;
            }
        }
    }
}

$json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if ($json === false) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'JSON konnte nicht erzeugt werden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$result = file_put_contents($filePath, $json);

if ($result === false) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Datei konnte nicht gespeichert werden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'ok' => true,
    'message' => 'Linie gespeichert',
    'file' => basename($filePath),
    'fileBase' => $fileBase,
    'lineFolder' => $lineFolder,
    'city' => $city,
    'savedAt' => $data['savedAt']
], JSON_UNESCAPED_UNICODE);