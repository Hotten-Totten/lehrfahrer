<?php
header("Content-Type: application/json; charset=utf-8");

$baseDir = __DIR__ . "/../linien";

if (!is_dir($baseDir)) {
    mkdir($baseDir, 0775, true);
}

$entries = scandir($baseDir);
$cities = [];
$includeEmpty = (($_GET['includeEmpty'] ?? '0') === '1');

function cityHasLineJson(string $cityPath): bool {
    // Altes Format: linien/{city}/*.json
    $directJson = glob($cityPath . '/*.json');
    if (!empty($directJson)) {
        return true;
    }

    // Zwischenformat: linien/{city}/{lineFolder}/*.json
    // Neues Format:     linien/{city}/{lineFolder}/{categoryFolder}/*.json
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
        $categoryEntries = @scandir($subPath);
        if (!$categoryEntries) continue;
        foreach ($categoryEntries as $category) {
            if ($category === '.' || $category === '..' || $category === 'backup' || $category === 'gpx' || $category === 'pdf') continue;
            $categoryPath = $subPath . '/' . $category;
            if (is_dir($categoryPath) && !empty(glob($categoryPath . '/*.json'))) {
                return true;
            }
        }
    }

    return false;
}

foreach ($entries as $entry) {
    if ($entry === "." || $entry === "..") continue;
    if ($entry === 'backup' || $entry === 'gpx') continue;

    $fullPath = $baseDir . "/" . $entry;

    if (!is_dir($fullPath)) continue;

    // Lesefallback für versehentlich doppelt angelegte Struktur linien/linien/{city}.
    if ($entry === 'linien') {
        foreach (@scandir($fullPath) ?: [] as $nestedCity) {
            if ($nestedCity === '.' || $nestedCity === '..') continue;
            $nestedCityPath = $fullPath . '/' . $nestedCity;
            if (is_dir($nestedCityPath) && ($includeEmpty || cityHasLineJson($nestedCityPath))) {
                $cities[] = $nestedCity;
            }
        }
        continue;
    }

    if ($includeEmpty || cityHasLineJson($fullPath)) {
        $cities[] = $entry;
    }
}

natcasesort($cities);
$cities = array_values($cities);

echo json_encode([
    "ok" => true,
    "cities" => $cities
]);
