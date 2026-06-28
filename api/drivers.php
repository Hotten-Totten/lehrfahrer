<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

$dataDir = dirname(__DIR__) . '/data';
$dataFile = $dataDir . '/drivers.json';

function driverText($value, int $maxLength = 200): string {
    $text = trim((string)$value);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maxLength, 'UTF-8');
    }
    return substr($text, 0, $maxLength);
}

function loadDrivers(string $file): array {
    if (!is_file($file)) return [];
    $data = json_decode((string)@file_get_contents($file), true);
    return is_array($data) ? array_values(array_filter($data, 'is_array')) : [];
}

function saveDrivers(string $directory, string $file, array $drivers): bool {
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) return false;
    $json = json_encode(array_values($drivers), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tempFile = $file . '.tmp';
    if (file_put_contents($tempFile, $json, LOCK_EX) === false) return false;
    if (@rename($tempFile, $file)) return true;
    $written = file_put_contents($file, $json, LOCK_EX) !== false;
    @unlink($tempFile);
    return $written;
}

if (!is_file($dataFile) && !saveDrivers($dataDir, $dataFile, [])) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Fahrerliste konnte nicht angelegt werden.'], JSON_UNESCAPED_UNICODE);
    exit;
}
$drivers = loadDrivers($dataFile);
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
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
    if (($driver['id'] ?? '') === $id) {
        $index = $driverIndex;
        break;
    }
}

if ($action === 'create' || $action === 'update') {
    $firstName = driverText($input['firstName'] ?? '', 100);
    $lastName = driverText($input['lastName'] ?? '', 100);
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
        'created' => $existing['created'] ?? $now,
        'updated' => $now
    ];
    if ($index === null) $drivers[] = $record;
    else $drivers[$index] = $record;
} elseif ($action === 'toggle') {
    if ($index === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Fahrer nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $drivers[$index]['active'] = !((bool)($drivers[$index]['active'] ?? true));
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

if (!saveDrivers($dataDir, $dataFile, $drivers)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Fahrerliste konnte nicht gespeichert werden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['ok' => true, 'driver' => $record], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
