<?php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/_tenant_route_storage.php';
$companyId = lehrfahrer_route_authorize('routes.read');

$baseDir = lehrfahrer_tenant_area($companyId, 'cities');

$entries = lehrfahrer_route_safe_entries($baseDir);
$cities = [];
$includeEmpty = (($_GET['includeEmpty'] ?? '0') === '1');

function cityHasLineJson(string $cityPath): bool {
    // Altes Format: linien/{city}/*.json
    $directJson = array_filter(glob($cityPath . '/*.json') ?: [], static fn($file) => !is_link($file));
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
        if (is_link($subPath) || !is_dir($subPath)) continue;
        $jsonFiles = array_filter(glob($subPath . '/*.json') ?: [], static fn($file) => !is_link($file));
        if (!empty($jsonFiles)) {
            return true;
        }
        $categoryEntries = @scandir($subPath);
        if (!$categoryEntries) continue;
        foreach ($categoryEntries as $category) {
            if ($category === '.' || $category === '..' || $category === 'backup' || $category === 'gpx' || $category === 'pdf') continue;
            $categoryPath = $subPath . '/' . $category;
            if (!is_link($categoryPath) && is_dir($categoryPath)
                && !empty(array_filter(glob($categoryPath . '/*.json') ?: [], static fn($file) => !is_link($file)))) {
                return true;
            }
        }
    }

    return false;
}

foreach ($entries as $entry) {
    if ($entry === "." || $entry === "..") continue;
    if ($entry === 'backup' || $entry === 'gpx') continue;

    $fullPath = lehrfahrer_route_city_path($companyId, $entry);

    if (!is_dir($fullPath)) continue;

    if ($includeEmpty || cityHasLineJson(lehrfahrer_route_line_city_path($companyId, $entry))) {
        $cities[] = $entry;
    }
}

natcasesort($cities);
$cities = array_values($cities);

echo json_encode([
    "ok" => true,
    "cities" => $cities
]);
