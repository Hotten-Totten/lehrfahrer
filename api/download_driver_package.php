<?php
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_driver_packages.php';
lehrfahrer_require_write_auth();

$package = driverPackageFind(trim((string)($_GET['id'] ?? '')));
if ($package === null) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Paket nicht gefunden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$packageFile = $package['file'];
$packageData = json_decode((string)file_get_contents($packageFile), true);
if (!is_array($packageData)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Paketdaten sind ungültig.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$packageDir = dirname($packageFile);
$documentName = basename(trim((string)($_GET['document'] ?? '')));
if ($documentName !== '') {
    $documentPath = $packageDir . '/' . $documentName;
    if (strtolower((string)pathinfo($documentName, PATHINFO_EXTENSION)) !== 'pdf' || !is_file($documentPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Dokument nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($documentPath));
    header('Content-Disposition: inline; filename="' . rawurlencode($documentName) . '"; filename*=UTF-8\'\'' . rawurlencode($documentName));
    header('X-Content-Type-Options: nosniff');
    readfile($documentPath);
    exit;
}

if (!class_exists('ZipArchive')) {
    http_response_code(501);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'ZIP-Erstellung benötigt PHP ZipArchive.'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$zipPath = $packageDir . '/paket.zip';
if (!is_file($zipPath)) {
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
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
}

$driverName = trim((string)($packageData['driverName'] ?? ''));
$driverSlug = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $driverName);
$driverSlug = trim((string)$driverSlug, '_') ?: 'Unbenannt';
$packageTimestamp = basename($packageDir);
$downloadName = 'Fahrerunterlagen_' . $driverSlug . '_' . $packageTimestamp . '.zip';

header('Content-Type: application/zip');
header('Content-Length: ' . filesize($zipPath));
header('Content-Disposition: attachment; filename="' . rawurlencode($downloadName) . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
header('X-Content-Type-Options: nosniff');
readfile($zipPath);
exit;
