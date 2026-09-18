<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

function cityManageRespond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

set_exception_handler(function (Throwable $error): void {
    error_log('manage_city.php: ' . $error->getMessage());
    cityManageRespond(500, ['ok' => false, 'error' => 'Interner Serverfehler der Ortsverwaltung.']);
});

function cityManageSlug($value): string {
    $name = trim((string)$value);
    $name = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    $name = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $name);
    $name = preg_replace('/[^a-z0-9_-]+/u', '-', $name);
    $name = preg_replace('/-+/', '-', (string)$name);
    return trim((string)$name, '-_');
}

function cityManagePath(string $root, string $city): ?string {
    $direct = $root . DIRECTORY_SEPARATOR . $city;
    $legacy = $root . DIRECTORY_SEPARATOR . 'linien' . DIRECTORY_SEPARATOR . $city;
    $matches = array_values(array_filter([$direct, $legacy], 'is_dir'));
    if (count($matches) > 1) {
        cityManageRespond(409, ['ok' => false, 'error' => 'Der Ort existiert in mehreren Speicherstrukturen. Bitte zuerst die Verzeichnisstruktur bereinigen.']);
    }
    return $matches[0] ?? null;
}

function cityManageJsonFiles(string $directory): array {
    $files = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($iterator as $item) {
        if ($item->isFile() && strtolower($item->getExtension()) === 'json') $files[] = $item->getPathname();
    }
    sort($files, SORT_NATURAL | SORT_FLAG_CASE);
    return $files;
}

function cityManageSettingsLoad(string $file): array {
    if (!is_file($file)) return [];
    $decoded = json_decode((string)@file_get_contents($file), true);
    return is_array($decoded) ? $decoded : [];
}

function cityManageAtomicJsonSave(string $file, array $data): bool {
    $directory = dirname($file);
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) return false;
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $temp = $file . '.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($temp, $json, LOCK_EX) === false) return false;
    if (!is_file($file) && @rename($temp, $file)) return true;
    $backup = $file . '.bak-' . bin2hex(random_bytes(6));
    if (is_file($file) && @rename($file, $backup)) {
        if (@rename($temp, $file)) {
            @unlink($backup);
            return true;
        }
        @rename($backup, $file);
    }
    @unlink($temp);
    return false;
}

function cityManageRouteType(array $data): string {
    $type = strtolower(trim((string)($data['routeType'] ?? ($data['line']['routeType'] ?? 'line'))));
    return in_array($type, ['pullout', 'pullin', 'transfer'], true) ? $type : 'line';
}

function cityManageAnalyze(string $path, string $city, array $settings): array {
    $lineNames = [];
    $normalRoutes = 0;
    $operationalRoutes = 0;
    $invalidJson = 0;
    foreach (cityManageJsonFiles($path) as $file) {
        $data = json_decode((string)@file_get_contents($file), true);
        if (!is_array($data)) {
            $invalidJson++;
            continue;
        }
        if (cityManageRouteType($data) === 'line') {
            $normalRoutes++;
            $lineName = trim((string)($data['lineName'] ?? ($data['line']['lineName'] ?? '')));
            if ($lineName !== '') $lineNames[strtolower($lineName)] = true;
        } else {
            $operationalRoutes++;
        }
    }
    $citySettings = is_array($settings[$city] ?? null) ? $settings[$city] : [];
    $dispatchPhone = trim((string)($citySettings['dispatchPhone'] ?? ''));
    return [
        'normalLineCount' => count($lineNames),
        'normalRouteCount' => $normalRoutes,
        'operationalRouteCount' => $operationalRoutes,
        'totalRouteCount' => $normalRoutes + $operationalRoutes,
        'dispatchPhone' => $dispatchPhone,
        'hasDispatchPhone' => $dispatchPhone !== '',
        'additionalSettingCount' => count(array_diff_key($citySettings, ['dispatchPhone' => true, 'updatedAt' => true])),
        'invalidJsonCount' => $invalidJson,
    ];
}

function cityManageMigrateReferences(&$value, string $key, string $oldCity, string $newCity): void {
    if (is_array($value)) {
        foreach ($value as $childKey => &$child) {
            cityManageMigrateReferences($child, (string)$childKey, $oldCity, $newCity);
        }
        unset($child);
        return;
    }
    if (!is_string($value)) return;
    if ($key === 'city' && strtolower(trim($value)) === $oldCity) {
        $value = $newCity;
        return;
    }
    if ($key === 'relatedRouteIds' || ctype_digit($key)) {
        if (str_starts_with($value, $oldCity . '/')) $value = $newCity . substr($value, strlen($oldCity));
    }
    if (in_array($key, ['jsonPath', 'gpxPath', 'pdfPath'], true)) {
        $value = str_replace('linien/' . $oldCity . '/', 'linien/' . $newCity . '/', $value);
    }
}

function cityManageRestoreFiles(array $originals): void {
    foreach ($originals as $file => $content) @file_put_contents($file, $content, LOCK_EX);
}

function cityManageDeleteTree(string $directory): bool {
    if (!is_dir($directory)) return true;
    $items = scandir($directory);
    if ($items === false) return false;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $directory . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path)) {
            if (!cityManageDeleteTree($path)) return false;
        } elseif (!@unlink($path)) {
            return false;
        }
    }
    return @rmdir($directory);
}

function cityManageAvailableCities(string $root): array {
    $cities = [];
    foreach (@scandir($root) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || in_array($entry, ['linien', 'backup', 'gpx', 'pdf'], true) || str_starts_with($entry, '.')) continue;
        if (is_dir($root . DIRECTORY_SEPARATOR . $entry)) $cities[] = $entry;
    }
    $legacyRoot = $root . DIRECTORY_SEPARATOR . 'linien';
    foreach (@scandir($legacyRoot) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || str_starts_with($entry, '.')) continue;
        if (is_dir($legacyRoot . DIRECTORY_SEPARATOR . $entry)) $cities[] = $entry;
    }
    $cities = array_values(array_unique($cities));
    natcasesort($cities);
    return array_values($cities);
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'POST') {
    header('Allow: POST');
    cityManageRespond(405, ['ok' => false, 'error' => 'Methode nicht erlaubt.']);
}

$input = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($input)) cityManageRespond(400, ['ok' => false, 'error' => 'Ungültige JSON-Daten.']);
$action = strtolower(trim((string)($input['action'] ?? '')));
$city = cityManageSlug($input['oldName'] ?? ($input['city'] ?? ''));
if ($city === '') cityManageRespond(400, ['ok' => false, 'error' => 'Ort fehlt.']);

$projectRoot = dirname(__DIR__);
$citiesRoot = $projectRoot . DIRECTORY_SEPARATOR . 'linien';
$dataRoot = $projectRoot . DIRECTORY_SEPARATOR . 'data';
$settingsFile = $dataRoot . DIRECTORY_SEPARATOR . 'city_settings.json';
$sourcePath = cityManagePath($citiesRoot, $city);
if ($sourcePath === null) cityManageRespond(404, ['ok' => false, 'error' => 'Ort wurde nicht gefunden.']);

if (!is_dir($dataRoot) && !mkdir($dataRoot, 0775, true)) {
    cityManageRespond(500, ['ok' => false, 'error' => 'Datenverzeichnis für die Ortsverwaltung ist nicht verfügbar.']);
}
$lock = fopen($dataRoot . DIRECTORY_SEPARATOR . '.city-management.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) cityManageRespond(503, ['ok' => false, 'error' => 'Ortsverwaltung ist derzeit gesperrt.']);
$settings = cityManageSettingsLoad($settingsFile);
$analysis = cityManageAnalyze($sourcePath, $city, $settings);

if ($action === 'analyze') {
    cityManageRespond(200, ['ok' => true, 'city' => $city, 'analysis' => $analysis]);
}

if ($action === 'rename') {
    $newCity = cityManageSlug($input['newName'] ?? ($input['newCity'] ?? ''));
    if ($newCity === '') cityManageRespond(400, ['ok' => false, 'error' => 'Der neue Ortsname darf nicht leer sein.']);
    if ($newCity === $city) cityManageRespond(409, ['ok' => false, 'error' => 'Der neue Ortsname ist mit dem bisherigen Namen identisch.']);
    if (cityManagePath($citiesRoot, $newCity) !== null) cityManageRespond(409, ['ok' => false, 'error' => 'Ein Ort mit diesem Namen existiert bereits.']);
    if (array_key_exists($newCity, $settings)) cityManageRespond(409, ['ok' => false, 'error' => 'Für diesen Ortsnamen existieren bereits Einstellungen.']);

    $parent = dirname($sourcePath);
    $tempPath = $parent . DIRECTORY_SEPARATOR . '.city-rename-' . bin2hex(random_bytes(8));
    $targetPath = $parent . DIRECTORY_SEPARATOR . $newCity;
    if (!@rename($sourcePath, $tempPath)) cityManageRespond(500, ['ok' => false, 'error' => 'Ortsordner konnte nicht für die Umbenennung gesperrt werden.']);

    $originals = [];
    foreach (cityManageJsonFiles($tempPath) as $file) {
        $raw = (string)@file_get_contents($file);
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            cityManageRestoreFiles($originals);
            @rename($tempPath, $sourcePath);
            cityManageRespond(422, ['ok' => false, 'error' => 'Ungültige JSON-Datei verhindert die sichere Umbenennung: ' . basename($file)]);
        }
        $originals[$file] = $raw;
        cityManageMigrateReferences($data, '', $city, $newCity);
        if (!cityManageAtomicJsonSave($file, $data)) {
            cityManageRestoreFiles($originals);
            @rename($tempPath, $sourcePath);
            cityManageRespond(500, ['ok' => false, 'error' => 'Routenreferenzen konnten nicht vollständig migriert werden.']);
        }
    }

    $originalSettings = $settings;
    if (array_key_exists($city, $settings)) {
        $settings[$newCity] = $settings[$city];
        unset($settings[$city]);
    }
    ksort($settings, SORT_NATURAL | SORT_FLAG_CASE);
    if (!cityManageAtomicJsonSave($settingsFile, $settings)) {
        cityManageRestoreFiles($originals);
        @rename($tempPath, $sourcePath);
        cityManageRespond(500, ['ok' => false, 'error' => 'Ortseinstellungen konnten nicht migriert werden.']);
    }
    if (!@rename($tempPath, $targetPath)) {
        cityManageAtomicJsonSave($settingsFile, $originalSettings);
        cityManageRestoreFiles($originals);
        @rename($tempPath, $sourcePath);
        cityManageRespond(500, ['ok' => false, 'error' => 'Ortsordner konnte nicht auf den neuen Namen gesetzt werden.']);
    }
    cityManageRespond(200, [
        'ok' => true,
        'action' => 'rename',
        'oldCity' => $city,
        'city' => $newCity,
        'analysis' => $analysis,
        'migratedRouteFiles' => count($originals),
    ]);
}

if ($action === 'delete') {
    if (($input['confirmed'] ?? false) !== true) cityManageRespond(409, ['ok' => false, 'error' => 'Explizite Löschbestätigung fehlt.', 'analysis' => $analysis]);
    if (!is_dir($dataRoot) && !mkdir($dataRoot, 0775, true)) cityManageRespond(500, ['ok' => false, 'error' => 'Datenverzeichnis ist nicht verfügbar.']);
    $trashPath = $dataRoot . DIRECTORY_SEPARATOR . '.city-trash-' . $city . '-' . bin2hex(random_bytes(8));
    if (!@rename($sourcePath, $trashPath)) cityManageRespond(500, ['ok' => false, 'error' => 'Ortsdaten konnten nicht atomar aus dem Katalog entfernt werden.']);
    unset($settings[$city]);
    if (!cityManageAtomicJsonSave($settingsFile, $settings)) {
        @rename($trashPath, $sourcePath);
        cityManageRespond(500, ['ok' => false, 'error' => 'Ortseinstellungen konnten nicht entfernt werden.']);
    }
    $deleted = cityManageDeleteTree($trashPath);
    if (!$deleted) {
        $remaining = cityManageAvailableCities($citiesRoot);
        cityManageRespond(200, [
            'ok' => true,
            'action' => 'delete',
            'city' => $city,
            'analysis' => $analysis,
            'nextCity' => $remaining[0] ?? '',
            'cleanupPending' => true,
            'warning' => 'Der Ort wurde aus Katalog und Einstellungen entfernt; nicht aktive Restdateien konnten serverseitig nicht vollständig bereinigt werden.',
        ]);
    }
    $remaining = cityManageAvailableCities($citiesRoot);
    cityManageRespond(200, [
        'ok' => true,
        'action' => 'delete',
        'city' => $city,
        'analysis' => $analysis,
        'nextCity' => $remaining[0] ?? '',
    ]);
}

cityManageRespond(400, ['ok' => false, 'error' => 'Unbekannte Aktion.']);
