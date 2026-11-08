<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_driver_packages.php';
$companyId = lehrfahrer_personnel_authorize('packages.manage', true);

lehrfahrer_business_request($companyId, true, static function () use ($companyId): void {
$input = json_decode(file_get_contents('php://input'), true);
$action = trim((string)($input['action'] ?? ''));
$packageId = trim((string)($input['id'] ?? ''));
$package = driverPackageFind($companyId, $packageId);

if ($package === null) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Einweisungspaket nicht gefunden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'delete') {
    if (!driverPackageDeleteDirectory($companyId, $packageId)) {
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
    $data['id'] = $packageId;
    $data['driverName'] = $driverName;
    $data['created'] = trim((string)($data['created'] ?? ($data['createdAt'] ?? ''))) ?: date('c');
    $data['updated'] = date('c');
    $data['version'] = max(2, (int)($data['version'] ?? 1));
    $data['status'] = 'Erstellt';
    if (($package['data']['driverName'] ?? '') === $driverName) {
        echo json_encode(['ok' => true, 'id' => $packageId, 'updated' => $package['data']['updated'] ?? null]);
        exit;
    }
    $files = [['area' => 'packages', 'relative' => $packageId . '/paket.json', 'content' => lehrfahrer_business_json($data)]];
    if (is_file($package['dir'] . '/paket.zip')) $files[] = ['area' => 'packages',
        'relative' => $packageId . '/paket.zip', 'kind' => 'DELETE'];
    lehrfahrer_business_commit($companyId, 'PACKAGE', $packageId, 'PACKAGE_CHANGE', 'packages.manage', $files);
    echo json_encode(['ok' => true, 'id' => $data['id'], 'updated' => $data['updated']], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'error' => 'Ungültige Paketaktion.'], JSON_UNESCAPED_UNICODE);

});
