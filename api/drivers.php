<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_personnel_storage.php';
$driverMethod = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$companyId = lehrfahrer_personnel_authorize($driverMethod === 'GET' ? 'drivers.read' : 'drivers.manage', $driverMethod !== 'GET');

$dataDir = lehrfahrer_tenant_area($companyId, 'drivers', true);
$dataFile = lehrfahrer_personnel_driver_file($companyId, true);

function driverText($value, int $maxLength = 200): string {
    $text = trim((string)$value);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maxLength, 'UTF-8');
    }
    return substr($text, 0, $maxLength);
}

function loadDrivers(string $file): array {
    if (!is_file($file)) return [];
    $data = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data) || !array_is_list($data) || count(array_filter($data, 'is_array')) !== count($data)) {
        throw new RuntimeException('Fahrerliste ungueltig.');
    }
    return $data;
}

function driverRoles($value): array {
    $allowed = ['Admin', 'Disponent', 'Einweiser', 'Fahrer'];
    $roles = is_array($value) ? $value : [];
    $roles = array_values(array_unique(array_filter(array_map(static function ($role): string {
        return trim((string)$role);
    }, $roles), static function (string $role) use ($allowed): bool {
        return in_array($role, $allowed, true);
    })));
    return $roles ?: ['Fahrer'];
}

function normalizeDriver(array $driver): array {
    $driver['roles'] = driverRoles($driver['roles'] ?? null);
    return $driver;
}

lehrfahrer_business_request($companyId, $driverMethod !== 'GET', static function () use ($companyId, $driverMethod, $dataFile, $dataDir): void {
$drivers = array_map('normalizeDriver', loadDrivers($dataFile));
if ($driverMethod === 'GET') {
    usort($drivers, static function (array $a, array $b): int {
        $left = ($a['lastName'] ?? '') . ' ' . ($a['firstName'] ?? '');
        $right = ($b['lastName'] ?? '') . ' ' . ($b['firstName'] ?? '');
        return strnatcasecmp($left, $right);
    });
    echo json_encode(['ok' => true, 'drivers' => $drivers], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$action = driverText($input['action'] ?? '', 30);
$id = driverText($input['id'] ?? '', 80);
$index = null;
foreach ($drivers as $driverIndex => $driver) {
    if (($driver['id'] ?? '') === $id && ($input['action'] ?? '') !== 'create') {
        $index = $driverIndex;
        break;
    }
}

if ($action === 'create' || $action === 'update') {
    $firstName = driverText($input['firstName'] ?? ($input['vorname'] ?? ''), 100);
    $lastName = driverText($input['lastName'] ?? ($input['nachname'] ?? ''), 100);
    if ($firstName === '' && $lastName === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Vorname oder Nachname ist erforderlich.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($action === 'update' && $index === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Fahrer nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $now = date('c');
    $existing = $index !== null ? $drivers[$index] : [];
    $record = [
        'id' => $index !== null ? $id : 'drv_' . bin2hex(random_bytes(16)),
        'firstName' => $firstName,
        'lastName' => $lastName,
        'personnelNumber' => driverText($input['personnelNumber'] ?? '', 100),
        'depot' => driverText($input['depot'] ?? '', 150),
        'note' => driverText($input['note'] ?? '', 1000),
        'active' => array_key_exists('active', $input) ? (bool)$input['active'] : true,
        'roles' => driverRoles($input['roles'] ?? ($existing['roles'] ?? null)),
        'created' => $existing['created'] ?? $now,
        'updated' => $now
    ];
    if ($index !== null) {
        $before = $existing; $after = $record;
        unset($before['updated'], $after['updated']);
        if ($before == $after) {
            echo json_encode(['ok' => true, 'driver' => $existing], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }
    }
    if ($index === null) $drivers[] = $record;
    else $drivers[$index] = $record;
} elseif ($action === 'toggle') {
    if ($index === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Fahrer nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $drivers[$index]['active'] = !((bool)($drivers[$index]['active'] ?? true));
    $drivers[$index]['roles'] = driverRoles($drivers[$index]['roles'] ?? null);
    $drivers[$index]['updated'] = date('c');
    $record = $drivers[$index];
} elseif ($action === 'delete') {
    if ($index === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Fahrer nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $record = $drivers[$index];
    array_splice($drivers, $index, 1);
} else {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Ungültige Fahreraktion.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$eventAction = match ($action) { 'create' => 'DRIVER_CREATE', 'update' => 'DRIVER_CHANGE',
    'toggle' => 'DRIVER_STATUS_CHANGE', 'delete' => 'DRIVER_DELETE' };
lehrfahrer_business_commit($companyId, 'DRIVER', $record['id'], $eventAction, 'drivers.manage',
    [['area' => 'drivers', 'relative' => 'drivers.json', 'content' => lehrfahrer_business_json(array_values($drivers))]]);

echo json_encode(['ok' => true, 'driver' => $record], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

});
