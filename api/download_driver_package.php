<?php
require_once __DIR__ . '/_driver_packages.php';
$companyId = lehrfahrer_personnel_authorize('packages.download');

lehrfahrer_business_request($companyId, false, static function () use ($companyId): void {
$package = driverPackageFind($companyId, trim((string)($_GET['id'] ?? '')));
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
$documentName = trim((string)($_GET['document'] ?? ''));
if ($documentName !== '') {
    $allowed = false;
    foreach (($packageData['documents'] ?? []) as $document) {
        if (is_array($document) && ($document['file'] ?? null) === $documentName) $allowed = true;
    }
    $documentPath = $allowed ? lehrfahrer_personnel_document_file($companyId, $package['id'], $documentName) : null;
    if ($documentPath === null || !is_file($documentPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => 'Dokument nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    lehrfahrer_business_download($companyId, $package['id']);
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

$pdfs = [];
foreach (($packageData['documents'] ?? []) as $document) {
    if (!is_array($document)) throw new RuntimeException('Paketdokument ungueltig.');
    $name = (string)($document['file'] ?? '');
    $file = lehrfahrer_personnel_document_file($companyId, $package['id'], $name);
    if ($file === null || !is_file($file)) throw new RuntimeException('Paketdokument fehlt.');
    $pdfs[$name] = file_get_contents($file);
}
$zipBytes = lehrfahrer_business_zip((string)file_get_contents($packageFile), $pdfs);
lehrfahrer_business_download($companyId, $package['id']);

$driverName = trim((string)($packageData['driverName'] ?? ''));
$driverSlug = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $driverName);
$driverSlug = trim((string)$driverSlug, '_') ?: 'Unbenannt';
$packageTimestamp = basename($packageDir);
$downloadName = 'Fahrerunterlagen_' . $driverSlug . '_' . $packageTimestamp . '.zip';

header('Content-Type: application/zip');
header('Content-Length: ' . strlen($zipBytes));
header('Content-Disposition: attachment; filename="' . rawurlencode($downloadName) . '"; filename*=UTF-8\'\'' . rawurlencode($downloadName));
header('X-Content-Type-Options: nosniff');
echo $zipBytes;
exit;

});
