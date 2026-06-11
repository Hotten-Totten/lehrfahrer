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
            $lines[] = '    Minute: ' . $minute . ' | Typ: ' . ($source !== '' ? $source : '-') . ' | Position: ' . $lat . ', ' . $lon;
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

$cityDir = $baseDir . '/linien/' . $city;
$lineDir = $cityDir . '/' . $lineFolder;

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

$filePath = $lineDir . '/' . $fileBase . '.json';

// Konfliktvermeidung:
// - Andere Route im selben Dateinamen -> freier Dateiname mit Zählsuffix
// - Selbe Route/Direction auf Original-Datei -> neue Umleitung (Umleitung_XX)
// - Bereits Umleitung_XX -> darf überschrieben werden
if (file_exists($filePath)) {
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

    $candidates = [];
    $candidates[] = $lineDir . '/' . $pdfFile;

    $gpxDir = $lineDir . '/gpx';
    if (!is_dir($gpxDir)) {
        @mkdir($gpxDir, 0775, true);
    }
    if (is_dir($gpxDir)) {
        $candidates[] = $gpxDir . '/' . $pdfFile;
    }

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
    'city' => $city,
    'savedAt' => $data['savedAt']
], JSON_UNESCAPED_UNICODE);