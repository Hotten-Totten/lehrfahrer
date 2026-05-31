<?php
header("Content-Type: application/json; charset=utf-8");

$baseDir = __DIR__ . "/../linien";

if (!is_dir($baseDir)) {
    mkdir($baseDir, 0775, true);
}

$entries = scandir($baseDir);
$cities = [];

function cityHasLineJson(string $cityPath): bool {
    // Altes Format: linien/{city}/*.json
    $directJson = glob($cityPath . '/*.json');
    if (!empty($directJson)) {
        return true;
    }

    // Neues Format: linien/{city}/{lineFolder}/*.json
    $subEntries = @scandir($cityPath);
    if (!$subEntries) {
        return false;
    }

    foreach ($subEntries as $sub) {
        if ($sub === '.' || $sub === '..' || $sub === 'backup' || $sub === 'gpx') continue;
        $subPath = $cityPath . '/' . $sub;
        if (!is_dir($subPath)) continue;
        $jsonFiles = glob($subPath . '/*.json');
        if (!empty($jsonFiles)) {
            return true;
        }
    }

    return false;
}

foreach ($entries as $entry) {
    if ($entry === "." || $entry === "..") continue;
    if ($entry === 'backup' || $entry === 'gpx') continue;

    $fullPath = $baseDir . "/" . $entry;

    if (is_dir($fullPath) && cityHasLineJson($fullPath)) {
        $cities[] = $entry;
    }
}

natcasesort($cities);
$cities = array_values($cities);

echo json_encode([
    "ok" => true,
    "cities" => $cities
]);