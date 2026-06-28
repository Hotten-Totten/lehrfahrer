<?php
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

$baseDir = dirname(__DIR__);

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

$lineDir = $baseDir . '/linien/' . $city;
$pdfPath = '';

$pdfStorageFile = buildPdfStorageFileName(trim($lineFolder . '_' . $categoryFolder, '_'), $line);

if ($lineFolder !== '' && $categoryFolder !== '' && file_exists($lineDir . '/' . $lineFolder . '/' . $categoryFolder . '/' . $line . '.pdf')) {
    $pdfPath = $lineDir . '/' . $lineFolder . '/' . $categoryFolder . '/' . $line . '.pdf';
} elseif (file_exists($lineDir . '/pdf/' . $pdfStorageFile)) {
    $pdfPath = $lineDir . '/pdf/' . $pdfStorageFile;
} elseif ($lineFolder !== '' && file_exists($lineDir . '/' . $lineFolder . '/' . $line . '.pdf')) {
    $pdfPath = $lineDir . '/' . $lineFolder . '/' . $line . '.pdf';
} elseif ($lineFolder !== '' && file_exists($lineDir . '/' . $lineFolder . '/gpx/' . $line . '.pdf')) {
    $pdfPath = $lineDir . '/' . $lineFolder . '/gpx/' . $line . '.pdf';
} elseif (file_exists($lineDir . '/' . $line . '.pdf')) {
    $pdfPath = $lineDir . '/' . $line . '.pdf';
} elseif (file_exists($lineDir . '/gpx/' . $line . '.pdf')) {
    $pdfPath = $lineDir . '/gpx/' . $line . '.pdf';
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
