<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';

function citySettingsRespond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function citySettingsCity($value): string {
    $city = strtolower(trim((string)$value));
    $city = preg_replace('/[^a-z0-9_-]/', '', $city);
    return trim((string)$city, '_-');
}

function citySettingsLoad(string $file): array {
    if (!is_file($file)) return [];
    $decoded = json_decode((string)@file_get_contents($file), true);
    return is_array($decoded) ? $decoded : [];
}

function citySettingsExists(string $companyId, string $city): bool {
    return lehrfahrer_route_city_exists($companyId, $city);
}

function citySettingsSave(string $directory, string $file, array $settings): bool {
    if (!is_dir($directory)) return false;
    $json = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tempFile = $file . '.tmp';
    if (file_put_contents($tempFile, $json, LOCK_EX) === false) return false;
    if (@rename($tempFile, $file)) return true;
    $written = file_put_contents($file, $json, LOCK_EX) !== false;
    @unlink($tempFile);
    return $written;
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'GET') {
    $companyId = lehrfahrer_route_authorize('operations.settings.read');
    $city = citySettingsCity($_GET['city'] ?? '');
    if ($city === '') citySettingsRespond(400, ['ok' => false, 'error' => 'Ort fehlt.']);
    if (!citySettingsExists($companyId, $city)) citySettingsRespond(404, ['ok' => false, 'error' => 'Ort wurde nicht gefunden.']);
    $dataFile = lehrfahrer_route_settings_path($companyId);
    $settings = citySettingsLoad($dataFile);
    $entry = $settings[$city] ?? [];
    citySettingsRespond(200, [
        'ok' => true,
        'city' => $city,
        'dispatchPhone' => is_array($entry) ? trim((string)($entry['dispatchPhone'] ?? '')) : ''
    ]);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    citySettingsRespond(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}

$companyId = lehrfahrer_route_authorize('operations.settings.write', true, true);

$input = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($input)) citySettingsRespond(400, ['ok' => false, 'error' => 'Ungültige JSON-Daten.']);

$city = citySettingsCity($input['city'] ?? '');
if ($city === '') citySettingsRespond(400, ['ok' => false, 'error' => 'Ort fehlt.']);
if (!citySettingsExists($companyId, $city)) citySettingsRespond(404, ['ok' => false, 'error' => 'Ort wurde nicht gefunden.']);

$dispatchPhone = trim((string)($input['dispatchPhone'] ?? ''));
$phoneLength = function_exists('mb_strlen') ? mb_strlen($dispatchPhone, 'UTF-8') : strlen($dispatchPhone);
if ($phoneLength > 80 || preg_match('/[\x00-\x1F\x7F]/u', $dispatchPhone)) {
    citySettingsRespond(400, ['ok' => false, 'error' => 'Leitstellennummer ist ungültig.']);
}

$dataFile = lehrfahrer_route_settings_path($companyId, true);
$dataDir = dirname($dataFile);
$settings = citySettingsLoad($dataFile);
$settings[$city] = [
    'dispatchPhone' => $dispatchPhone,
    'updatedAt' => date('c')
];
ksort($settings, SORT_NATURAL | SORT_FLAG_CASE);

if (!citySettingsSave($dataDir, $dataFile, $settings)) {
    citySettingsRespond(500, ['ok' => false, 'error' => 'Leitstellennummer konnte nicht gespeichert werden.']);
}

citySettingsRespond(200, [
    'ok' => true,
    'city' => $city,
    'dispatchPhone' => $dispatchPhone
]);
