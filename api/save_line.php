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

function hasDiversionSuffix(string $value): bool {
    return (bool)preg_match('/(^|[_\s-])Umleitung[_\s-]?\d{2}($|[_\s-])/i', trim($value));
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
        'version' => trim((string)getLineValue($data, 'formatVersion', 'V2.1.009')),
        'metadata' => [
            'Linie' => preg_replace('/^Linie\s+/i', '', $lineName),
            'Route' => preg_replace('/^Route\s+/i', '', $routeName),
            'Richtung' => $directionName,
            'Variante' => $variantName,
            'Kategorie' => $variantCategory,
            'Gültigkeit' => $validityText,
            'Erstellt' => $createdTimestamp ? date('d.m.Y H:i', $createdTimestamp) : '',
            'Version' => trim((string)getLineValue($data, 'formatVersion', 'V2.1.009'))
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

function isRealPdfFile(string $path): bool {
    clearstatcache(true, $path);
    return is_file($path) && filesize($path) > 0;
}

$baseDir = dirname(__DIR__);

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Ungültige JSON-Daten'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$city = trim($data['city'] ?? 'cottbus');
$city = strtolower($city);
$city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

if ($city === '') {
    $city = 'cottbus';
}

// lineFolder aus lineName ableiten (z.B. "Linie 16" → "Linie_16")
$lineFolder = trim($data['lineFolder'] ?? ($data['lineName'] ?? ''));
$lineFolder = sanitizeForFilesystem($lineFolder);
if ($lineFolder === '') {
    $lineFolder = 'Linie';
}

$categoryFolder = trim((string)($data['categoryFolder'] ?? ($data['variantCategory'] ?? ($data['line']['variantCategory'] ?? 'Standard'))));
$categoryFolder = sanitizeForFilesystem($categoryFolder);
if ($categoryFolder === '') {
    $categoryFolder = 'Standard';
}

$cityDir = $baseDir . '/linien/' . $city;
$lineBaseDir = $cityDir . '/' . $lineFolder;
$lineDir = $lineBaseDir . '/' . $categoryFolder;

if (!is_dir($lineDir)) {
    if (!mkdir($lineDir, 0775, true)) {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'error' => 'Linienordner konnte nicht erstellt werden'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

$fileBase = trim($data['fileBase'] ?? '');

if ($fileBase === '') {
    $fileBase = trim(($data['id'] ?? ''));
}

$fileBase = sanitizeForFilesystem($fileBase);

if ($fileBase === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Fehlender Dateiname'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$data['savedAt'] = date('c');
$data['lineFolder'] = $lineFolder;
$data['categoryFolder'] = $categoryFolder;
if (isset($data['line']) && is_array($data['line'])) {
    $data['line']['lineFolder'] = $lineFolder;
    $data['line']['categoryFolder'] = $categoryFolder;
}

$forceOverwrite = !empty($data['forceOverwrite']);

$filePath = $lineDir . '/' . $fileBase . '.json';

// Konfliktvermeidung:
// - Andere Route im selben Dateinamen -> freier Dateiname mit Zählsuffix
// - Selbe Route/Direction auf Original-Datei -> neue Umleitung (Umleitung_XX)
// - Bereits Umleitung_XX -> darf überschrieben werden
if (file_exists($filePath) && !$forceOverwrite) {
    $existingRaw  = @file_get_contents($filePath);
    $existingData = $existingRaw ? @json_decode($existingRaw, true) : null;
    if (is_array($existingData)) {
        $exLine  = isset($existingData['line']) && is_array($existingData['line'])
                   ? $existingData['line'] : $existingData;
        $exRoute = $exLine['routeName']     ?? ($existingData['routeName']     ?? '');
        $exDir   = $exLine['directionName'] ?? ($existingData['directionName'] ?? '');

        $inLine  = isset($data['line']) && is_array($data['line'])
                   ? $data['line'] : $data;
        $inRoute = $inLine['routeName']     ?? ($data['routeName']     ?? '');
        $inDir   = $inLine['directionName'] ?? ($data['directionName'] ?? '');

        $isSameRoute = ($exRoute === $inRoute && $exDir === $inDir);
        $isDiversionFile = hasDiversionSuffix($fileBase)
            || hasDiversionSuffix((string)$inRoute)
            || hasDiversionSuffix((string)$exRoute);

        if ($isSameRoute && !$isDiversionFile) {
            // Originalroute wird bearbeitet: neue Umleitungsdatei erzeugen statt zu überschreiben.
            $origBase = $fileBase;
            $i = 1;
            while ($i <= 99) {
                $suffix = 'Umleitung_' . str_pad((string)$i, 2, '0', STR_PAD_LEFT);
                $candidateBase = $origBase . '_' . $suffix;
                $candidatePath = $lineDir . '/' . $candidateBase . '.json';
                if (!file_exists($candidatePath)) {
                    $fileBase = $candidateBase;
                    $filePath = $candidatePath;

                    $newRouteName = trim((string)$inRoute);
                    if ($newRouteName === '') {
                        $newRouteName = 'Route';
                    }
                    if (!hasDiversionSuffix($newRouteName)) {
                        $newRouteName .= ' ' . $suffix;
                    }

                    $data['routeName'] = $newRouteName;
                    if (isset($data['line']) && is_array($data['line'])) {
                        $data['line']['routeName'] = $newRouteName;
                    }
                    break;
                }
                $i++;
            }
        } elseif (!$isSameRoute) {
            // Andere Route im selben Dateinamen – freie Datei mit Suffix suchen
            $origBase = $fileBase;
            $i = 1;
            while (file_exists($filePath) && $i <= 99) {
                $fileBase = $origBase . '_' . str_pad($i, 2, '0', STR_PAD_LEFT);
                $filePath = $lineDir . '/' . $fileBase . '.json';
                $i++;
            }
        }
    }
}

$json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if ($json === false) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'JSON konnte nicht erzeugt werden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$result = file_put_contents($filePath, $json);

if ($result === false) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Datei konnte nicht gespeichert werden'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$pdfSaved = false;
$pdfFile = $fileBase . '.pdf';
$pdfPath = $lineDir . '/' . $pdfFile;
$pdfError = null;
$pdfSavedPath = null;
$pdfTriedPaths = [];

try {
    $pdfBinary = buildLineOverviewPdf($data, $city, $lineFolder);

    $candidates = [$pdfPath];

    foreach ($candidates as $candidatePath) {
        $pdfTriedPaths[] = $candidatePath;

        $tmpPath = $candidatePath . '.tmp';
        $tmpWrite = @file_put_contents($tmpPath, $pdfBinary);
        if ($tmpWrite !== false && @rename($tmpPath, $candidatePath) && isRealPdfFile($candidatePath)) {
            $pdfSaved = true;
            $pdfSavedPath = $candidatePath;
            $pdfPath = $candidatePath;
            break;
        }
        if (is_file($tmpPath)) {
            @unlink($tmpPath);
        }

        $directWrite = @file_put_contents($candidatePath, $pdfBinary);
        if ($directWrite !== false && isRealPdfFile($candidatePath)) {
            $pdfSaved = true;
            $pdfSavedPath = $candidatePath;
            $pdfPath = $candidatePath;
            break;
        }
    }

    if (!$pdfSaved) {
        $pdfError = 'PDF konnte nicht dauerhaft geschrieben werden (Datei nicht vorhanden oder leer)';
    }
} catch (Throwable $pdfException) {
    $pdfError = $pdfException->getMessage();
}

echo json_encode([
    'ok' => true,
    'message' => 'Linie gespeichert',
    'file' => basename($filePath),
    'pdfFile' => $pdfFile,
    'pdfSaved' => $pdfSaved,
    'pdfError' => $pdfError,
    'pdfPath' => $pdfSavedPath,
    'pdfTriedPaths' => $pdfTriedPaths,
    'fileBase' => $fileBase,
    'lineFolder' => $lineFolder,
    'categoryFolder' => $categoryFolder,
    'city' => $city,
    'savedAt' => $data['savedAt']
], JSON_UNESCAPED_UNICODE);
