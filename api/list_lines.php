<?php
error_reporting(0);
ini_set('display_errors', 0);
header('Content-Type: application/json; charset=utf-8');

$baseDir = dirname(__DIR__);
$linienBaseDir = $baseDir . '/linien';

if (!is_dir($linienBaseDir)) {
    echo json_encode([
        'ok' => true,
        'lines' => []
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$requestedCity = trim($_GET['city'] ?? '');
$requestedCity = strtolower($requestedCity);
$requestedCity = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $requestedCity);

$cities = [];

if ($requestedCity !== '') {
    $cityDir = $linienBaseDir . '/' . $requestedCity;
    if (is_dir($cityDir)) {
        $cities[] = $requestedCity;
    }
} else {
    $entries = scandir($linienBaseDir);
    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $fullPath = $linienBaseDir . '/' . $entry;
        if (is_dir($fullPath)) {
            $cities[] = $entry;
        }
    }
}

$lines = [];

foreach ($cities as $city) {
    $cityDir = $linienBaseDir . '/' . $city;

    // ---- Neues Format: linien/{city}/{lineFolder}/*.json ----
    $entries = @scandir($cityDir);
    if ($entries) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === 'gpx' || $entry === 'backup') continue;
            $subPath = $cityDir . '/' . $entry;
            if (!is_dir($subPath)) continue;  // nur Unterordner (= lineFolders)

            $files = glob($subPath . '/*.json');
            foreach ($files as $file) {
                $content = file_get_contents($file);
                $data    = json_decode($content, true);
                if (!is_array($data)) continue;

                $fileBase = pathinfo($file, PATHINFO_FILENAME);
                $gpxPath  = $subPath . '/' . $fileBase . '.gpx';
                $hasGpx   = file_exists($gpxPath);

                $lines[] = [
                    'city'              => $city,
                    'lineFolder'        => $entry,
                    'file'              => basename($file),
                    'fileBase'          => $fileBase,
                    'id'                => $data['id'] ?? $fileBase,
                    'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
                    'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
                    'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
                    'color'             => $data['color'] ?? ($data['line']['color'] ?? null),
                    'savedAt'           => $data['savedAt'] ?? null,
                    'stopCount'         => count($data['stops'] ?? []),
                    'routePointCount'   => count($data['routePoints'] ?? []),
                    'routeLengthMeters' => $data['stats']['routeLengthMeters'] ?? null,
                    'hasGpx'            => $hasGpx,
                ];
            }
        }
    }

    // ---- Altes Format (Rückwärtskompatibel): linien/{city}/*.json ----
    $oldFiles = glob($cityDir . '/*.json');
    foreach ($oldFiles as $file) {
        $content = file_get_contents($file);
        $data    = json_decode($content, true);
        if (!is_array($data)) continue;

        $fileBase = pathinfo($file, PATHINFO_FILENAME);
        $gpxPath  = $cityDir . '/gpx/' . $fileBase . '.gpx';
        $hasGpx   = file_exists($gpxPath);

        $lines[] = [
            'city'              => $city,
            'lineFolder'        => null,  // altes Format – kein Unterordner
            'file'              => basename($file),
            'fileBase'          => $fileBase,
            'id'                => $data['id'] ?? $fileBase,
            'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
            'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
            'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
            'color'             => $data['color'] ?? ($data['line']['color'] ?? null),
            'savedAt'           => $data['savedAt'] ?? null,
            'stopCount'         => count($data['stops'] ?? []),
            'routePointCount'   => count($data['routePoints'] ?? []),
            'routeLengthMeters' => $data['stats']['routeLengthMeters'] ?? null,
            'hasGpx'            => $hasGpx,
        ];
    }
}

usort($lines, function ($a, $b) {
    $cityCompare = strcmp($a['city'] ?? '', $b['city'] ?? '');
    if ($cityCompare !== 0) {
        return $cityCompare;
    }

    return strcmp($a['fileBase'] ?? '', $b['fileBase'] ?? '');
});

echo json_encode([
    'ok' => true,
    'lines' => $lines
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);