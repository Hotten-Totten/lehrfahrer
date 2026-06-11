<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

function collectJsonLinesForCity(string $cityDir, string $citySlug): array {
    $entries = @scandir($cityDir);
    $lines = [];

    if ($entries) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === 'gpx' || $entry === 'backup' || $entry === 'pdf') {
                continue;
            }
            $subPath = $cityDir . '/' . $entry;
            if (!is_dir($subPath)) {
                continue;
            }
            foreach (glob($subPath . '/*.json') as $jsonFile) {
                $lines[] = [
                    'city' => $citySlug,
                    'lineFolder' => $entry,
                    'jsonPath' => $jsonFile,
                    'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
                ];
            }
        }
    }

    foreach (glob($cityDir . '/*.json') as $jsonFile) {
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

$baseDir = dirname(__DIR__);
$linienBaseDir = $baseDir . '/linien';

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
    $cityDir = $linienBaseDir . '/' . $requestedCity;
    if (is_dir($cityDir)) {
        $cities[] = $requestedCity;
    }
} else {
    foreach (scandir($linienBaseDir) as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        if (is_dir($linienBaseDir . '/' . $entry)) {
            $cities[] = $entry;
        }
    }
}

$totalLines = 0;
$modifiedLineCount = 0;
$modifiedStopCount = 0;
$errors = [];

foreach ($cities as $citySlug) {
    $cityDir = $linienBaseDir . '/' . $citySlug;
    $lineEntries = collectJsonLinesForCity($cityDir, $citySlug);

    foreach ($lineEntries as $entry) {
        $totalLines++;

        $jsonRaw = @file_get_contents($entry['jsonPath']);
        $lineData = $jsonRaw ? @json_decode($jsonRaw, true) : null;

        if (!is_array($lineData)) {
            $errors[] = [
                'file' => $entry['jsonPath'],
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
                'file' => $entry['jsonPath'],
                'error' => 'JSON-Encoding fehlgeschlagen'
            ];
            continue;
        }

        if (@file_put_contents($entry['jsonPath'], $encoded) === false) {
            $errors[] = [
                'file' => $entry['jsonPath'],
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
