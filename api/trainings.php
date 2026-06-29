<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

$trainingDir = dirname(__DIR__) . '/data/trainings';

function trainingText($value, int $maxLength = 500): string {
    $text = trim((string)$value);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maxLength, 'UTF-8');
    }
    return substr($text, 0, $maxLength);
}

function trainingLoadAll(string $directory): array {
    if (!is_dir($directory)) return [];
    $trainings = [];
    foreach (glob($directory . '/training_*.json') ?: [] as $file) {
        $data = json_decode((string)@file_get_contents($file), true);
        if (!is_array($data)) continue;
        $data['file'] = basename($file);
        $trainings[] = $data;
    }
    usort($trainings, static function (array $a, array $b): int {
        return strcmp((string)($b['created'] ?? ''), (string)($a['created'] ?? ''));
    });
    return $trainings;
}

function trainingNextId(string $directory): string {
    $max = 0;
    foreach (glob($directory . '/training_*.json') ?: [] as $file) {
        if (preg_match('/training_(\d{6})\.json$/', basename($file), $match)) {
            $max = max($max, (int)$match[1]);
        }
    }
    return 'training_' . str_pad((string)($max + 1), 6, '0', STR_PAD_LEFT);
}

function trainingSanitizeStatus(string $status): string {
    return in_array($status, ['created', 'running', 'completed', 'archived'], true) ? $status : 'created';
}

function trainingRouteItem($item): array {
    if (!is_array($item)) return [];
    return [
        'city' => trainingText($item['city'] ?? '', 120),
        'lineFolder' => trainingText($item['lineFolder'] ?? '', 160),
        'categoryFolder' => trainingText($item['categoryFolder'] ?? '', 160),
        'fileBase' => trainingText($item['fileBase'] ?? '', 220),
        'lineName' => trainingText($item['lineName'] ?? '', 160),
        'routeName' => trainingText($item['routeName'] ?? '', 160),
        'directionName' => trainingText($item['directionName'] ?? '', 240),
        'variantName' => trainingText($item['variantName'] ?? '', 180),
        'variantCategory' => trainingText($item['variantCategory'] ?? 'Standard', 160),
        'jsonPath' => trainingText($item['jsonPath'] ?? '', 260),
        'pdfPath' => trainingText($item['pdfPath'] ?? '', 260),
        'gpxPath' => trainingText($item['gpxPath'] ?? '', 260),
    ];
}

function trainingSave(string $directory, string $file, array $training): bool {
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) return false;
    $json = json_encode($training, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tempFile = $file . '.tmp';
    if (file_put_contents($tempFile, $json, LOCK_EX) === false) return false;
    if (@rename($tempFile, $file)) return true;
    $written = file_put_contents($file, $json, LOCK_EX) !== false;
    @unlink($tempFile);
    return $written;
}

function trainingFileForId(string $directory, string $trainingId): string {
    if (!preg_match('/^training_\d{6}$/', $trainingId)) return '';
    return $directory . '/' . $trainingId . '.json';
}

function trainingLoadById(string $directory, string $trainingId): ?array {
    $file = trainingFileForId($directory, $trainingId);
    if ($file === '' || !is_file($file)) return null;
    $data = json_decode((string)@file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

function trainingCanChangeStatus(string $current, string $target): bool {
    $allowed = [
        'created' => ['running', 'completed'],
        'running' => ['completed'],
        'completed' => ['archived'],
        'archived' => [],
    ];
    return in_array($target, $allowed[$current] ?? [], true);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $status = trainingText($_GET['status'] ?? '', 40);
    $trainings = trainingLoadAll($trainingDir);
    if ($status === 'running') {
        $trainings = array_values(array_filter($trainings, static function (array $training): bool {
            return in_array((string)($training['status'] ?? 'created'), ['created', 'running'], true);
        }));
    } elseif ($status === 'completed') {
        $trainings = array_values(array_filter($trainings, static function (array $training): bool {
            return (string)($training['status'] ?? '') === 'completed';
        }));
    } elseif ($status !== '') {
        $trainings = array_values(array_filter($trainings, static function (array $training) use ($status): bool {
            return (string)($training['status'] ?? '') === $status;
        }));
    }
    echo json_encode(['ok' => true, 'trainings' => $trainings], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Ungültige Einweisungsdaten.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$action = trainingText($input['action'] ?? '', 40);
if ($action === 'updateStatus') {
    $trainingId = trainingText($input['trainingId'] ?? '', 80);
    $targetStatus = trainingSanitizeStatus((string)($input['status'] ?? ''));
    $training = trainingLoadById($trainingDir, $trainingId);
    if ($training === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Einweisung nicht gefunden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $currentStatus = trainingSanitizeStatus((string)($training['status'] ?? 'created'));
    if (!trainingCanChangeStatus($currentStatus, $targetStatus)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Dieser Statuswechsel ist nicht erlaubt.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $now = date('c');
    $training['trainingId'] = $training['trainingId'] ?? $trainingId;
    $training['status'] = $targetStatus;
    $training['updated'] = $now;
    if ($targetStatus === 'completed') {
        $training['completed'] = $now;
    }
    $file = trainingFileForId($trainingDir, $trainingId);
    if ($file === '' || !trainingSave($trainingDir, $file, $training)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Einweisung konnte nicht aktualisiert werden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode(['ok' => true, 'training' => $training], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action !== 'create') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Ungültige Einweisungsaktion.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$routes = array_values(array_filter(array_map('trainingRouteItem', is_array($input['routes'] ?? null) ? $input['routes'] : [])));
if (!$routes) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Bitte mindestens eine Linie auswählen.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$trainingId = trainingNextId($trainingDir);
$now = date('c');
$training = [
    'trainingId' => $trainingId,
    'created' => $now,
    'updated' => $now,
    'status' => trainingSanitizeStatus($input['status'] ?? 'created'),
    'driverId' => trainingText($input['driverId'] ?? '', 120),
    'driverName' => trainingText($input['driverName'] ?? '', 200),
    'trainer' => trainingText($input['trainer'] ?? '', 200),
    'company' => trainingText($input['company'] ?? '', 200),
    'routes' => $routes,
    'documents' => is_array($input['documents'] ?? null) ? $input['documents'] : [],
    'notes' => trainingText($input['notes'] ?? '', 2000),
    'completed' => null,
];

$file = $trainingDir . '/' . $trainingId . '.json';
if (!trainingSave($trainingDir, $file, $training)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Einweisung konnte nicht gespeichert werden.'], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['ok' => true, 'training' => $training], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
