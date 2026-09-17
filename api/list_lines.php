<?php
error_reporting(0);
ini_set('display_errors', 0);
header('Content-Type: application/json; charset=utf-8');

$baseDir = dirname(__DIR__);
$linienBaseDir = $baseDir . '/linien';
$citySettingsFile = $baseDir . '/data/city_settings.json';

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
$cityDirs = [];

if ($requestedCity !== '') {
    $cityDir = $linienBaseDir . '/' . $requestedCity;
    if (is_dir($cityDir)) {
        $cities[] = $requestedCity;
        $cityDirs[$requestedCity] = $cityDir;
    } elseif (is_dir($linienBaseDir . '/linien/' . $requestedCity)) {
        $cities[] = $requestedCity;
        $cityDirs[$requestedCity] = $linienBaseDir . '/linien/' . $requestedCity;
    }
} else {
    $entries = scandir($linienBaseDir);
    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $fullPath = $linienBaseDir . '/' . $entry;
        if (is_dir($fullPath)) {
            if ($entry === 'linien') {
                foreach (@scandir($fullPath) ?: [] as $nestedCity) {
                    if ($nestedCity === '.' || $nestedCity === '..') continue;
                    $nestedPath = $fullPath . '/' . $nestedCity;
                    if (is_dir($nestedPath) && !isset($cityDirs[$nestedCity])) {
                        $cities[] = $nestedCity;
                        $cityDirs[$nestedCity] = $nestedPath;
                    }
                }
            } else {
                $cities[] = $entry;
                $cityDirs[$entry] = $fullPath;
            }
        }
    }
}

$lines = [];

foreach ($cities as $city) {
    $cityDir = $cityDirs[$city] ?? ($linienBaseDir . '/' . $city);
    $cityUrlBase = str_replace('\\', '/', substr($cityDir, strlen($baseDir) + 1));

    // ---- Neues Format: linien/{city}/{lineFolder}/*.json ----
    $entries = @scandir($cityDir);
    if ($entries) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === 'gpx' || $entry === 'backup') continue;
            $subPath = $cityDir . '/' . $entry;
            if (!is_dir($subPath)) continue;  // nur Unterordner (= lineFolders)

            $categoryEntries = @scandir($subPath);
            if ($categoryEntries) {
                foreach ($categoryEntries as $categoryEntry) {
                    if ($categoryEntry === '.' || $categoryEntry === '..' || $categoryEntry === 'gpx' || $categoryEntry === 'backup') continue;
                    $categoryPath = $subPath . '/' . $categoryEntry;
                    if (!is_dir($categoryPath)) continue;

                    $categoryFiles = glob($categoryPath . '/*.json');
                    foreach ($categoryFiles as $file) {
                        $content = file_get_contents($file);
                        $data    = json_decode($content, true);
                        if (!is_array($data)) continue;

                        $fileBase = pathinfo($file, PATHINFO_FILENAME);
                        $fileMtime = @filemtime($file);
                        $gpxPath  = $categoryPath . '/' . $fileBase . '.gpx';
                        $pdfPathCentral = $cityDir . '/pdf/' . buildPdfStorageFileName($entry . '_' . $categoryEntry, $fileBase);
                        $pdfPath  = $categoryPath . '/' . $fileBase . '.pdf';
                        $pdfPathGpx = $categoryPath . '/gpx/' . $fileBase . '.pdf';
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
                            'categoryFolder'    => $categoryEntry,
                            'file'              => basename($file),
                            'jsonPath'          => $cityUrlBase . '/' . $entry . '/' . $categoryEntry . '/' . basename($file),
                            'gpxPath'           => $hasGpx ? $cityUrlBase . '/' . $entry . '/' . $categoryEntry . '/' . $fileBase . '.gpx' : null,
                            'fileBase'          => $fileBase,
                            'id'                => $city . '/' . $entry . '/' . $categoryEntry . '/' . $fileBase,
                            'routeType'         => getOperationalRouteType($data),
                            'operationalName'   => getOperationalCatalogFields($data)['operationalName'],
                            'fromLabel'         => getOperationalCatalogFields($data)['fromLabel'],
                            'toLabel'           => getOperationalCatalogFields($data)['toLabel'],
                            'relatedRouteIds'   => getOperationalCatalogFields($data)['relatedRouteIds'],
                            'startCoordinate'   => getCatalogEndpoint($data, 'startCoordinate', true),
                            'endCoordinate'     => getCatalogEndpoint($data, 'endCoordinate', false),
                            'remark'            => getOperationalCatalogFields($data)['remark'],
                            'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
                            'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
                            'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
                            'variantName'       => getVariantNameForList($data),
                            'variantCategory'   => getVariantCategoryForList($data),
                            'description'       => $data['description'] ?? ($data['line']['description'] ?? ''),
                            'validFrom'         => $data['validFrom'] ?? ($data['line']['validFrom'] ?? ''),
                            'validUntil'        => $data['validUntil'] ?? ($data['line']['validUntil'] ?? ''),
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
                    'categoryFolder'    => null,
                    'file'              => basename($file),
                    'jsonPath'          => $cityUrlBase . '/' . $entry . '/' . basename($file),
                    'gpxPath'           => $hasGpx ? $cityUrlBase . '/' . $entry . '/' . $fileBase . '.gpx' : null,
                    'fileBase'          => $fileBase,
                    'id'                => $city . '/' . $entry . '/' . $fileBase,
                    'routeType'         => getOperationalRouteType($data),
                    'operationalName'   => getOperationalCatalogFields($data)['operationalName'],
                    'fromLabel'         => getOperationalCatalogFields($data)['fromLabel'],
                    'toLabel'           => getOperationalCatalogFields($data)['toLabel'],
                    'relatedRouteIds'   => getOperationalCatalogFields($data)['relatedRouteIds'],
                    'startCoordinate'   => getCatalogEndpoint($data, 'startCoordinate', true),
                    'endCoordinate'     => getCatalogEndpoint($data, 'endCoordinate', false),
                    'remark'            => getOperationalCatalogFields($data)['remark'],
                    'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
                    'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
                    'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
                    'variantName'       => getVariantNameForList($data),
                    'variantCategory'   => getVariantCategoryForList($data),
                    'description'       => $data['description'] ?? ($data['line']['description'] ?? ''),
                    'validFrom'         => $data['validFrom'] ?? ($data['line']['validFrom'] ?? ''),
                    'validUntil'        => $data['validUntil'] ?? ($data['line']['validUntil'] ?? ''),
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
            'categoryFolder'    => null,
            'file'              => basename($file),
            'jsonPath'          => $cityUrlBase . '/' . basename($file),
            'gpxPath'           => $hasGpx ? $cityUrlBase . '/gpx/' . $fileBase . '.gpx' : null,
            'fileBase'          => $fileBase,
            'id'                => $city . '/' . $fileBase,
            'routeType'         => getOperationalRouteType($data),
            'operationalName'   => getOperationalCatalogFields($data)['operationalName'],
            'fromLabel'         => getOperationalCatalogFields($data)['fromLabel'],
            'toLabel'           => getOperationalCatalogFields($data)['toLabel'],
            'relatedRouteIds'   => getOperationalCatalogFields($data)['relatedRouteIds'],
            'startCoordinate'   => getCatalogEndpoint($data, 'startCoordinate', true),
            'endCoordinate'     => getCatalogEndpoint($data, 'endCoordinate', false),
            'remark'            => getOperationalCatalogFields($data)['remark'],
            'lineName'          => $data['lineName'] ?? ($data['line']['lineName'] ?? ''),
            'routeName'         => $data['routeName'] ?? ($data['line']['routeName'] ?? ''),
            'directionName'     => $data['directionName'] ?? ($data['line']['directionName'] ?? ''),
            'variantName'       => getVariantNameForList($data),
            'variantCategory'   => getVariantCategoryForList($data),
            'description'       => $data['description'] ?? ($data['line']['description'] ?? ''),
            'validFrom'         => $data['validFrom'] ?? ($data['line']['validFrom'] ?? ''),
            'validUntil'        => $data['validUntil'] ?? ($data['line']['validUntil'] ?? ''),
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

function getOperationalValue(array $data, string $key, $fallback = null) {
    return $data[$key] ?? ($data['line'][$key] ?? $fallback);
}

function getOperationalRouteType(array $data): string {
    $type = strtolower(trim((string)getOperationalValue($data, 'routeType', 'line')));
    return in_array($type, ['line', 'pullout', 'pullin', 'transfer'], true) ? $type : 'line';
}

function normalizeCatalogCoordinate($point): ?array {
    if (!is_array($point)) return null;
    $lat = $point['lat'] ?? ($point[0] ?? null);
    $lon = $point['lon'] ?? ($point[1] ?? null);
    if (!is_numeric($lat) || !is_numeric($lon)) return null;
    return ['lat' => (float)$lat, 'lon' => (float)$lon];
}

function getCatalogEndpoint(array $data, string $explicitKey, bool $start): ?array {
    $explicit = normalizeCatalogCoordinate(getOperationalValue($data, $explicitKey));
    if ($explicit) return $explicit;
    $points = $data['routePoints'] ?? ($data['route']['original'] ?? []);
    if (!is_array($points) || count($points) === 0) return null;
    return normalizeCatalogCoordinate($start ? $points[0] : $points[count($points) - 1]);
}

function getOperationalCatalogFields(array $data): array {
    $related = getOperationalValue($data, 'relatedRouteIds', []);
    if (!is_array($related)) {
        $related = preg_split('/[;,\r\n]+/', (string)$related) ?: [];
    }
    $related = array_values(array_unique(array_filter(array_map(static function ($value): string {
        return trim((string)$value);
    }, $related))));
    return [
        'routeType' => getOperationalRouteType($data),
        'operationalName' => trim((string)getOperationalValue($data, 'operationalName', '')),
        'fromLabel' => trim((string)getOperationalValue($data, 'fromLabel', '')),
        'toLabel' => trim((string)getOperationalValue($data, 'toLabel', '')),
        'relatedRouteIds' => $related,
        'startCoordinate' => getCatalogEndpoint($data, 'startCoordinate', true),
        'endCoordinate' => getCatalogEndpoint($data, 'endCoordinate', false),
        'remark' => trim((string)getOperationalValue($data, 'remark', '')),
    ];
}

$citySettings = [];
if (is_file($citySettingsFile)) {
    $decodedCitySettings = json_decode((string)@file_get_contents($citySettingsFile), true);
    if (is_array($decodedCitySettings)) {
        $citySettings = $decodedCitySettings;
    }
}

foreach ($lines as &$line) {
    $cityKey = strtolower(trim((string)($line['city'] ?? '')));
    $setting = $citySettings[$cityKey] ?? [];
    $line['dispatchPhone'] = is_array($setting) ? trim((string)($setting['dispatchPhone'] ?? '')) : '';
}
unset($line);

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
