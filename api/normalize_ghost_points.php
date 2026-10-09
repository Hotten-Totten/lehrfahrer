<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';
$companyId = lehrfahrer_route_authorize('routes.maintain', true, true);

function collectJsonLinesForCity(string $cityDir, string $citySlug): array {
    $entries = lehrfahrer_route_safe_entries($cityDir);
    $lines = [];

    if ($entries) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === 'gpx' || $entry === 'backup' || $entry === 'pdf') {
                continue;
            }
            $subPath = $cityDir . '/' . $entry;
            if (is_link($subPath) || !is_dir($subPath)) {
                continue;
            }
            foreach (glob($subPath . '/*.json') as $jsonFile) {
                if (is_link($jsonFile)) continue;
                $lines[] = [
                    'city' => $citySlug,
                    'lineFolder' => $entry,
                    'jsonPath' => $jsonFile,
                    'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
                ];
            }
            foreach (lehrfahrer_route_safe_entries($subPath) as $categoryEntry) {
                $categoryPath = $subPath . '/' . $categoryEntry;
                if (is_link($categoryPath) || !is_dir($categoryPath)) continue;
                foreach (glob($categoryPath . '/*.json') as $jsonFile) {
                    if (is_link($jsonFile)) continue;
                    $lines[] = [
                        'city' => $citySlug,
                        'lineFolder' => $entry,
                        'categoryFolder' => $categoryEntry,
                        'jsonPath' => $jsonFile,
                        'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
                    ];
                }
            }
        }
    }

    foreach (glob($cityDir . '/*.json') as $jsonFile) {
        if (is_link($jsonFile)) continue;
        $lines[] = [
            'city' => $citySlug,
            'lineFolder' => '',
            'jsonPath' => $jsonFile,
            'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
        ];
    }

    return $lines;
}

function isLegacyFreeGhostStop(array $stop): bool {
    $sourceType = (string)($stop['sourceType'] ?? '');
    $name = trim((string)($stop['name'] ?? ''));

    if ($sourceType !== 'free') {
        return false;
    }

    return (bool)preg_match('/^Freie Haltestelle\s+\d+$/i', $name);
}

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '{}', true);
if (!is_array($input)) {
    $input = [];
}

$requestedCity = strtolower(trim((string)($input['city'] ?? '')));
$requestedCity = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $requestedCity);

$linienBaseDir = lehrfahrer_tenant_area($companyId, 'lines');
$citiesBaseDir = lehrfahrer_tenant_area($companyId, 'cities');

if (!is_dir($linienBaseDir)) {
    echo json_encode([
        'ok' => true,
        'totalLines' => 0,
        'modifiedLineCount' => 0,
        'modifiedStopCount' => 0,
        'cityScope' => $requestedCity ?: 'alle',
        'errors' => []
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$cities = [];
if ($requestedCity !== '') {
    if (lehrfahrer_route_city_exists($companyId, $requestedCity)) {
        $cities[] = $requestedCity;
    } else {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Ort nicht gefunden']);
        exit;
    }
} else {
    foreach (lehrfahrer_route_safe_entries($citiesBaseDir) as $entry) {
        if (lehrfahrer_route_city_exists($companyId, $entry)) {
            $cities[] = $entry;
        }
    }
}

$totalLines = 0;
$modifiedLineCount = 0;
$modifiedStopCount = 0;
$errors = [];

foreach ($cities as $citySlug) {
    $cityDir = lehrfahrer_route_line_city_path($companyId, $citySlug);
    $lineEntries = collectJsonLinesForCity($cityDir, $citySlug);

    foreach ($lineEntries as $entry) {
        $totalLines++;

        $jsonRaw = @file_get_contents($entry['jsonPath']);
        $lineData = $jsonRaw ? @json_decode($jsonRaw, true) : null;

        if (!is_array($lineData)) {
            $errors[] = [
                'file' => basename($entry['jsonPath']),
                'error' => 'JSON ungueltig'
            ];
            continue;
        }

        if (!isset($lineData['stops']) || !is_array($lineData['stops'])) {
            continue;
        }

        $lineChanged = false;
        foreach ($lineData['stops'] as $idx => $stop) {
            if (!is_array($stop)) {
                continue;
            }

            $isGhost = !empty($stop['isGhostPoint']) || !empty($stop['isGhost']) || (($stop['sourceType'] ?? '') === 'ghost');
            if ($isGhost) {
                continue;
            }

            if (!isLegacyFreeGhostStop($stop)) {
                continue;
            }

            $lineData['stops'][$idx]['isGhostPoint'] = true;
            $lineData['stops'][$idx]['isGhost'] = true;
            $modifiedStopCount++;
            $lineChanged = true;
        }

        if (!$lineChanged) {
            continue;
        }

        $encoded = json_encode(
            $lineData,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        if ($encoded === false) {
            $errors[] = [
                'file' => basename($entry['jsonPath']),
                'error' => 'JSON-Encoding fehlgeschlagen'
            ];
            continue;
        }

        $checkedJsonPath = lehrfahrer_route_checked_path($companyId, $entry['jsonPath']);
        if (@file_put_contents($checkedJsonPath, $encoded) === false) {
            $errors[] = [
                'file' => basename($entry['jsonPath']),
                'error' => 'Datei konnte nicht geschrieben werden'
            ];
            continue;
        }

        $modifiedLineCount++;
    }
}

echo json_encode([
    'ok' => true,
    'totalLines' => $totalLines,
    'modifiedLineCount' => $modifiedLineCount,
    'modifiedStopCount' => $modifiedStopCount,
    'cityScope' => $requestedCity ?: 'alle',
    'errors' => array_slice($errors, 0, 50)
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
