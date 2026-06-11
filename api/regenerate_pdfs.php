<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

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

function getLineValue(array $data, string $key, $default = '') {
    if (array_key_exists($key, $data)) {
        return $data[$key];
    }
    if (isset($data['line']) && is_array($data['line']) && array_key_exists($key, $data['line'])) {
        return $data['line'][$key];
    }
    return $default;
}

function extractLatLon($point): ?array {
    if (is_array($point)) {
        if (isset($point['lat']) && isset($point['lon'])) {
            return [floatval($point['lat']), floatval($point['lon'])];
        }
        if (isset($point[0]) && isset($point[1])) {
            return [floatval($point[0]), floatval($point[1])];
        }
    }
    return null;
}

function haversineMeters(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $r = 6371000.0;
    $phi1 = deg2rad($lat1);
    $phi2 = deg2rad($lat2);
    $dPhi = deg2rad($lat2 - $lat1);
    $dLambda = deg2rad($lon2 - $lon1);

    $a = sin($dPhi / 2) * sin($dPhi / 2)
       + cos($phi1) * cos($phi2) * sin($dLambda / 2) * sin($dLambda / 2);
    $c = 2 * atan2(sqrt($a), sqrt(max(1 - $a, 0.0)));

    return $r * $c;
}

function estimateRouteLengthMeters(array $routePoints): float {
    $sum = 0.0;
    $last = null;

    foreach ($routePoints as $pt) {
        $current = extractLatLon($pt);
        if (!$current) {
            continue;
        }
        if ($last) {
            $sum += haversineMeters($last[0], $last[1], $current[0], $current[1]);
        }
        $last = $current;
    }

    return $sum;
}

function wrapPdfLine(string $line, int $maxLen = 94): array {
    $line = trim(preg_replace('/\s+/', ' ', str_replace(["\r", "\n", "\t"], ' ', $line)));
    if ($line === '') {
        return [''];
    }

    $wrapped = wordwrap($line, $maxLen, "\n", true);
    return explode("\n", $wrapped);
}

function pdfEscapeText(string $text): string {
    $converted = strtr($text, [
        'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue',
        'Ä' => 'Ae', 'Ö' => 'Oe', 'Ü' => 'Ue',
        'ß' => 'ss',
        '–' => '-', '—' => '-',
        '„' => '"', '“' => '"', '‚' => "'", '’' => "'",
        '°' => ' Grad '
    ]);
    $converted = preg_replace('/[^\x20-\x7E]/', '?', $converted);

    return str_replace(
        ['\\', '(', ')'],
        ['\\\\', '\\(', '\\)'],
        $converted
    );
}

function buildSimplePdf(array $pages): string {
    $objects = [];
    $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    $objects[2] = '';
    $objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    $nextId = 4;
    $pageRefs = [];

    foreach ($pages as $lines) {
        $stream = "BT\n/F1 10 Tf\n14 TL\n50 800 Td\n";
        foreach ($lines as $line) {
            $stream .= '(' . pdfEscapeText($line) . ") Tj\nT*\n";
        }
        $stream .= "ET";

        $contentId = $nextId++;
        $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";

        $pageId = $nextId++;
        $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {$contentId} 0 R >>";
        $pageRefs[] = $pageId;
    }

    if (!$pageRefs) {
        $stream = "BT\n/F1 10 Tf\n14 TL\n50 800 Td\n(Keine Inhalte) Tj\nT*\nET";
        $contentId = $nextId++;
        $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";
        $pageId = $nextId++;
        $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {$contentId} 0 R >>";
        $pageRefs[] = $pageId;
    }

    $kidRefs = [];
    foreach ($pageRefs as $id) {
        $kidRefs[] = $id . ' 0 R';
    }
    $kids = implode(' ', $kidRefs);
    $objects[2] = "<< /Type /Pages /Kids [ {$kids} ] /Count " . count($pageRefs) . " >>";

    $pdf = "%PDF-1.4\n";
    $offsets = [0];

    for ($i = 1; $i < $nextId; $i++) {
        $offsets[$i] = strlen($pdf);
        $obj = $objects[$i] ?? '';
        $pdf .= $i . " 0 obj\n" . $obj . "\nendobj\n";
    }

    $xrefPos = strlen($pdf);
    $pdf .= "xref\n0 {$nextId}\n";
    $pdf .= "0000000000 65535 f \n";
    for ($i = 1; $i < $nextId; $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }

    $pdf .= "trailer\n<< /Size {$nextId} /Root 1 0 R >>\n";
    $pdf .= "startxref\n{$xrefPos}\n%%EOF";

    return $pdf;
}

function buildLineOverviewPdf(array $data, string $city, string $lineFolder): string {
    $lineName = trim((string)getLineValue($data, 'lineName', ''));
    $routeName = trim((string)getLineValue($data, 'routeName', ''));
    $directionName = trim((string)getLineValue($data, 'directionName', ''));
    $color = trim((string)getLineValue($data, 'color', ''));
    $savedAt = trim((string)($data['savedAt'] ?? date('c')));
    $fileBase = trim((string)($data['fileBase'] ?? getLineValue($data, 'id', 'linie')));

    $stops = is_array($data['stops'] ?? null) ? $data['stops'] : [];
    $routePoints = is_array($data['routePoints'] ?? null) ? $data['routePoints'] : [];

    $routeLengthMeters = null;
    if (isset($data['stats']) && is_array($data['stats']) && isset($data['stats']['routeLengthMeters'])) {
        $routeLengthMeters = floatval($data['stats']['routeLengthMeters']);
    }
    if (!$routeLengthMeters && !empty($routePoints)) {
        $routeLengthMeters = estimateRouteLengthMeters($routePoints);
    }

    $lines = [];
    $lines[] = 'Lehrfahrer Linienuebersicht';
    $lines[] = '----------------------------------------';
    $lines[] = 'Stand: ' . date('d.m.Y H:i:s', strtotime($savedAt));
    $lines[] = '';
    $lines[] = 'Ort: ' . $city;
    $lines[] = 'Linienordner: ' . $lineFolder;
    $lines[] = 'Datei: ' . $fileBase;
    $lines[] = 'Linie: ' . ($lineName !== '' ? $lineName : '-');
    $lines[] = 'Route: ' . ($routeName !== '' ? $routeName : '-');
    $lines[] = 'Richtung: ' . ($directionName !== '' ? $directionName : '-');
    $lines[] = 'Farbe: ' . ($color !== '' ? $color : '-');
    $lines[] = 'Haltestellen: ' . count($stops);
    $lines[] = 'Routenpunkte: ' . count($routePoints);
    $lines[] = 'Linienlaenge: ' . ($routeLengthMeters ? number_format($routeLengthMeters / 1000, 2, ',', '.') . ' km' : '-');
    $lines[] = '';
    $lines[] = 'Haltestellenliste';
    $lines[] = '----------------------------------------';

    if (!$stops) {
        $lines[] = 'Keine Haltestellen vorhanden.';
    } else {
        foreach ($stops as $idx => $stop) {
            $name = trim((string)($stop['name'] ?? ('Haltestelle ' . ($idx + 1))));
            $minute = isset($stop['minuteFromStart']) ? (string)intval($stop['minuteFromStart']) : '0';
            $source = trim((string)($stop['sourceType'] ?? ''));
            $lat = isset($stop['lat']) ? number_format(floatval($stop['lat']), 6, '.', '') : '-';
            $lon = isset($stop['lon']) ? number_format(floatval($stop['lon']), 6, '.', '') : '-';

            $lines[] = ($idx + 1) . '. ' . $name;
            $lines[] = 'Minute: ' . $minute . ' | Typ: ' . ($source !== '' ? $source : '-') . ' | Position: ' . $lat . ', ' . $lon;
        }
    }

    $wrappedLines = [];
    foreach ($lines as $line) {
        foreach (wrapPdfLine($line) as $chunk) {
            $wrappedLines[] = $chunk;
        }
    }

    $maxLinesPerPage = 48;
    $pages = [];
    while (!empty($wrappedLines)) {
        $pages[] = array_splice($wrappedLines, 0, $maxLinesPerPage);
    }

    return buildSimplePdf($pages);
}

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
        'generatedCount' => 0,
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
        if ($entry === '.' || $entry === '..') continue;
        if (is_dir($linienBaseDir . '/' . $entry)) {
            $cities[] = $entry;
        }
    }
}

$totalLines = 0;
$generatedCount = 0;
$errors = [];

foreach ($cities as $citySlug) {
    $cityDir = $linienBaseDir . '/' . $citySlug;
    $cityPdfDir = $cityDir . '/pdf';
    if (!is_dir($cityPdfDir)) {
        @mkdir($cityPdfDir, 0775, true);
    }

    $lineEntries = collectJsonLinesForCity($cityDir, $citySlug);

    foreach ($lineEntries as $entry) {
        $totalLines++;

        $jsonRaw = @file_get_contents($entry['jsonPath']);
        $lineData = $jsonRaw ? @json_decode($jsonRaw, true) : null;

        if (!is_array($lineData)) {
            $errors[] = [
                'file' => $entry['jsonPath'],
                'error' => 'JSON ungültig'
            ];
            continue;
        }

        if (!isset($lineData['savedAt'])) {
            $lineData['savedAt'] = date('c');
        }

        $pdfFile = buildPdfStorageFileName($entry['lineFolder'], $entry['fileBase']);
        $targetPdfPath = $cityPdfDir . '/' . $pdfFile;

        try {
            $pdfBinary = buildLineOverviewPdf($lineData, $citySlug, $entry['lineFolder'] ?: '-');
            $writeOk = @file_put_contents($targetPdfPath, $pdfBinary);
            clearstatcache(true, $targetPdfPath);
            if ($writeOk === false || !is_file($targetPdfPath) || filesize($targetPdfPath) <= 0) {
                $errors[] = [
                    'file' => $entry['jsonPath'],
                    'error' => 'PDF konnte nicht gespeichert werden',
                    'target' => $targetPdfPath
                ];
                continue;
            }

            $generatedCount++;
        } catch (Throwable $err) {
            $errors[] = [
                'file' => $entry['jsonPath'],
                'error' => $err->getMessage(),
                'target' => $targetPdfPath
            ];
        }
    }
}

echo json_encode([
    'ok' => true,
    'totalLines' => $totalLines,
    'generatedCount' => $generatedCount,
    'cityScope' => $requestedCity ?: 'alle',
    'errors' => array_slice($errors, 0, 50)
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
