<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_professional_pdf.php';
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
    $objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    $objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';

    $nextId = 6;
    $pageRefs = [];

    $pageCount = count($pages);
    foreach ($pages as $pageIndex => $lines) {
        $stream = '';
        $y = 800;
        foreach ($lines as $line) {
            if (preg_match('/^[-=]{10,}$/', $line)) {
                $stream .= "0.7 w\n50 {$y} m\n545 {$y} l\nS\n";
                $y -= 10;
                continue;
            }
            if ($line === '') {
                $y -= 10;
                continue;
            }
            $isTitle = $line === 'Lehrfahrer';
            $isHeading = in_array($line, ['Besonderheiten', 'Haltestellen', 'Nachweis der Streckeneinweisung'], true);
            $isTable = str_contains($line, ' | ');
            $font = $isTitle || $isHeading ? 'F2' : ($isTable ? 'F3' : 'F1');
            $size = $isTitle ? 18 : ($isHeading ? 13 : ($isTable ? 9 : 10));
            $step = $isTitle ? 26 : ($isHeading ? 20 : 14);
            $stream .= "BT\n/{$font} {$size} Tf\n50 {$y} Td\n(" . pdfEscapeText($line) . ") Tj\nET\n";
            $y -= $step;
        }
        $footer = 'Lehrfahrer | Seite ' . ($pageIndex + 1) . ' von ' . $pageCount;
        $stream .= "BT\n/F1 9 Tf\n50 28 Td\n(" . pdfEscapeText($footer) . ") Tj\nET";

        $contentId = $nextId++;
        $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";

        $pageId = $nextId++;
        $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {$contentId} 0 R >>";
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

function getPdfStopInstruction(array $stop): string {
    $directKeys = [
        'nextDrivingInstruction',
        'nextInstruction',
        'drivingInstruction',
        'instruction',
        'turnInstruction',
        'routeInstruction',
        'drivingHint',
        'nextManeuver',
        'nextManoeuvre'
    ];
    foreach ($directKeys as $key) {
        $value = $stop[$key] ?? null;
        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }
    }

    foreach (['maneuver', 'manoeuvre', 'nextManeuver', 'nextManoeuvre', 'navigation'] as $containerKey) {
        $container = $stop[$containerKey] ?? null;
        if (!is_array($container)) continue;
        foreach (['instruction', 'text', 'description', 'name', 'type', 'modifier'] as $key) {
            $value = $container[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }
    }
    return '-';
}

function isPdfTechnicalStop(array $stop): bool {
    foreach (['isGhostPoint', 'isGhost', 'ghost', 'synthetic', 'manual', 'isRoutePoint', 'isGuidePoint'] as $flag) {
        if (!empty($stop[$flag])) return true;
    }
    $technicalValues = ['ghost', 'synthetic', 'manual', 'routepoint', 'route_point', 'guidepoint', 'guide_point', 'geometry', 'passthrough', 'passthroughstop'];
    foreach (['sourceType', 'type', 'stopType', 'kind', 'detourRole'] as $field) {
        $value = strtolower(trim((string)($stop[$field] ?? '')));
        if (in_array($value, $technicalValues, true)) return true;
    }
    return false;
}

function pdfStopQuality(array $stop): int {
    $score = 0;
    $source = strtolower(trim((string)($stop['sourceType'] ?? '')));
    $type = strtolower(trim((string)($stop['type'] ?? ($stop['stopType'] ?? ''))));
    if (in_array($source, ['catalog', 'import', 'gtfs', 'hafas'], true)) $score += 4;
    if (!empty($stop['catalogId']) || !empty($stop['stopId'])) $score += 3;
    if (in_array($type, ['bus', 'tram', 'bus_tram', 'station', 'stop'], true)) $score += 2;
    elseif ($type === 'catalog') $score += 1;
    if (!empty($stop['isTimingPoint'])) $score += 1;
    return $score;
}

function normalizePdfStopName(string $name): string {
    $name = strtr($name, ['Ä' => 'ae', 'Ö' => 'oe', 'Ü' => 'ue', 'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    return strtolower(trim(preg_replace('/[^a-z0-9]+/i', ' ', $name)));
}

function getPdfRealStops(array $stops): array {
    $result = [];
    foreach ($stops as $stop) {
        if (!is_array($stop) || isPdfTechnicalStop($stop)) continue;
        $nameKey = normalizePdfStopName((string)($stop['name'] ?? ''));
        if ($nameKey === '') continue;
        $lastIndex = count($result) - 1;
        if ($lastIndex >= 0 && normalizePdfStopName((string)($result[$lastIndex]['name'] ?? '')) === $nameKey) {
            if (pdfStopQuality($stop) > pdfStopQuality($result[$lastIndex])) {
                $result[$lastIndex] = $stop;
            }
            continue;
        }
        $result[] = $stop;
    }
    return $result;
}

function buildLineOverviewPdf(array $data, string $city, string $lineFolder): string {
    $lineName = trim((string)getLineValue($data, 'lineName', ''));
    $routeName = trim((string)getLineValue($data, 'routeName', ''));
    $directionName = trim((string)getLineValue($data, 'directionName', ''));
    $variantName = trim((string)getLineValue($data, 'variantName', ''));
    $variantCategory = trim((string)getLineValue($data, 'variantCategory', ''));
    $description = trim((string)getLineValue($data, 'description', ''));
    $validFrom = trim((string)getLineValue($data, 'validFrom', ''));
    $validUntil = trim((string)getLineValue($data, 'validUntil', ''));
    $savedAt = trim((string)($data['savedAt'] ?? date('c')));
    $stops = is_array($data['stops'] ?? null) ? $data['stops'] : [];

    $formatDate = static function (string $value): string {
        $date = DateTime::createFromFormat('!Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $date->format('d.m.Y') : '';
    };
    $fromText = $formatDate($validFrom);
    $untilText = $formatDate($validUntil);
    if ($fromText !== '' && $untilText !== '') {
        $validityText = 'Gueltig: ' . $fromText . ' bis ' . $untilText;
    } elseif ($fromText !== '') {
        $validityText = 'Gueltig ab: ' . $fromText;
    } elseif ($untilText !== '') {
        $validityText = 'Gueltig bis: ' . $untilText;
    } else {
        $validityText = 'Immer gueltig';
    }

    $realStops = getPdfRealStops($stops);

    $professionalStops = [];
    foreach ($realStops as $idx => $stop) {
        $professionalStops[] = [
            'number' => $idx + 1,
            'name' => trim((string)($stop['name'] ?? ('Haltestelle ' . ($idx + 1)))),
            'instruction' => getPdfStopInstruction($stop)
        ];
    }
    $createdTimestamp = strtotime($savedAt);
    return lehrfahrer_build_professional_pdf([
        'version' => trim((string)getLineValue($data, 'formatVersion', 'V2.1.002')),
        'metadata' => [
            'Linie' => preg_replace('/^Linie\s+/i', '', $lineName),
            'Route' => preg_replace('/^Route\s+/i', '', $routeName),
            'Richtung' => $directionName,
            'Variante' => $variantName,
            'Kategorie' => $variantCategory,
            'Gültigkeit' => $validityText,
            'Erstellt' => $createdTimestamp ? date('d.m.Y H:i', $createdTimestamp) : '',
            'Version' => trim((string)getLineValue($data, 'formatVersion', 'V2.1.002'))
        ],
        'description' => $description,
        'stops' => $professionalStops
    ]);

    $crop = static function (string $value, int $maxLength): string {
        $value = trim(preg_replace('/\s+/', ' ', $value));
        if (function_exists('mb_strlen') && function_exists('mb_substr')) {
            return mb_strlen($value, 'UTF-8') > $maxLength
                ? rtrim(mb_substr($value, 0, $maxLength - 3, 'UTF-8')) . '...'
                : $value;
        }
        return strlen($value) > $maxLength ? rtrim(substr($value, 0, $maxLength - 3)) . '...' : $value;
    };

    $lines = [];
    $lines[] = 'Lehrfahrer';
    $lines[] = '============================================================';
    $lines[] = '';
    $lines[] = 'Linie: ' . preg_replace('/^Linie\s+/i', '', $lineName);
    $lines[] = 'Route: ' . preg_replace('/^Route\s+/i', '', $routeName);
    $lines[] = 'Richtung: ' . $directionName;
    $lines[] = 'Variante: ' . $variantName;
    $lines[] = 'Kategorie: ' . $variantCategory;
    $lines[] = 'Gueltigkeit: ' . $validityText;
    $createdTimestamp = strtotime($savedAt);
    $lines[] = 'Erstellt: ' . ($createdTimestamp ? date('d.m.Y H:i', $createdTimestamp) : '');
    $lines[] = '';
    if ($description !== '') {
        $lines[] = 'Besonderheiten';
        $lines[] = '';
        foreach (preg_split('/\R/u', $description) as $descriptionLine) {
            foreach (wrapPdfLine($descriptionLine) as $wrappedDescriptionLine) {
                $lines[] = $wrappedDescriptionLine;
            }
        }
        $lines[] = '------------------------------------------------------------';
        $lines[] = '';
    }

    $lines[] = 'Haltestellen';
    $lines[] = '------------------------------------------------------------';
    $lines[] = 'Nr. | Haltestelle                         | Naechste Fahranweisung';
    $lines[] = '------------------------------------------------------------';

    if (!$realStops) {
        $lines[] = 'Keine Haltestellen vorhanden.';
    } else {
        foreach ($realStops as $idx => $stop) {
            $name = trim((string)($stop['name'] ?? ('Haltestelle ' . ($idx + 1))));
            $instruction = getPdfStopInstruction($stop);
            $lines[] = sprintf(
                '%-3d | %-35s | %s',
                $idx + 1,
                $crop($name, 35),
                $crop($instruction, 35)
            );
        }
    }
    $proofLineCount = 10;
    $remainingOnPage = 48 - (count($lines) % 48);
    if ($remainingOnPage < $proofLineCount) {
        $lines = array_merge($lines, array_fill(0, $remainingOnPage, ''));
    }
    $lines[] = '';
    $lines[] = 'Nachweis der Streckeneinweisung';
    $lines[] = '------------------------------------------------------------';
    $lines[] = 'Name Fahrer/in: ___________________________';
    $lines[] = '';
    $lines[] = 'Abgefahren am: ____ . ____ . ________';
    $lines[] = '';
    $lines[] = 'Unterschrift Fahrer/in: ____________________';
    $lines[] = '';
    $lines[] = 'Unterschrift Einweiser/in: _________________';

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

function escapeXml(string $value): string {
    return str_replace(
        ['&', '<', '>', '"', "'"],
        ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'],
        $value
    );
}

function normalizeRoutePoints(array $lineData): array {
    $route = [];

    if (isset($lineData['route']) && is_array($lineData['route']) && isset($lineData['route']['simplified']) && is_array($lineData['route']['simplified']) && count($lineData['route']['simplified']) > 1) {
        $route = $lineData['route']['simplified'];
    } elseif (isset($lineData['routePoints']) && is_array($lineData['routePoints']) && count($lineData['routePoints']) > 1) {
        $route = $lineData['routePoints'];
    } elseif (isset($lineData['stops']) && is_array($lineData['stops']) && count($lineData['stops']) > 1) {
        $route = $lineData['stops'];
    }

    $points = [];
    foreach ($route as $entry) {
        if (is_array($entry) && isset($entry['lat']) && isset($entry['lon'])) {
            $points[] = ['lat' => floatval($entry['lat']), 'lon' => floatval($entry['lon'])];
            continue;
        }
        if (is_array($entry) && isset($entry[0]) && isset($entry[1])) {
            $points[] = ['lat' => floatval($entry[0]), 'lon' => floatval($entry[1])];
        }
    }

    return $points;
}

function buildGpxFromLineData(array $lineData): ?string {
    $points = normalizeRoutePoints($lineData);
    if (count($points) < 2) {
        return null;
    }

    $lineName = trim((string)getLineValue($lineData, 'lineName', 'Linie'));
    $routeName = trim((string)getLineValue($lineData, 'routeName', ''));
    $directionName = trim((string)getLineValue($lineData, 'directionName', ''));
    $color = trim((string)getLineValue($lineData, 'color', '#d32f2f'));

    $titleParts = [];
    if ($lineName !== '') $titleParts[] = $lineName;
    if ($routeName !== '') $titleParts[] = $routeName;
    if ($directionName !== '') $titleParts[] = $directionName;
    $fullName = count($titleParts) ? implode(' - ', $titleParts) : 'Linie';

    $waypointXml = '';
    $stops = is_array($lineData['stops'] ?? null) ? $lineData['stops'] : [];
    foreach ($stops as $index => $stop) {
        if (!is_array($stop) || !isset($stop['lat']) || !isset($stop['lon'])) {
            continue;
        }
        $stopName = trim((string)($stop['name'] ?? ('Haltestelle ' . ($index + 1))));
        $minute = isset($stop['minuteFromStart']) ? intval($stop['minuteFromStart']) : 0;
        $note = trim((string)($stop['note'] ?? ''));
        $sourceType = trim((string)($stop['sourceType'] ?? ''));
        $desc = 'Stopp ' . ($index + 1) . ' | SollMinute: ' . $minute;
        if ($sourceType !== '') {
            $desc .= ' | Typ: ' . $sourceType;
        }
        if ($note !== '') {
            $desc .= ' | Info: ' . $note;
        }

        $waypointXml .= "\n  <wpt lat=\"" . floatval($stop['lat']) . "\" lon=\"" . floatval($stop['lon']) . "\">"
          . "\n    <name>" . escapeXml($stopName) . "</name>"
          . "\n    <cmt>" . escapeXml('SollMinute:' . $minute . ';Stop:' . ($index + 1)) . "</cmt>"
          . "\n    <desc>" . escapeXml($desc) . "</desc>"
          . "\n  </wpt>";
    }

    $trackXml = '';
    foreach ($points as $pt) {
        $trackXml .= "\n      <trkpt lat=\"" . $pt['lat'] . "\" lon=\"" . $pt['lon'] . "\"></trkpt>";
    }

    $gpx = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
      . "<gpx version=\"1.1\" creator=\"Lehrfahrer Linieneditor\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n"
      . "  <metadata>\n"
      . "    <name>" . escapeXml($fullName) . "</name>\n"
      . "    <desc>" . escapeXml('Export aus dem Lehrfahrer Linieneditor | Farbe: ' . $color) . "</desc>\n"
      . "  </metadata>"
      . $waypointXml . "\n"
      . "  <trk>\n"
      . "    <name>" . escapeXml($fullName) . "</name>\n"
      . "    <desc>" . escapeXml('Route für Maps.me Offline-Nutzung') . "</desc>\n"
      . "    <trkseg>"
      . $trackXml . "\n"
      . "    </trkseg>\n"
      . "  </trk>\n"
      . "</gpx>";

    return $gpx;
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
            foreach (scandir($subPath) as $categoryEntry) {
                if ($categoryEntry === '.' || $categoryEntry === '..') {
                    continue;
                }
                $categoryPath = $subPath . '/' . $categoryEntry;
                if (!is_dir($categoryPath)) {
                    continue;
                }
                foreach (glob($categoryPath . '/*.json') as $jsonFile) {
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
$generatedPdfCount = 0;
$generatedGpxCount = 0;
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
                'error' => 'JSON ungültig'
            ];
            continue;
        }

        if (!isset($lineData['savedAt'])) {
            $lineData['savedAt'] = date('c');
        }

        $targetDir = dirname($entry['jsonPath']);
        $targetPdfPath = $targetDir . '/' . $entry['fileBase'] . '.pdf';
        $targetGpxPath = $targetDir . '/' . $entry['fileBase'] . '.gpx';

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

            $generatedPdfCount++;

            $gpxText = buildGpxFromLineData($lineData);
            if ($gpxText !== null && $targetGpxPath !== '') {
                $gpxWriteOk = @file_put_contents($targetGpxPath, $gpxText);
                clearstatcache(true, $targetGpxPath);
                if ($gpxWriteOk !== false && is_file($targetGpxPath) && filesize($targetGpxPath) > 0) {
                    $generatedGpxCount++;
                }
            }
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
    'generatedPdfCount' => $generatedPdfCount,
    'generatedGpxCount' => $generatedGpxCount,
    'cityScope' => $requestedCity ?: 'alle',
    'errors' => array_slice($errors, 0, 50)
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
