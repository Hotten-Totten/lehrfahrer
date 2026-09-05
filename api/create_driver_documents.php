<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_driver_packages.php';
require_once __DIR__ . '/_professional_pdf.php';
lehrfahrer_require_write_auth();

function driverDocSlug(string $value, string $fallback): string {
    $value = str_replace(
        ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß'],
        ['ae', 'oe', 'ue', 'Ae', 'Oe', 'Ue', 'ss'],
        trim($value)
    );
    $value = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $value);
    $value = trim($value, '_');
    return $value !== '' ? $value : $fallback;
}

function driverDocValue(array $data, string $key, string $fallback = ''): string {
    return trim((string)($data[$key] ?? ($data['line'][$key] ?? $fallback)));
}

function driverDocEscape(string $text): string {
    $text = strtr($text, [
        'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue',
        'Ä' => 'Ae', 'Ö' => 'Oe', 'Ü' => 'Ue',
        'ß' => 'ss', '–' => '-', '—' => '-'
    ]);
    $text = preg_replace('/[^\x20-\x7E]/', '?', $text);
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
}

function driverDocWrap(string $line, int $length = 94): array {
    $line = trim(preg_replace('/\s+/', ' ', str_replace(["\r", "\n", "\t"], ' ', $line)));
    return $line === '' ? [''] : explode("\n", wordwrap($line, $length, "\n", true));
}

function driverDocCrop(string $value, int $length): string {
    $value = trim(preg_replace('/\s+/', ' ', $value));
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        return mb_strlen($value, 'UTF-8') > $length
            ? rtrim(mb_substr($value, 0, $length - 3, 'UTF-8')) . '...'
            : $value;
    }
    return strlen($value) > $length ? rtrim(substr($value, 0, $length - 3)) . '...' : $value;
}

function driverDocInstruction(array $stop): string {
    foreach ([
        'nextDrivingInstruction',
        'nextInstruction',
        'drivingInstruction',
        'instruction',
        'turnInstruction',
        'routeInstruction',
        'drivingHint',
        'nextManeuver',
        'nextManoeuvre'
    ] as $key) {
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

function driverDocTechnicalStop(array $stop): bool {
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

function driverDocStopQuality(array $stop): int {
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

function driverDocNormalizeStopName(string $name): string {
    $name = strtr($name, ['Ä' => 'ae', 'Ö' => 'oe', 'Ü' => 'ue', 'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    return strtolower(trim(preg_replace('/[^a-z0-9]+/i', ' ', $name)));
}

function driverDocRealStops(array $stops): array {
    $result = [];
    foreach ($stops as $stop) {
        if (!is_array($stop) || driverDocTechnicalStop($stop)) continue;
        $nameKey = driverDocNormalizeStopName((string)($stop['name'] ?? ''));
        if ($nameKey === '') continue;
        $lastIndex = count($result) - 1;
        if ($lastIndex >= 0 && driverDocNormalizeStopName((string)($result[$lastIndex]['name'] ?? '')) === $nameKey) {
            if (driverDocStopQuality($stop) > driverDocStopQuality($result[$lastIndex])) {
                $result[$lastIndex] = $stop;
            }
            continue;
        }
        $result[] = $stop;
    }
    return $result;
}

function driverDocSimplePdf(array $pages): string {
    $objects = [
        1 => '<< /Type /Catalog /Pages 2 0 R >>',
        2 => '',
        3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
        5 => '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'
    ];
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
            $stream .= "BT\n/{$font} {$size} Tf\n50 {$y} Td\n(" . driverDocEscape($line) . ") Tj\nET\n";
            $y -= $step;
        }
        $footer = 'Lehrfahrer | Seite ' . ($pageIndex + 1) . ' von ' . $pageCount;
        $stream .= "BT\n/F1 9 Tf\n50 28 Td\n(" . driverDocEscape($footer) . ") Tj\nET";

        $contentId = $nextId++;
        $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream";
        $pageId = $nextId++;
        $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {$contentId} 0 R >>";
        $pageRefs[] = $pageId;
    }

    $objects[2] = '<< /Type /Pages /Kids [ ' . implode(' ', array_map(
        static function ($id) {
            return $id . ' 0 R';
        },
        $pageRefs
    )) . ' ] /Count ' . count($pageRefs) . ' >>';

    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    for ($id = 1; $id < $nextId; $id++) {
        $offsets[$id] = strlen($pdf);
        $pdf .= $id . " 0 obj\n" . ($objects[$id] ?? '') . "\nendobj\n";
    }
    $xref = strlen($pdf);
    $pdf .= "xref\n0 {$nextId}\n0000000000 65535 f \n";
    for ($id = 1; $id < $nextId; $id++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
    }
    return $pdf . "trailer\n<< /Size {$nextId} /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
}

function driverDocBuildPdf(array $data, string $driverName): string {
    $formatDate = static function (string $value): string {
        $date = DateTime::createFromFormat('!Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $date->format('d.m.Y') : '';
    };
    $from = $formatDate(driverDocValue($data, 'validFrom'));
    $until = $formatDate(driverDocValue($data, 'validUntil'));
    if ($from && $until) {
        $validity = 'Gueltig: ' . $from . ' bis ' . $until;
    } elseif ($from) {
        $validity = 'Gueltig ab: ' . $from;
    } elseif ($until) {
        $validity = 'Gueltig bis: ' . $until;
    } else {
        $validity = 'Immer gueltig';
    }

    $professionalStops = [];
    foreach (driverDocRealStops(is_array($data['stops'] ?? null) ? $data['stops'] : []) as $idx => $stop) {
        $professionalStops[] = [
            'number' => $idx + 1,
            'name' => (string)($stop['name'] ?? ''),
            'instruction' => driverDocInstruction($stop)
        ];
    }
    $version = driverDocValue($data, 'formatVersion', 'V2.1.023');
    return lehrfahrer_build_professional_pdf([
        'version' => $version,
        'metadata' => [
            'Linie' => preg_replace('/^Linie\s+/i', '', driverDocValue($data, 'lineName')),
            'Route' => preg_replace('/^Route\s+/i', '', driverDocValue($data, 'routeName')),
            'Richtung' => driverDocValue($data, 'directionName'),
            'Variante' => driverDocValue($data, 'variantName'),
            'Kategorie' => driverDocValue($data, 'variantCategory'),
            'Gültigkeit' => $validity,
            'Erstellt' => date('d.m.Y H:i'),
            'Version' => $version
        ],
        'description' => driverDocValue($data, 'description'),
        'stops' => $professionalStops,
        'driverName' => $driverName
    ]);

    $lines = [
        'Lehrfahrer',
        '============================================================',
        '',
        'Linie: ' . preg_replace('/^Linie\s+/i', '', driverDocValue($data, 'lineName')),
        'Route: ' . preg_replace('/^Route\s+/i', '', driverDocValue($data, 'routeName')),
        'Richtung: ' . driverDocValue($data, 'directionName'),
        'Variante: ' . driverDocValue($data, 'variantName'),
        'Kategorie: ' . driverDocValue($data, 'variantCategory'),
        'Gueltigkeit: ' . $validity,
        'Erstellt: ' . date('d.m.Y H:i'),
        ''
    ];

    $description = driverDocValue($data, 'description');
    if ($description !== '') {
        $lines[] = 'Besonderheiten';
        $lines[] = '';
        foreach (preg_split('/\R/u', $description) as $descriptionLine) {
            foreach (driverDocWrap($descriptionLine) as $wrapped) {
                $lines[] = $wrapped;
            }
        }
        $lines[] = '------------------------------------------------------------';
        $lines[] = '';
    }

    $lines[] = 'Haltestellen';
    $lines[] = '------------------------------------------------------------';
    $lines[] = 'Nr. | Haltestelle                         | Naechste Fahranweisung';
    $lines[] = '------------------------------------------------------------';
    $number = 0;
    foreach (driverDocRealStops(is_array($data['stops'] ?? null) ? $data['stops'] : []) as $stop) {
        $number++;
        $instruction = driverDocInstruction($stop);
        $lines[] = sprintf(
            '%-3d | %-35s | %s',
            $number,
            driverDocCrop((string)($stop['name'] ?? ''), 35),
            driverDocCrop($instruction, 35)
        );
    }
    if ($number === 0) {
        $lines[] = 'Keine Haltestellen vorhanden.';
    }

    $proofLineCount = 10;
    $remainingOnPage = 48 - (count($lines) % 48);
    if ($remainingOnPage < $proofLineCount) {
        $lines = array_merge($lines, array_fill(0, $remainingOnPage, ''));
    }
    $lines[] = '';
    $lines[] = 'Nachweis der Streckeneinweisung';
    $lines[] = '------------------------------------------------------------';
    $lines[] = 'Name Fahrer/in: ' . ($driverName !== '' ? $driverName : '___________________________');
    $lines[] = '';
    $lines[] = 'Abgefahren am: ____ . ____ . ________';
    $lines[] = '';
    $lines[] = 'Unterschrift Fahrer/in: ____________________';
    $lines[] = '';
    $lines[] = 'Unterschrift Einweiser/in: _________________';

    $wrappedLines = [];
    foreach ($lines as $line) {
        foreach (driverDocWrap($line) as $wrapped) {
            $wrappedLines[] = $wrapped;
        }
    }
    $pages = [];
    while ($wrappedLines) {
        $pages[] = array_splice($wrappedLines, 0, 48);
    }
    return driverDocSimplePdf($pages);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input) || !is_array($input['items'] ?? null) || !$input['items']) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Keine Unterlagen ausgewaehlt.']);
    exit;
}

$driverName = trim((string)($input['driverName'] ?? ''));
$packageNote = trim((string)($input['note'] ?? ''));
$driverId = trim((string)($input['driverId'] ?? ''));
if ($driverId !== '' && !preg_match('/^drv_[a-f0-9]{32}$/', $driverId)) {
    $driverId = '';
}
$mode = trim((string)($input['mode'] ?? 'new'));
$requestedPackageId = trim((string)($input['packageId'] ?? ''));
$existingPackage = $mode === 'update' ? driverPackageFind($requestedPackageId) : null;
$now = date('c');
$oldPdfPaths = [];

if ($mode === 'update') {
    if ($existingPackage === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Zu aktualisierendes Paket wurde nicht gefunden.']);
        exit;
    }
    $packageDir = $existingPackage['dir'];
    $driverFolder = basename(dirname($packageDir));
    $packageId = $existingPackage['storedId'] !== '' ? $existingPackage['storedId'] : driverPackageNewId();
    $created = trim((string)($existingPackage['data']['created'] ?? ($existingPackage['data']['createdAt'] ?? ''))) ?: $now;
    $oldPdfPaths = glob($packageDir . '/*.pdf') ?: [];
    @unlink($packageDir . '/paket.zip');
} else {
    $driverFolder = driverDocSlug($driverName, 'Unbenannt');
    $root = driverPackageRoot();
    $driverDir = $root . '/' . $driverFolder;
    $timestamp = date('Y-m-d_His');
    $packageDir = $driverDir . '/' . $timestamp;
    $suffix = 1;
    while (file_exists($packageDir)) {
        $packageDir = $driverDir . '/' . $timestamp . '_' . str_pad((string)$suffix++, 2, '0', STR_PAD_LEFT);
    }
    if (!mkdir($packageDir, 0775, true)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Paketordner konnte nicht erstellt werden.']);
        exit;
    }
    $packageId = driverPackageNewId();
    $created = $now;
}

$documents = [];
$usedNames = [];
$selectedItems = [];
foreach ($input['items'] as $item) {
    if (!is_array($item)) continue;
    $city = driverDocSlug((string)($item['city'] ?? ''), '');
    $lineFolder = driverDocSlug((string)($item['lineFolder'] ?? ''), '');
    $categoryFolder = driverDocSlug((string)($item['categoryFolder'] ?? ''), '');
    $fileBase = driverDocSlug((string)($item['fileBase'] ?? ''), '');
    if ($city === '' || $fileBase === '') continue;
    $selectedItems[] = [
        'city' => $city,
        'lineFolder' => $lineFolder,
        'categoryFolder' => $categoryFolder,
        'fileBase' => $fileBase
    ];

    $cityDir = dirname(__DIR__) . '/linien/' . $city;
    if (!is_dir($cityDir) && is_dir(dirname(__DIR__) . '/linien/linien/' . $city)) {
        $cityDir = dirname(__DIR__) . '/linien/linien/' . $city;
    }
    $candidates = [];
    if ($lineFolder && $categoryFolder) $candidates[] = $cityDir . '/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase . '.json';
    if ($lineFolder) $candidates[] = $cityDir . '/' . $lineFolder . '/' . $fileBase . '.json';
    $candidates[] = $cityDir . '/' . $fileBase . '.json';
    $sourcePath = '';
    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            $sourcePath = $candidate;
            break;
        }
    }
    if ($sourcePath === '') continue;
    $data = json_decode((string)file_get_contents($sourcePath), true);
    if (!is_array($data)) continue;

    $lineLabel = driverDocSlug(driverDocValue($data, 'lineName'), 'Linie');
    $variantLabel = driverDocSlug(driverDocValue($data, 'variantName'), driverDocSlug(driverDocValue($data, 'routeName'), 'Variante'));
    $pdfBase = $lineLabel . '_' . $variantLabel;
    $pdfName = $pdfBase . '.pdf';
    $number = 2;
    while (isset($usedNames[strtolower($pdfName)]) || file_exists($packageDir . '/' . $pdfName)) {
        $pdfName = $pdfBase . '_' . $number++ . '.pdf';
    }
    $usedNames[strtolower($pdfName)] = true;
    if (file_put_contents($packageDir . '/' . $pdfName, driverDocBuildPdf($data, $driverName)) === false) {
        continue;
    }
    $relativePath = 'fahrerunterlagen/' . $driverFolder . '/' . basename($packageDir) . '/' . $pdfName;
    $documents[] = [
        'lineName' => driverDocValue($data, 'lineName'),
        'routeName' => driverDocValue($data, 'routeName'),
        'directionName' => driverDocValue($data, 'directionName'),
        'variantName' => driverDocValue($data, 'variantName'),
        'variantCategory' => driverDocValue($data, 'variantCategory'),
        'validFrom' => driverDocValue($data, 'validFrom'),
        'validUntil' => driverDocValue($data, 'validUntil'),
        'path' => $relativePath
    ];
}

if (!$documents) {
    if ($mode !== 'update') @rmdir($packageDir);
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => 'Keine PDF-Unterlagen konnten erzeugt werden.']);
    exit;
}

$currentPdfNames = array_map(static function (array $document): string {
    return basename((string)$document['path']);
}, $documents);
foreach ($oldPdfPaths as $oldPdfPath) {
    if (!in_array(basename($oldPdfPath), $currentPdfNames, true)) {
        @unlink($oldPdfPath);
    }
}

$packageLineNames = [];
$packageCategories = [];
$packageValidity = [];
foreach ($documents as $document) {
    if ($document['lineName'] !== '') $packageLineNames[$document['lineName']] = true;
    if ($document['variantCategory'] !== '') $packageCategories[$document['variantCategory']] = true;
    $validityKey = $document['validFrom'] . '|' . $document['validUntil'];
    if ($validityKey !== '|') {
        $packageValidity[$validityKey] = [
            'validFrom' => $document['validFrom'],
            'validUntil' => $document['validUntil']
        ];
    }
}

$package = [
    'id' => $packageId,
    'driverId' => $driverId,
    'driverName' => $driverName,
    'created' => $created,
    'updated' => $now,
    'createdAt' => $created,
    'version' => 2,
    'status' => 'Erstellt',
    'note' => $packageNote,
    'documentCount' => count($documents),
    'lineCount' => count($packageLineNames),
    'categories' => array_keys($packageCategories),
    'validity' => array_values($packageValidity),
    'documents' => $documents,
    'selectedItems' => $selectedItems
];
$packageWrite = file_put_contents(
    $packageDir . '/paket.json',
    json_encode($package, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);
if ($packageWrite === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Paketuebersicht konnte nicht gespeichert werden.']);
    exit;
}

$zipAvailable = class_exists('ZipArchive');
if ($zipAvailable) {
    $zip = new ZipArchive();
    $zipPath = $packageDir . '/paket.zip';
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
        $zip->addFile($packageDir . '/paket.json', 'paket.json');
        foreach (glob($packageDir . '/*.pdf') ?: [] as $pdfFile) {
            $zip->addFile($pdfFile, basename($pdfFile));
        }
        $zip->close();
    }
}

echo json_encode([
    'ok' => true,
    'package' => $package,
    'packagePath' => 'fahrerunterlagen/' . $driverFolder . '/' . basename($packageDir) . '/paket.json',
    'zipAvailable' => $zipAvailable
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
