<?php
error_reporting(0);
ini_set('display_errors', 0);
header('Content-Type: application/json; charset=utf-8');

$baseDir = dirname(__DIR__);
$linienBaseDir = $baseDir . '/linien';

function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

function buildPdfStorageFileName(string $lineFolder, string $fileBase): string {
    $prefix = trim(sanitizeForFilesystem($lineFolder));
    $base = trim(sanitizeForFilesystem($fileBase));
    if ($base === '') {
        $base = 'linie';
    }
    if ($prefix !== '') {
        return $prefix . '__' . $base . '.pdf';
    }
    return $base . '.pdf';
}

function getLineValue(array $data, string $key, string $fallback = ''): string {
    $value = $data[$key] ?? ($data['line'][$key] ?? $fallback);
    return trim((string)$value);
}

function getVariantNameForList(array $data): string {
    $variantName = getLineValue($data, 'variantName', '');
    if ($variantName !== '') {
        return $variantName;
    }

    $parts = [];
    $routeName = getLineValue($data, 'routeName', '');
    $directionName = getLineValue($data, 'directionName', '');
    if ($routeName !== '') $parts[] = $routeName;
    if ($directionName !== '') $parts[] = $directionName;
    return $parts ? implode(' - ', $parts) : 'Standard';
}

function getVariantCategoryForList(array $data): string {
    $category = getLineValue($data, 'variantCategory', '');
    return $category !== '' ? $category : 'Standard';
}

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
                $fileMtime = @filemtime($file);
                $gpxPath  = $subPath . '/' . $fileBase . '.gpx';
                $pdfPathCentral = $cityDir . '/pdf/' . buildPdfStorageFileName($entry, $fileBase);
                $pdfPath  = $subPath . '/' . $fileBase . '.pdf';
                $pdfPathGpx = $subPath . '/gpx/' . $fileBase . '.pdf';
                $hasGpx   = file_exists($gpxPath);
                $hasPdf   = file_exists($pdfPathCentral) || file_exists($pdfPath) || file_exists($pdfPathGpx);
                $pdfFileName = null;
                if (file_exists($pdfPathCentral)) {
                    $pdfFileName = basename($pdfPathCentral);
                } elseif (file_exists($pdfPath)) {
                    $pdfFileName = basename($pdfPath);
                } elseif (file_exists($pdfPathGpx)) {
                    $pdfFileName = basename($pdfPathGpx);
                }

                $lines[] = [
                    'city'              => $city,
                    'lineFolder'        => $entry,
                    'file'              => basename($file),
                    'fileBase'          => $fileBase,
                    'id'                => $data['id'] ?? $fileBase,
                    'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
                    'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
                    'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
                    'variantName'       => getVariantNameForList($data),
                    'variantCategory'   => getVariantCategoryForList($data),
                    'description'       => $data['description'] ?? ($data['line']['description'] ?? ''),
                    'color'             => $data['color'] ?? ($data['line']['color'] ?? null),
                    'savedAt'           => $data['savedAt'] ?? null,
                    'updatedAt'         => $fileMtime ? intval($fileMtime) : null,
                    'stopCount'         => count($data['stops'] ?? []),
                    'routePointCount'   => count($data['routePoints'] ?? []),
                    'routeLengthMeters' => $data['stats']['routeLengthMeters'] ?? null,
                    'hasGpx'            => $hasGpx,
                    'hasPdf'            => $hasPdf,
                    'pdfFile'           => $pdfFileName,
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
        $fileMtime = @filemtime($file);
        $gpxPath  = $cityDir . '/gpx/' . $fileBase . '.gpx';
        $pdfPathCentral = $cityDir . '/pdf/' . buildPdfStorageFileName('', $fileBase);
        $pdfPath  = $cityDir . '/' . $fileBase . '.pdf';
        $pdfPathGpx = $cityDir . '/gpx/' . $fileBase . '.pdf';
        $hasGpx   = file_exists($gpxPath);
        $hasPdf   = file_exists($pdfPathCentral) || file_exists($pdfPath) || file_exists($pdfPathGpx);
        $pdfFileName = null;
        if (file_exists($pdfPathCentral)) {
            $pdfFileName = basename($pdfPathCentral);
        } elseif (file_exists($pdfPath)) {
            $pdfFileName = basename($pdfPath);
        } elseif (file_exists($pdfPathGpx)) {
            $pdfFileName = basename($pdfPathGpx);
        }

        $lines[] = [
            'city'              => $city,
            'lineFolder'        => null,  // altes Format – kein Unterordner
            'file'              => basename($file),
            'fileBase'          => $fileBase,
            'id'                => $data['id'] ?? $fileBase,
            'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
            'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
            'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
            'variantName'       => getVariantNameForList($data),
            'variantCategory'   => getVariantCategoryForList($data),
            'description'       => $data['description'] ?? ($data['line']['description'] ?? ''),
            'color'             => $data['color'] ?? ($data['line']['color'] ?? null),
            'savedAt'           => $data['savedAt'] ?? null,
            'updatedAt'         => $fileMtime ? intval($fileMtime) : null,
            'stopCount'         => count($data['stops'] ?? []),
            'routePointCount'   => count($data['routePoints'] ?? []),
            'routeLengthMeters' => $data['stats']['routeLengthMeters'] ?? null,
            'hasGpx'            => $hasGpx,
            'hasPdf'            => $hasPdf,
            'pdfFile'           => $pdfFileName,
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
