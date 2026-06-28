<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_driver_packages.php';
lehrfahrer_require_write_auth();

$input = json_decode(file_get_contents('php://input'), true);
$action = trim((string)($input['action'] ?? ''));
$packageId = trim((string)($input['id'] ?? ''));
$package = driverPackageFind($packageId);

if ($package === null) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Einweisungspaket nicht gefunden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete') {
    if (!driverPackageDeleteDirectory($package['dir'])) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Einweisungspaket konnte nicht vollständig gelöscht werden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode(['ok' => true]);
    exit;
}

if ($action === 'rename') {
    $driverName = trim((string)($input['driverName'] ?? ''));
    $data = $package['data'];
    $data['id'] = $package['storedId'] !== '' ? $package['storedId'] : driverPackageNewId();
    $data['driverName'] = $driverName;
    $data['created'] = trim((string)($data['created'] ?? ($data['createdAt'] ?? ''))) ?: date('c');
    $data['updated'] = date('c');
    $data['version'] = max(2, (int)($data['version'] ?? 1));
    $data['status'] = 'Erstellt';
    if (file_put_contents(
        $package['file'],
        json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    ) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Fahrername konnte nicht gespeichert werden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    @unlink($package['dir'] . '/paket.zip');
    echo json_encode(['ok' => true, 'id' => $data['id'], 'updated' => $data['updated']], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Ungültige Paketaktion.'], JSON_UNESCAPED_UNICODE);
