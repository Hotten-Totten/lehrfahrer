<?php
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

if (!class_exists('ZipArchive')) {
    http_response_code(501);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'ZIP-Erstellung benötigt PHP ZipArchive.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$relativePackage = str_replace('\\', '/', trim((string)($_GET['package'] ?? '')));
if (!preg_match('#^fahrerunterlagen/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/paket\.json$#', $relativePackage)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Ungültiger Paketpfad.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$root = realpath(dirname(__DIR__) . '/fahrerunterlagen');
$packageFile = realpath(dirname(__DIR__) . '/' . $relativePackage);
if ($root === false || $packageFile === false || !str_starts_with($packageFile, $root . DIRECTORY_SEPARATOR)) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Paket nicht gefunden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$packageData = json_decode((string)file_get_contents($packageFile), true);
if (!is_array($packageData)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Paketdaten sind ungültig.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$packageDir = dirname($packageFile);
$tempFile = tempnam(sys_get_temp_dir(), 'lehrfahrer_zip_');
if ($tempFile === false) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Temporäre ZIP-Datei konnte nicht erstellt werden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$zip = new ZipArchive();
if ($zip->open($tempFile, ZipArchive::OVERWRITE) !== true) {
    @unlink($tempFile);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'ZIP-Datei konnte nicht erstellt werden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$zip->addFile($packageFile, 'paket.json');
foreach (glob($packageDir . '/*.pdf') ?: [] as $pdfFile) {
    if (is_file($pdfFile)) {
        $zip->addFile($pdfFile, basename($pdfFile));
    }
}
$zip->close();

$driverName = trim((string)($packageData['driverName'] ?? ''));
$driverSlug = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $driverName);
$driverSlug = trim((string)$driverSlug, '_') ?: 'Unbenannt';
$packageTimestamp = basename($packageDir);
$downloadName = 'Fahrerunterlagen_' . $driverSlug . '_' . $packageTimestamp . '.zip';

header('Content-Type: application/zip');
header('Content-Length: ' . filesize($tempFile));
header('Content-Disposition: attachment; filename="' . rawurlencode($downloadName) . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
header('X-Content-Type-Options: nosniff');
readfile($tempFile);
@unlink($tempFile);
exit;
