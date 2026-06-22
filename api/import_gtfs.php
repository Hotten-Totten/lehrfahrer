<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

const GTFS_MAX_UPLOAD_BYTES = 262144000;
const GTFS_MAX_FILTERED_ROUTES = 5000;
const GTFS_SESSION_TTL_SECONDS = 7200;

function gtfs_reply(array $payload, int $status = 200): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gtfs_error(int $status, string $message): void {
    gtfs_reply(['ok' => false, 'error' => $message], $status);
}

function gtfs_temp_root(): string {
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'lehrfahrer_gtfs';
}

function gtfs_cleanup_sessions(string $root): void {
    if (!is_dir($root)) return;
    $now = time();
    foreach (glob($root . DIRECTORY_SEPARATOR . '*') ?: [] as $path) {
        if (!is_dir($path) || $now - (int)@filemtime($path) < GTFS_SESSION_TTL_SECONDS) continue;
        foreach (glob($path . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
            if (is_file($file)) @unlink($file);
        }
        @rmdir($path);
    }
}

function gtfs_session_dir(string $token): string {
    if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
        gtfs_error(400, 'Ungültige GTFS-Sitzung.');
    }
    $dir = gtfs_temp_root() . DIRECTORY_SEPARATOR . $token;
    if (!is_dir($dir)) {
        gtfs_error(410, 'GTFS-Sitzung abgelaufen. ZIP bitte erneut laden.');
    }
    @touch($dir);
    return $dir;
}

function gtfs_find_zip_entry(ZipArchive $zip, string $fileName): ?string {
    $target = strtolower($fileName);
    for ($index = 0; $index < $zip->numFiles; $index++) {
        $stat = $zip->statIndex($index);
        if (!is_array($stat)) continue;
        $entryName = strval($stat['name'] ?? '');
        $baseName = strtolower(basename(str_replace('\\', '/', $entryName)));
        if ($baseName === $target) return $entryName;
    }
    return null;
}

function gtfs_open_zip_table(ZipArchive $zip, string $fileName, array $requiredHeaders): array {
    $entryName = gtfs_find_zip_entry($zip, $fileName);
    if ($entryName === null) gtfs_error(422, 'GTFS-ZIP enthält ' . $fileName . ' nicht.');
    $handle = $zip->getStream($entryName);
    if (!$handle) gtfs_error(500, 'GTFS-Datei kann nicht aus ZIP gelesen werden: ' . $fileName);
    $headers = fgetcsv($handle);
    if (!is_array($headers)) {
        fclose($handle);
        gtfs_error(422, 'GTFS-Datei ist leer: ' . $fileName);
    }
    $headers = array_map(static function ($value): string {
        return trim(preg_replace('/^\xEF\xBB\xBF/', '', strval($value)));
    }, $headers);
    foreach ($requiredHeaders as $required) {
        if (!in_array($required, $headers, true)) {
            fclose($handle);
            gtfs_error(422, $fileName . ' enthält das Pflichtfeld ' . $required . ' nicht.');
        }
    }
    return [$handle, $headers];
}

function gtfs_row(array $headers, array $values): array {
    $row = [];
    foreach ($headers as $index => $header) {
        $row[$header] = isset($values[$index]) ? trim(strval($values[$index])) : '';
    }
    return $row;
}

function gtfs_route_label(array $route): string {
    $short = trim(strval($route['route_short_name'] ?? ''));
    $long = trim(strval($route['route_long_name'] ?? ''));
    if ($short !== '' && $long !== '') return $short . ' – ' . $long;
    if ($short !== '') return $short;
    if ($long !== '') return $long;
    return strval($route['route_id'] ?? 'Linie');
}

function gtfs_read_agencies(ZipArchive $zip): array {
    if (gtfs_find_zip_entry($zip, 'agency.txt') === null) return [];
    [$handle, $headers] = gtfs_open_zip_table($zip, 'agency.txt', ['agency_id', 'agency_name']);
    $agencies = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        $agencyId = $row['agency_id'] ?? '';
        if ($agencyId === '') continue;
        $agencies[$agencyId] = $row['agency_name'] ?? '';
    }
    fclose($handle);
    return $agencies;
}

function gtfs_read_agency_options(ZipArchive $zip): array {
    $agencies = gtfs_read_agencies($zip);
    [$handle, $headers] = gtfs_open_zip_table($zip, 'routes.txt', ['route_id']);
    $routeCounts = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        $agencyId = $row['agency_id'] ?? '';
        if ($agencyId === '') continue;
        $routeCounts[$agencyId] = ($routeCounts[$agencyId] ?? 0) + 1;
    }
    fclose($handle);

    $options = [];
    foreach ($agencies as $agencyId => $agencyName) {
        $routeCount = (int)($routeCounts[$agencyId] ?? 0);
        if ($routeCount < 1) continue;
        $options[] = [
            'id' => $agencyId,
            'name' => $agencyName !== '' ? $agencyName : $agencyId,
            'routeCount' => $routeCount,
            'isDefault' => gtfs_is_vbb_agency($agencyName),
        ];
    }
    usort($options, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    return $options;
}

function gtfs_contains_text(string $haystack, string $needle): bool {
    if ($needle === '') return true;
    if (function_exists('mb_stripos')) return mb_stripos($haystack, $needle, 0, 'UTF-8') !== false;
    return stripos($haystack, $needle) !== false;
}

function gtfs_is_vbb_agency(string $agencyName): bool {
    if ($agencyName === '') return false;
    return preg_match(
        '/berliner verkehrsbetriebe|s.?bahn berlin|cottbusverkehr|havelbus|oberhavel|uckerm[aä]rk|prignitz|barnimer|niederbarnim|ostdeutsche eisenbahn|regiobus potsdam|regionalverkehr spreewald|stra[sß]enverkehr frankfurt|strausberger|m[aä]rkische (verkehr|vg)|teltow.?fl[aä]ming|verkehrsbetrieb potsdam|verkehrsbetriebe brandenburg|db regiobus ost|ostprignitz.?ruppin|sch[oö]neicher|woltersdorf|verkehrsverbund berlin.?brandenburg|\bvbb\b/iu',
        $agencyName
    ) === 1;
}

function gtfs_read_routes(ZipArchive $zip, array $filters = []): array {
    $agencies = gtfs_read_agencies($zip);
    [$handle, $headers] = gtfs_open_zip_table($zip, 'routes.txt', ['route_id']);
    $search = trim(strval($filters['search'] ?? ''));
    $agencyFilter = trim(strval($filters['agencyFilter'] ?? ''));
    $regionFilter = strtolower(trim(strval($filters['regionFilter'] ?? 'vbb')));
    $selectedAgencyIds = is_array($filters['agencyIds'] ?? null) ? $filters['agencyIds'] : null;
    $selectedAgencies = $selectedAgencyIds === null
        ? null
        : array_fill_keys(array_map('strval', $selectedAgencyIds), true);
    $routes = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        $routeId = $row['route_id'] ?? '';
        if ($routeId === '') continue;
        $agencyId = $row['agency_id'] ?? '';
        $agencyName = strval($agencies[$agencyId] ?? '');
        if ($selectedAgencies !== null && !isset($selectedAgencies[$agencyId])) continue;
        $searchText = implode(' ', [
            $routeId,
            $row['route_short_name'] ?? '',
            $row['route_long_name'] ?? '',
            $row['route_type'] ?? '',
            $agencyId,
            $agencyName,
        ]);
        if ($search !== '' && !gtfs_contains_text($searchText, $search)) continue;
        if ($agencyFilter !== '' && !gtfs_contains_text($agencyId . ' ' . $agencyName, $agencyFilter)) continue;
        if ($selectedAgencies === null
            && $search === ''
            && $agencyFilter === ''
            && $regionFilter === 'vbb'
            && !gtfs_is_vbb_agency($agencyName)) continue;

        $routes[$routeId] = [
            'id' => $routeId,
            'name' => gtfs_route_label($row),
            'shortName' => $row['route_short_name'] ?? '',
            'longName' => $row['route_long_name'] ?? '',
            'routeType' => $row['route_type'] ?? '',
            'color' => $row['route_color'] ?? '',
            'agencyId' => $agencyId,
            'agencyName' => $agencyName,
        ];
        if (count($routes) > GTFS_MAX_FILTERED_ROUTES) {
            fclose($handle);
            gtfs_error(
                413,
                'Der GTFS-Filter liefert mehr als ' . GTFS_MAX_FILTERED_ROUTES
                . ' Linien. Bitte Suchtext oder Betreiberfilter genauer eingrenzen.'
            );
        }
    }
    fclose($handle);
    uasort($routes, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    return array_values($routes);
}

function gtfs_read_route_trips(ZipArchive $zip, string $routeId): array {
    [$handle, $headers] = gtfs_open_zip_table($zip, 'trips.txt', ['route_id', 'trip_id']);
    $trips = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        if (($row['route_id'] ?? '') !== $routeId) continue;
        $tripId = $row['trip_id'] ?? '';
        if ($tripId === '') continue;
        $trips[$tripId] = [
            'tripId' => $tripId,
            'directionId' => $row['direction_id'] ?? '',
            'headsign' => $row['trip_headsign'] ?? '',
        ];
        if (count($trips) > 50000) {
            fclose($handle);
            gtfs_error(413, 'Ausgewählte Linie enthält mehr als 50.000 Fahrten.');
        }
    }
    fclose($handle);
    return $trips;
}

function gtfs_read_trip_sequences(ZipArchive $zip, array $trips): array {
    [$handle, $headers] = gtfs_open_zip_table($zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence']);
    $tripIdIndex = array_search('trip_id', $headers, true);
    $stopIdIndex = array_search('stop_id', $headers, true);
    $sequenceIndex = array_search('stop_sequence', $headers, true);
    $sequences = [];
    $matchedRows = 0;
    while (($values = fgetcsv($handle)) !== false) {
        $tripId = trim(strval($values[$tripIdIndex] ?? ''));
        if (!isset($trips[$tripId])) continue;
        $stopId = trim(strval($values[$stopIdIndex] ?? ''));
        $sequenceRaw = trim(strval($values[$sequenceIndex] ?? ''));
        if ($stopId === '' || !is_numeric($sequenceRaw)) continue;
        $sequences[$tripId][] = ['stopId' => $stopId, 'sequence' => (int)$sequenceRaw];
        $matchedRows++;
        if ($matchedRows > 2000000) {
            fclose($handle);
            gtfs_error(413, 'Ausgewählte Linie enthält mehr als 2.000.000 Stop-Zeilen.');
        }
    }
    fclose($handle);
    return $sequences;
}

function gtfs_build_variants(ZipArchive $zip, string $routeId, array $route = []): array {
    $trips = gtfs_read_route_trips($zip, $routeId);
    if (!$trips) return [];
    $sequences = gtfs_read_trip_sequences($zip, $trips);
    $variants = [];
    foreach ($sequences as $tripId => $items) {
        usort($items, static fn(array $a, array $b): int => $a['sequence'] <=> $b['sequence']);
        $stopIds = array_column($items, 'stopId');
        if (count($stopIds) < 2) continue;
        $signature = sha1(implode('>', $stopIds));
        $trip = $trips[$tripId];
        $variantId = strval($trip['directionId']) . '|' . $signature;
        if (isset($variants[$variantId])) continue;
        $variants[$variantId] = [
            'id' => $variantId,
            'name' => trim(strval($trip['headsign'])) !== '' ? $trip['headsign'] : 'GTFS-Variante',
            'directionId' => $trip['directionId'],
            'headsign' => $trip['headsign'],
            'stopCount' => count($stopIds),
            'variantKey' => $signature,
            'items' => $items,
        ];
    }
    if (!$variants) return [];

    $neededStopIds = [];
    foreach ($variants as $variant) {
        foreach ($variant['items'] as $item) $neededStopIds[] = $item['stopId'];
    }
    $stopData = gtfs_read_stops($zip, array_values(array_unique($neededStopIds)));
    foreach ($variants as &$variant) {
        foreach ($variant['items'] as &$item) {
            $stop = $stopData[$item['stopId']] ?? null;
            $item['name'] = strval($stop['name'] ?? $item['stopId']);
            $item['lat'] = $stop['lat'] ?? null;
            $item['lon'] = $stop['lon'] ?? null;
        }
        unset($item);
        $items = $variant['items'];
        $firstStopId = $items[0]['stopId'];
        $lastStopId = $items[count($items) - 1]['stopId'];
        $variant['startStop'] = strval($stopData[$firstStopId]['name'] ?? $firstStopId);
        $variant['destination'] = strval($stopData[$lastStopId]['name'] ?? $lastStopId);
        $variant['viaStops'] = gtfs_via_names(array_column($items, 'name'));
        $variant['routeShortName'] = strval($route['shortName'] ?? '');
        $variant['routeLongName'] = strval($route['longName'] ?? '');
        $variant['agencyName'] = strval($route['agencyName'] ?? '');
        $variant['routeType'] = strval($route['routeType'] ?? '');
        $variant['routeTypeLabel'] = gtfs_route_type_label($variant['routeType']);
        if (trim(strval($variant['headsign'])) === '' && $variant['destination'] !== '') {
            $variant['name'] = $variant['destination'];
        }
    }
    unset($variant);

    $result = array_values($variants);
    usort($result, static function (array $a, array $b): int {
        $directionCompare = strnatcasecmp(strval($a['directionId']), strval($b['directionId']));
        if ($directionCompare !== 0) return $directionCompare;
        return strnatcasecmp(strval($a['name']), strval($b['name']));
    });
    return $result;
}

function gtfs_valid_coordinates(array $row): bool {
    if (!is_numeric($row['stop_lat'] ?? '') || !is_numeric($row['stop_lon'] ?? '')) return false;
    $lat = (float)$row['stop_lat'];
    $lon = (float)$row['stop_lon'];
    return $lat >= -90 && $lat <= 90 && $lon >= -180 && $lon <= 180;
}

function gtfs_read_stops(ZipArchive $zip, array $neededIds): array {
    [$handle, $headers] = gtfs_open_zip_table($zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
    $needed = array_fill_keys($neededIds, true);
    $requestedRows = [];
    while (($values = fgetcsv($handle)) !== false && count($requestedRows) < count($needed)) {
        $row = gtfs_row($headers, $values);
        $stopId = $row['stop_id'] ?? '';
        if (!isset($needed[$stopId])) continue;
        $requestedRows[$stopId] = $row;
    }
    fclose($handle);

    $parentIds = [];
    foreach ($requestedRows as $row) {
        if (gtfs_valid_coordinates($row)) continue;
        $parentId = trim(strval($row['parent_station'] ?? ''));
        if ($parentId !== '') $parentIds[$parentId] = true;
    }

    $parentCoordinates = [];
    if ($parentIds) {
        [$parentHandle, $parentHeaders] = gtfs_open_zip_table($zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
        while (($values = fgetcsv($parentHandle)) !== false && count($parentCoordinates) < count($parentIds)) {
            $row = gtfs_row($parentHeaders, $values);
            $stopId = $row['stop_id'] ?? '';
            if (!isset($parentIds[$stopId]) || !gtfs_valid_coordinates($row)) continue;
            $parentCoordinates[$stopId] = [
                'lat' => (float)$row['stop_lat'],
                'lon' => (float)$row['stop_lon'],
            ];
        }
        fclose($parentHandle);
    }

    $stops = [];
    foreach ($requestedRows as $stopId => $row) {
        $coordinates = null;
        $coordinateSource = 'stop';
        if (gtfs_valid_coordinates($row)) {
            $coordinates = ['lat' => (float)$row['stop_lat'], 'lon' => (float)$row['stop_lon']];
        } else {
            $parentId = trim(strval($row['parent_station'] ?? ''));
            if ($parentId !== '' && isset($parentCoordinates[$parentId])) {
                $coordinates = $parentCoordinates[$parentId];
                $coordinateSource = 'parent_station';
            }
        }
        if (!$coordinates) continue;
        $stops[$stopId] = [
            'name' => $row['stop_name'],
            'lat' => $coordinates['lat'],
            'lon' => $coordinates['lon'],
            'coordinateSource' => $coordinateSource,
        ];
    }
    return $stops;
}

function gtfs_ini_size_bytes(string $value): int {
    $value = trim($value);
    if ($value === '' || $value === '-1') return 0;
    $number = (float)$value;
    $unit = strtolower(substr($value, -1));
    if ($unit === 'g') $number *= 1024;
    if ($unit === 'g' || $unit === 'm') $number *= 1024;
    if ($unit === 'g' || $unit === 'm' || $unit === 'k') $number *= 1024;
    return max(0, (int)$number);
}

function gtfs_upload_limits_text(): string {
    $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    return sprintf(
        'Serverlimits: upload_max_filesize=%s, post_max_size=%s, memory_limit=%s, max_execution_time=%ss, CONTENT_LENGTH=%d Bytes.',
        strval(ini_get('upload_max_filesize')),
        strval(ini_get('post_max_size')),
        strval(ini_get('memory_limit')),
        strval(ini_get('max_execution_time')),
        $contentLength
    );
}

function gtfs_upload_error_message(int $errorCode): string {
    $messages = [
        UPLOAD_ERR_INI_SIZE => 'Upload überschreitet upload_max_filesize.',
        UPLOAD_ERR_FORM_SIZE => 'Upload überschreitet die im Formular erlaubte Dateigröße.',
        UPLOAD_ERR_PARTIAL => 'Upload wurde nur teilweise übertragen.',
        UPLOAD_ERR_NO_FILE => 'Keine GTFS-ZIP-Datei ausgewählt.',
        UPLOAD_ERR_NO_TMP_DIR => 'Temporäres Upload-Verzeichnis fehlt.',
        UPLOAD_ERR_CANT_WRITE => 'Upload konnte nicht auf die Festplatte geschrieben werden.',
        UPLOAD_ERR_EXTENSION => 'Eine PHP-Erweiterung hat den Upload gestoppt.',
    ];
    return $messages[$errorCode] ?? ('Unbekannter PHP-Uploadfehler ' . $errorCode . '.');
}

function gtfs_handle_upload(): void {
    if (!class_exists('ZipArchive')) {
        gtfs_error(501, 'GTFS-Import benötigt PHP ZipArchive.');
    }
    $limitsText = gtfs_upload_limits_text();
    if (empty($_FILES)) {
        $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        $postMaxBytes = gtfs_ini_size_bytes(strval(ini_get('post_max_size')));
        if ($postMaxBytes > 0 && $contentLength > $postMaxBytes) {
            gtfs_error(413, 'Upload zu groß für post_max_size. ' . $limitsText);
        }
        gtfs_error(400, 'Keine Upload-Datei empfangen. ' . $limitsText);
    }

    $upload = $_FILES['feed'] ?? null;
    if (!is_array($upload)) {
        gtfs_error(400, 'Upload-Feld "feed" fehlt. ' . $limitsText);
    }
    $uploadError = (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($uploadError !== UPLOAD_ERR_OK) {
        if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            $status = 413;
        } elseif (in_array($uploadError, [UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION], true)) {
            $status = 500;
        } else {
            $status = 400;
        }
        gtfs_error($status, gtfs_upload_error_message($uploadError) . ' ' . $limitsText);
    }
    $size = (int)($upload['size'] ?? 0);
    if ($size <= 0 || $size > GTFS_MAX_UPLOAD_BYTES) {
        gtfs_error(413, 'GTFS-ZIP muss zwischen 1 Byte und 250 MB groß sein. ' . $limitsText);
    }
    gtfs_start_session(strval($upload['tmp_name']), true, 'Browser-Upload');
}

function gtfs_start_session(string $zipPath, bool $copyZip, string $sourceLabel): void {
    if (!class_exists('ZipArchive')) {
        gtfs_error(501, 'GTFS-Import benötigt PHP ZipArchive.');
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        gtfs_error(422, 'GTFS-ZIP kann nicht geöffnet werden.');
    }
    foreach (['agency.txt', 'routes.txt'] as $required) {
        if (gtfs_find_zip_entry($zip, $required) === null) {
            $zip->close();
            gtfs_error(422, 'GTFS-ZIP enthält ' . $required . ' nicht.');
        }
    }

    $root = gtfs_temp_root();
    if (!is_dir($root) && !mkdir($root, 0700, true)) {
        $zip->close();
        gtfs_error(500, 'Temporäres GTFS-Verzeichnis kann nicht erstellt werden.');
    }
    gtfs_cleanup_sessions($root);
    $token = bin2hex(random_bytes(16));
    $dir = $root . DIRECTORY_SEPARATOR . $token;
    if (!mkdir($dir, 0700, true)) {
        $zip->close();
        gtfs_error(500, 'GTFS-Sitzung kann nicht erstellt werden.');
    }
    $sessionZipPath = $zipPath;
    $sourceType = 'server';
    if ($copyZip) {
        $sessionZipPath = $dir . DIRECTORY_SEPARATOR . 'feed.zip';
        if (!@copy($zipPath, $sessionZipPath)) {
            $zip->close();
            @rmdir($dir);
            gtfs_error(500, 'Browser-GTFS-ZIP kann nicht in die temporäre Sitzung kopiert werden.');
        }
        $sourceType = 'session';
    }

    $sourceData = [
        'type' => $sourceType,
        'label' => $sourceLabel,
        'size' => (int)@filesize($sessionZipPath),
        'mtime' => (int)@filemtime($sessionZipPath),
    ];
    if (@file_put_contents(
        $dir . DIRECTORY_SEPARATOR . 'source.json',
        json_encode($sourceData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    ) === false) {
        $zip->close();
        if ($copyZip) @unlink($sessionZipPath);
        @rmdir($dir);
        gtfs_error(500, 'GTFS-Sitzungsdaten können nicht gespeichert werden.');
    }

    $agencies = gtfs_read_agency_options($zip);
    $zip->close();
    gtfs_reply([
        'ok' => true,
        'token' => $token,
        'agencies' => $agencies,
        'agencyCount' => count($agencies),
    ]);
}

function gtfs_server_zip_path(): string {
    $projectRoot = realpath(dirname(__DIR__));
    if ($projectRoot === false) gtfs_error(500, 'Projektverzeichnis für Server-GTFS kann nicht aufgelöst werden.');
    $expectedDir = $projectRoot . DIRECTORY_SEPARATOR . 'gtfs' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gtfs';
    $realDir = realpath($expectedDir);
    $realPath = realpath($expectedDir . DIRECTORY_SEPARATOR . 'latest.zip');
    if ($realDir === false || $realPath === false || !is_file($realPath)) {
        gtfs_error(404, 'Server-GTFS-ZIP fehlt: gtfs/data/gtfs/latest.zip');
    }
    $projectPrefix = rtrim($projectRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    $allowedPrefix = rtrim($realDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (strpos($allowedPrefix, $projectPrefix) !== 0) {
        gtfs_error(403, 'Server-GTFS-Verzeichnis liegt außerhalb des Projekts.');
    }
    if (strpos($realPath, $allowedPrefix) !== 0 || basename($realPath) !== 'latest.zip') {
        gtfs_error(403, 'Ungültiger Pfad für Server-GTFS-ZIP.');
    }
    if (!is_readable($realPath)) {
        gtfs_error(500, 'Server-GTFS-ZIP ist nicht lesbar: gtfs/data/gtfs/latest.zip');
    }
    return $realPath;
}

function gtfs_index_dir(): string {
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'gtfs' . DIRECTORY_SEPARATOR . 'imports';
}

function gtfs_index_path(): string {
    return gtfs_index_dir() . DIRECTORY_SEPARATOR . 'variants.sqlite';
}

function gtfs_require_sqlite(): void {
    if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        gtfs_error(501, 'GTFS-Turboindex benötigt PHP PDO_SQLite.');
    }
}

function gtfs_route_type_label(string $routeType): string {
    $labels = [
        '0' => 'Tram',
        '1' => 'U-Bahn',
        '2' => 'Bahn',
        '3' => 'Bus',
        '4' => 'Fähre',
        '5' => 'Straßenbahn-Kabelbahn',
        '6' => 'Seilbahn',
        '7' => 'Standseilbahn',
        '11' => 'Oberleitungsbus',
        '12' => 'Monorail',
    ];
    return $labels[$routeType] ?? ($routeType !== '' ? 'Typ ' . $routeType : 'Unbekannt');
}

function gtfs_feed_signature(string $zipPath): array {
    return [
        'size' => (int)@filesize($zipPath),
        'mtime' => (int)@filemtime($zipPath),
    ];
}

function gtfs_normalize_agency_ids(array $agencyIds): array {
    $agencyIds = array_values(array_unique(array_filter(array_map(
        static fn($value): string => trim(strval($value)),
        $agencyIds
    ), static fn(string $value): bool => $value !== '')));
    sort($agencyIds, SORT_STRING);
    return $agencyIds;
}

function gtfs_agency_fingerprint(array $agencyIds): string {
    return hash('sha256', implode("\n", gtfs_normalize_agency_ids($agencyIds)));
}

function gtfs_index_fingerprint(array $feedSignature, string $agencyFingerprint): string {
    return hash('sha256', $feedSignature['size'] . '|' . $feedSignature['mtime'] . '|' . $agencyFingerprint);
}

function gtfs_header_position(array $headers, string $name): int {
    $index = array_search($name, $headers, true);
    if ($index === false) gtfs_error(422, 'GTFS-Pflichtfeld fehlt: ' . $name);
    return (int)$index;
}

function gtfs_index_import_table(
    ZipArchive $zip,
    string $fileName,
    array $requiredHeaders,
    callable $rowHandler
): int {
    [$handle, $headers] = gtfs_open_zip_table($zip, $fileName, $requiredHeaders);
    $count = 0;
    while (($values = fgetcsv($handle)) !== false) {
        $rowHandler($headers, $values);
        $count++;
    }
    fclose($handle);
    return $count;
}

function gtfs_via_names(array $stopNames): array {
    $count = count($stopNames);
    if ($count <= 2) return [];
    $via = [];
    for ($step = 1; $step <= 4; $step++) {
        $index = (int)round(($count - 1) * $step / 5);
        if ($index <= 0 || $index >= $count - 1) continue;
        $name = trim(strval($stopNames[$index] ?? ''));
        if ($name !== '' && !in_array($name, $via, true)) $via[] = $name;
    }
    return $via;
}

function gtfs_open_valid_index(): ?PDO {
    if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) return null;
    $indexPath = gtfs_index_path();
    if (!is_file($indexPath) || !is_readable($indexPath)) return null;
    $feedSignature = gtfs_feed_signature(gtfs_server_zip_path());
    try {
        $pdo = new PDO('sqlite:' . $indexPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $meta = $pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
        $agencyFingerprint = strval($meta['agency_fingerprint'] ?? '');
        if (($meta['schema_version'] ?? '') !== '3'
            || (int)($meta['feed_size'] ?? -1) !== $feedSignature['size']
            || (int)($meta['feed_mtime'] ?? -1) !== $feedSignature['mtime']
            || $agencyFingerprint === ''
            || ($meta['index_fingerprint'] ?? '') !== gtfs_index_fingerprint($feedSignature, $agencyFingerprint)) {
            return null;
        }
        return $pdo;
    } catch (Throwable $error) {
        return null;
    }
}

function gtfs_read_index_variants(string $routeId): ?array {
    $pdo = gtfs_open_valid_index();
    if (!$pdo) return null;
    $statement = $pdo->prepare('SELECT * FROM variants WHERE route_id = ? ORDER BY direction_id, trip_headsign, start_stop_name, end_stop_name');
    $statement->execute([$routeId]);
    $variants = [];
    while ($row = $statement->fetch()) {
        $items = json_decode(strval($row['stops_json']), true);
        $viaStops = json_decode(strval($row['via_stops_json']), true);
        if (!is_array($items)) continue;
        $variants[] = [
            'id' => $row['variant_id'],
            'name' => trim(strval($row['trip_headsign'])) !== '' ? $row['trip_headsign'] : $row['end_stop_name'],
            'directionId' => $row['direction_id'],
            'headsign' => $row['trip_headsign'],
            'stopCount' => (int)$row['stop_count'],
            'variantKey' => $row['signature'],
            'startStop' => $row['start_stop_name'],
            'destination' => $row['end_stop_name'],
            'viaStops' => is_array($viaStops) ? $viaStops : [],
            'routeShortName' => $row['route_short_name'],
            'routeLongName' => $row['route_long_name'],
            'agencyName' => $row['agency_name'],
            'routeType' => $row['route_type'],
            'routeTypeLabel' => gtfs_route_type_label(strval($row['route_type'])),
            'items' => $items,
        ];
    }
    return $variants ?: null;
}

function gtfs_session_uses_server_source(string $dir): bool {
    $source = json_decode(strval(@file_get_contents($dir . DIRECTORY_SEPARATOR . 'source.json')), true);
    return is_array($source) && ($source['type'] ?? '') === 'server';
}

function gtfs_index_job_path(): string {
    return gtfs_index_dir() . DIRECTORY_SEPARATOR . 'index_job.json';
}

function gtfs_index_building_path(): string {
    return gtfs_index_dir() . DIRECTORY_SEPARATOR . 'variants.building.sqlite';
}

function gtfs_index_extracted_dir(): string {
    return gtfs_index_dir() . DIRECTORY_SEPARATOR . 'extracted';
}

function gtfs_read_index_job(): ?array {
    $job = json_decode(strval(@file_get_contents(gtfs_index_job_path())), true);
    return is_array($job) ? $job : null;
}

function gtfs_write_index_job(array $job): void {
    $json = json_encode($job, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || @file_put_contents(gtfs_index_job_path(), $json, LOCK_EX) === false) {
        gtfs_error(500, 'GTFS-Indexfortschritt kann nicht gespeichert werden.');
    }
}

function gtfs_clear_index_job_files(): void {
    foreach ([gtfs_index_job_path(), gtfs_index_building_path(), gtfs_index_building_path() . '-journal'] as $file) {
        if (is_file($file)) @unlink($file);
    }
    $extractedDir = gtfs_index_extracted_dir();
    if (is_dir($extractedDir)) {
        foreach (glob($extractedDir . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
            if (is_file($file)) @unlink($file);
        }
        @rmdir($extractedDir);
    }
}

function gtfs_create_batch_schema(PDO $pdo): void {
    $pdo->exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE;');
    $pdo->exec('PRAGMA auto_vacuum=FULL; VACUUM;');
    $pdo->exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE agencies (agency_id TEXT PRIMARY KEY, agency_name TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE routes (route_id TEXT PRIMARY KEY, agency_id TEXT, short_name TEXT, long_name TEXT, route_type TEXT)');
    $pdo->exec('CREATE TABLE stops (stop_pk INTEGER PRIMARY KEY, stop_id TEXT NOT NULL UNIQUE, stop_name TEXT, lat REAL, lon REAL, parent_station TEXT)');
    $pdo->exec('CREATE TABLE trips (trip_pk INTEGER PRIMARY KEY, trip_id TEXT NOT NULL UNIQUE, route_id TEXT NOT NULL, direction_id TEXT, headsign TEXT)');
    $pdo->exec('CREATE TABLE stop_times (
        trip_pk INTEGER NOT NULL, stop_sequence INTEGER NOT NULL, stop_pk INTEGER NOT NULL,
        PRIMARY KEY (trip_pk, stop_sequence)
    ) WITHOUT ROWID');
    $pdo->exec('CREATE TABLE variants (
        route_id TEXT NOT NULL, variant_id TEXT NOT NULL, signature TEXT NOT NULL, direction_id TEXT,
        trip_headsign TEXT, stop_count INTEGER NOT NULL, start_stop_name TEXT, end_stop_name TEXT,
        via_stops_json TEXT NOT NULL, stops_json TEXT NOT NULL,
        route_short_name TEXT, route_long_name TEXT, agency_name TEXT, route_type TEXT,
        PRIMARY KEY (route_id, variant_id)
    ) WITHOUT ROWID');
}

function gtfs_sqlite_diagnostics(PDO $pdo, string $label, ?string $databasePath = null): array {
    $pageCount = (int)$pdo->query('PRAGMA page_count')->fetchColumn();
    $pageSize = (int)$pdo->query('PRAGMA page_size')->fetchColumn();
    $freePages = (int)$pdo->query('PRAGMA freelist_count')->fetchColumn();
    $tempStore = (int)$pdo->query('PRAGMA temp_store')->fetchColumn();
    $objectBytes = [];
    $objectBytesError = null;
    try {
        $rows = $pdo->query('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $objectBytes[strval($row['name'])] = (int)$row['bytes'];
        }
    } catch (Throwable $error) {
        $objectBytesError = 'SQLite dbstat nicht verfuegbar: ' . $error->getMessage();
    }
    $indexes = [];
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $table) {
        $quotedTable = str_replace("'", "''", strval($table));
        foreach ($pdo->query("PRAGMA index_list('{$quotedTable}')")->fetchAll(PDO::FETCH_ASSOC) as $index) {
            $indexes[] = [
                'table' => strval($table),
                'name' => strval($index['name'] ?? ''),
                'unique' => (bool)($index['unique'] ?? false),
                'origin' => strval($index['origin'] ?? ''),
            ];
        }
    }
    $databasePath = $databasePath ?? gtfs_index_building_path();
    clearstatcache(true, $databasePath);
    $diagnostics = [
        'label' => $label,
        'fileBytes' => (int)@filesize($databasePath),
        'pageCount' => $pageCount,
        'pageSize' => $pageSize,
        'freePages' => $freePages,
        'databaseBytes' => $pageCount * $pageSize,
        'tempStore' => $tempStore,
        'tempStoreLabel' => [0 => 'DEFAULT', 1 => 'FILE', 2 => 'MEMORY'][$tempStore] ?? strval($tempStore),
        'objectBytes' => $objectBytes,
        'objectBytesError' => $objectBytesError,
        'indexes' => $indexes,
        'recordedAt' => date('c'),
    ];
    @file_put_contents(
        gtfs_index_dir() . DIRECTORY_SEPARATOR . 'index_diagnostics.log',
        json_encode($diagnostics, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
    error_log('GTFS SQLite: ' . json_encode($diagnostics, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return $diagnostics;
}

function gtfs_analyze_server_index(): void {
    gtfs_require_sqlite();
    $buildingPath = gtfs_index_building_path();
    $finalPath = gtfs_index_path();
    $databasePath = is_file($buildingPath) ? $buildingPath : $finalPath;
    if (!is_file($databasePath) || !is_readable($databasePath)) {
        gtfs_error(404, 'Kein GTFS-Turboindex und keine abgebrochene Building-Datei gefunden.');
    }

    $pdo = new PDO('sqlite:' . $databasePath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; PRAGMA temp_store=FILE;');
    $hasVariants = (int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'variants'")->fetchColumn() > 0;
    if (!$hasVariants) gtfs_error(422, 'SQLite-Datei enthält keine Variantentabelle.');

    $summary = $pdo->query('SELECT
        COUNT(*) AS variant_count,
        COUNT(DISTINCT signature) AS unique_stop_sequences,
        AVG(stop_count) AS average_stop_count,
        AVG(LENGTH(stops_json)) AS average_stops_json_bytes,
        SUM(LENGTH(stops_json)) AS total_stops_json_bytes,
        COUNT(DISTINCT route_id) AS route_count
        FROM variants')->fetch();
    $duplicateKeyGroups = (int)$pdo->query('SELECT COUNT(*) FROM (
        SELECT route_id, direction_id, signature
        FROM variants
        GROUP BY route_id, direction_id, signature
        HAVING COUNT(*) > 1
    )')->fetchColumn();
    $variantsByAgency = $pdo->query('SELECT
        COALESCE(NULLIF(agency_name, ""), "Betreiber unbekannt") AS agency_name,
        COUNT(*) AS variant_count,
        COUNT(DISTINCT route_id) AS route_count
        FROM variants
        GROUP BY COALESCE(NULLIF(agency_name, ""), "Betreiber unbekannt")
        ORDER BY variant_count DESC, agency_name')->fetchAll();
    $variantsByRoute = $pdo->query('SELECT route_id, COUNT(*) AS variant_count
        FROM variants
        GROUP BY route_id
        ORDER BY variant_count DESC, route_id')->fetchAll();
    $topRoutes = $pdo->query('SELECT route_id, route_short_name, route_long_name, agency_name, route_type,
        COUNT(*) AS variant_count,
        COUNT(DISTINCT signature) AS unique_stop_sequences,
        AVG(stop_count) AS average_stop_count,
        SUM(LENGTH(stops_json)) AS stops_json_bytes
        FROM variants
        GROUP BY route_id
        ORDER BY variant_count DESC, route_id
        LIMIT 20')->fetchAll();

    $job = gtfs_read_index_job();
    $tripsProcessed = (int)($job['tripsProcessed'] ?? 0);
    $tripCount = null;
    $hasTrips = (int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'trips'")->fetchColumn() > 0;
    if ($hasTrips) $tripCount = (int)$pdo->query('SELECT COUNT(*) FROM trips')->fetchColumn();
    $diagnostics = gtfs_sqlite_diagnostics($pdo, 'manual_index_analysis', $databasePath);
    $pdo = null;

    gtfs_reply([
        'ok' => true,
        'source' => $databasePath === $buildingPath ? 'building' : 'final',
        'databaseFile' => basename($databasePath),
        'summary' => [
            'variantCount' => (int)($summary['variant_count'] ?? 0),
            'uniqueStopSequences' => (int)($summary['unique_stop_sequences'] ?? 0),
            'routeCount' => (int)($summary['route_count'] ?? 0),
            'averageStopCount' => round((float)($summary['average_stop_count'] ?? 0), 2),
            'averageStopsJsonBytes' => round((float)($summary['average_stops_json_bytes'] ?? 0), 2),
            'totalStopsJsonBytes' => (int)($summary['total_stops_json_bytes'] ?? 0),
            'duplicateVariantKeyGroups' => $duplicateKeyGroups,
            'tripsProcessed' => $tripsProcessed,
            'tripCount' => $tripCount,
            'approximateCollapsedTrips' => max(0, $tripsProcessed - (int)($summary['variant_count'] ?? 0)),
        ],
        'deduplication' => [
            'key' => 'route_id + direction_id + SHA1(vollständige Stop-ID-Sequenz)',
            'hashInput' => 'Nur die Stop-IDs in stop_sequence-Reihenfolge; keine trip_id, Zeiten oder Headsign.',
            'headsignAffectsIdentity' => false,
        ],
        'variantsByAgency' => $variantsByAgency,
        'variantsByRoute' => $variantsByRoute,
        'topRoutes' => $topRoutes,
        'sqlite' => $diagnostics,
    ]);
}

function gtfs_start_index_job(bool $restart, array $requestedAgencyIds): void {
    gtfs_require_sqlite();
    $agencyIds = gtfs_normalize_agency_ids($requestedAgencyIds);
    if (!$agencyIds) gtfs_error(400, 'Bitte mindestens einen Betreiber für den GTFS-Index auswählen.');
    $zipPath = gtfs_server_zip_path();
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) gtfs_error(422, 'Server-GTFS-ZIP kann nicht geöffnet werden.');
    $availableAgencies = gtfs_read_agencies($zip);
    $zip->close();
    $unknownAgencyIds = array_values(array_filter($agencyIds, static fn(string $id): bool => !array_key_exists($id, $availableAgencies)));
    if ($unknownAgencyIds) gtfs_error(400, 'Unbekannte Betreiber-ID für GTFS-Index: ' . $unknownAgencyIds[0]);
    $agencyFingerprint = gtfs_agency_fingerprint($agencyIds);
    $existing = gtfs_read_index_job();
    if ($existing && !$restart) {
        if ((int)($existing['version'] ?? 0) !== 3
            || ($existing['agencyFingerprint'] ?? '') !== $agencyFingerprint) {
            gtfs_error(409, 'Vorhandener GTFS-Indexjob passt nicht zur Betreiber-Auswahl oder verwendet ein altes Schema und muss neu gestartet werden.');
        }
        gtfs_reply(['ok' => true, 'job' => $existing, 'resumed' => true]);
    }
    $indexDir = gtfs_index_dir();
    if (!is_dir($indexDir) && !mkdir($indexDir, 0700, true)) {
        gtfs_error(500, 'GTFS-Indexverzeichnis kann nicht erstellt werden.');
    }
    $lock = @fopen($indexDir . DIRECTORY_SEPARATOR . 'index_job.lock', 'c+');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        gtfs_error(409, 'Ein GTFS-Indexschritt läuft bereits; Neustart ist momentan nicht möglich.');
    }
    gtfs_clear_index_job_files();
    $extractedDir = gtfs_index_extracted_dir();
    if (!mkdir($extractedDir, 0700, true)) gtfs_error(500, 'GTFS-Extraktionsverzeichnis kann nicht erstellt werden.');

    $pdo = new PDO('sqlite:' . gtfs_index_building_path(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA temp_store=FILE');
    gtfs_create_batch_schema($pdo);
    $pdo = null;
    $signature = gtfs_feed_signature($zipPath);
    $job = [
        'version' => 3,
        'phase' => 'extract',
        'step' => 'ZIP-Dateien vorbereiten',
        'feedSize' => $signature['size'],
        'feedMtime' => $signature['mtime'],
        'agencyIds' => $agencyIds,
        'agencyCount' => count($agencyIds),
        'agencyFingerprint' => $agencyFingerprint,
        'indexFingerprint' => gtfs_index_fingerprint($signature, $agencyFingerprint),
        'extractIndex' => 0,
        'importFileIndex' => 0,
        'fileOffset' => 0,
        'headers' => [],
        'rowsRead' => 0,
        'stopTimeRows' => 0,
        'routeRows' => 0,
        'tripRows' => 0,
        'variantsFound' => 0,
        'lastTripId' => '',
        'startedAt' => date('c'),
    ];
    gtfs_write_index_job($job);
    flock($lock, LOCK_UN);
    fclose($lock);
    gtfs_reply(['ok' => true, 'job' => $job, 'resumed' => false]);
}

function gtfs_extract_index_file(array $job): array {
    $files = ['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'];
    $index = (int)($job['extractIndex'] ?? 0);
    if ($index >= count($files)) {
        $job['phase'] = 'import';
        $job['step'] = 'Tabellen importieren';
        return $job;
    }
    $fileName = $files[$index];
    $zip = new ZipArchive();
    if ($zip->open(gtfs_server_zip_path()) !== true) gtfs_error(422, 'GTFS-ZIP kann nicht geöffnet werden.');
    $entry = gtfs_find_zip_entry($zip, $fileName);
    if ($entry === null) gtfs_error(422, 'GTFS-ZIP enthält ' . $fileName . ' nicht.');
    $input = $zip->getStream($entry);
    $output = @fopen(gtfs_index_extracted_dir() . DIRECTORY_SEPARATOR . $fileName, 'wb');
    if (!$input || !$output) gtfs_error(500, 'GTFS-Datei kann nicht extrahiert werden: ' . $fileName);
    stream_copy_to_stream($input, $output);
    fclose($input);
    fclose($output);
    $zip->close();
    $job['extractIndex'] = $index + 1;
    $job['step'] = $fileName . ' extrahiert';
    if ($job['extractIndex'] >= count($files)) {
        $job['phase'] = 'import';
        $job['step'] = 'Tabellen importieren';
    }
    return $job;
}

function gtfs_import_index_rows(array $job, int $batchSize): array {
    $files = ['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'];
    $fileIndex = (int)($job['importFileIndex'] ?? 0);
    if ($fileIndex >= count($files)) {
        $job['phase'] = 'prepare';
        $job['step'] = 'SQLite-Indizes vorbereiten';
        return $job;
    }
    $fileName = $files[$fileIndex];
    $path = gtfs_index_extracted_dir() . DIRECTORY_SEPARATOR . $fileName;
    $handle = @fopen($path, 'rb');
    if (!$handle) gtfs_error(500, 'Extrahierte GTFS-Datei fehlt: ' . $fileName);
    $offset = (int)($job['fileOffset'] ?? 0);
    $headers = $job['headers'][$fileName] ?? null;
    if ($offset === 0) {
        $headers = fgetcsv($handle);
        if (!is_array($headers)) gtfs_error(422, $fileName . ' ist leer.');
        $headers = array_map(static fn($value): string => trim(preg_replace('/^\xEF\xBB\xBF/', '', strval($value))), $headers);
        $job['headers'][$fileName] = $headers;
        $offset = (int)ftell($handle);
    } else {
        fseek($handle, $offset, SEEK_SET);
    }

    $pdo = new PDO('sqlite:' . gtfs_index_building_path(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $statements = [
        'agency.txt' => $pdo->prepare('INSERT OR REPLACE INTO agencies VALUES (?, ?)'),
        'routes.txt' => $pdo->prepare('INSERT OR REPLACE INTO routes VALUES (?, ?, ?, ?, ?)'),
        'stops.txt' => $pdo->prepare('INSERT OR IGNORE INTO stops(stop_id, stop_name, lat, lon, parent_station) VALUES (?, ?, ?, ?, ?)'),
        'trips.txt' => $pdo->prepare('INSERT OR IGNORE INTO trips(trip_id, route_id, direction_id, headsign)
            SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM routes WHERE route_id = ?)'),
        'stop_times.txt' => $pdo->prepare('INSERT OR REPLACE INTO stop_times(trip_pk, stop_sequence, stop_pk)
            SELECT t.trip_pk, ?, s.stop_pk FROM trips t, stops s WHERE t.trip_id = ? AND s.stop_id = ?'),
    ];
    $statement = $statements[$fileName];
    $selectedAgencies = array_fill_keys(gtfs_normalize_agency_ids($job['agencyIds'] ?? []), true);
    $pdo->beginTransaction();
    $processed = 0;
    while ($processed < $batchSize && ($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        if ($fileName === 'agency.txt' && isset($selectedAgencies[$row['agency_id'] ?? ''])) {
            $statement->execute([$row['agency_id'], $row['agency_name'] ?? '']);
        } elseif ($fileName === 'routes.txt'
            && ($row['route_id'] ?? '') !== ''
            && isset($selectedAgencies[$row['agency_id'] ?? ''])) {
            $statement->execute([$row['route_id'], $row['agency_id'] ?? '', $row['route_short_name'] ?? '', $row['route_long_name'] ?? '', $row['route_type'] ?? '']);
            if ($statement->rowCount() > 0) $job['routeRows']++;
        } elseif ($fileName === 'stops.txt' && ($row['stop_id'] ?? '') !== '') {
            $lat = is_numeric($row['stop_lat'] ?? '') ? (float)$row['stop_lat'] : null;
            $lon = is_numeric($row['stop_lon'] ?? '') ? (float)$row['stop_lon'] : null;
            $statement->execute([$row['stop_id'], $row['stop_name'] ?? '', $lat, $lon, $row['parent_station'] ?? '']);
        } elseif ($fileName === 'trips.txt' && ($row['trip_id'] ?? '') !== '' && ($row['route_id'] ?? '') !== '') {
            $statement->execute([$row['trip_id'], $row['route_id'], $row['direction_id'] ?? '', $row['trip_headsign'] ?? '', $row['route_id']]);
            if ($statement->rowCount() > 0) $job['tripRows']++;
        } elseif ($fileName === 'stop_times.txt'
            && ($row['trip_id'] ?? '') !== ''
            && ($row['stop_id'] ?? '') !== ''
            && is_numeric($row['stop_sequence'] ?? '')) {
            $statement->execute([(int)$row['stop_sequence'], $row['trip_id'], $row['stop_id']]);
            if ($statement->rowCount() > 0) $job['stopTimeRows']++;
        }
        $processed++;
        $job['rowsRead']++;
    }
    $pdo->commit();
    $job['fileOffset'] = (int)ftell($handle);
    $atEnd = feof($handle);
    fclose($handle);
    $pdo = null;
    $job['step'] = $fileName . ': ' . $processed . ' Zeilen verarbeitet';
    $fileSize = max(1, (int)@filesize($path));
    $job['fileProgress'] = min(100, round($job['fileOffset'] / $fileSize * 100, 1));
    if ($atEnd) {
        $job['importFileIndex'] = $fileIndex + 1;
        $job['fileOffset'] = 0;
        $job['fileProgress'] = 100;
        if ($job['importFileIndex'] >= count($files)) {
            $job['phase'] = 'prepare';
            $job['step'] = 'SQLite-Indizes vorbereiten';
        }
    }
    return $job;
}

function gtfs_prepare_batch_index(array $job): array {
    $pdo = new PDO('sqlite:' . gtfs_index_building_path(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA temp_store=FILE');
    $job['sqliteBeforePrepare'] = gtfs_sqlite_diagnostics($pdo, 'before_prepare');
    // UNIQUE(trip_id), UNIQUE(stop_id) und der WITHOUT ROWID-Primärschlüssel decken alle Batchabfragen ab.
    $job['sqliteAfterPrepare'] = gtfs_sqlite_diagnostics($pdo, 'after_prepare_no_secondary_indexes');
    $job['sqliteDiagnostics'] = $job['sqliteAfterPrepare'];
    $pdo = null;
    $job['phase'] = 'variants';
    $job['step'] = 'Varianten bilden (keine zusätzlichen Vollindizes erforderlich)';
    return $job;
}

function gtfs_build_variant_batch(array $job, int $tripBatchSize): array {
    $pdo = new PDO('sqlite:' . gtfs_index_building_path(), null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA temp_store=FILE');
    $tripQuery = $pdo->prepare('SELECT t.trip_pk, t.trip_id, t.route_id, t.direction_id, t.headsign,
        r.short_name, r.long_name, r.route_type, COALESCE(a.agency_name, "") AS agency_name
        FROM trips t
        LEFT JOIN routes r ON r.route_id = t.route_id
        LEFT JOIN agencies a ON a.agency_id = r.agency_id
        WHERE t.trip_id > ? ORDER BY t.trip_id LIMIT ?');
    $tripQuery->bindValue(1, strval($job['lastTripId'] ?? ''), PDO::PARAM_STR);
    $tripQuery->bindValue(2, $tripBatchSize, PDO::PARAM_INT);
    $tripQuery->execute();
    $trips = $tripQuery->fetchAll();
    if (!$trips) {
        $job['phase'] = 'finalize';
        $job['step'] = 'Index aktivieren';
        return $job;
    }

    $stopQuery = $pdo->prepare('SELECT s.stop_id, st.stop_sequence, COALESCE(s.stop_name, "") AS stop_name,
        CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lat ELSE p.lat END AS lat,
        CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lon ELSE p.lon END AS lon
        FROM stop_times st
        LEFT JOIN stops s ON s.stop_pk = st.stop_pk
        LEFT JOIN stops p ON p.stop_id = s.parent_station
        WHERE st.trip_pk = ? ORDER BY st.stop_sequence');
    $variantInsert = $pdo->prepare('INSERT OR IGNORE INTO variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $pdo->beginTransaction();
    $newVariants = 0;
    foreach ($trips as $trip) {
        $stopQuery->execute([(int)$trip['trip_pk']]);
        $items = [];
        $stopIds = [];
        $stopNames = [];
        $lats = [];
        $lons = [];
        while ($stop = $stopQuery->fetch()) {
            $stopIds[] = $stop['stop_id'];
            $stopNames[] = $stop['stop_name'];
            $lats[] = $stop['lat'] !== null ? (float)$stop['lat'] : null;
            $lons[] = $stop['lon'] !== null ? (float)$stop['lon'] : null;
            $items[] = [
                'stopId' => $stop['stop_id'],
                'sequence' => (int)$stop['stop_sequence'],
                'name' => $stop['stop_name'],
                'lat' => $stop['lat'] !== null ? (float)$stop['lat'] : null,
                'lon' => $stop['lon'] !== null ? (float)$stop['lon'] : null,
            ];
        }
        if (count($stopIds) >= 2) {
            $signature = sha1(implode('>', $stopIds));
            $variantId = strval($trip['direction_id']) . '|' . $signature;
            $variantInsert->execute([
                $trip['route_id'], $variantId, $signature, $trip['direction_id'], $trip['headsign'], count($stopIds),
                $stopNames[0] ?? '', $stopNames[count($stopNames) - 1] ?? '',
                json_encode(gtfs_via_names($stopNames), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $trip['short_name'], $trip['long_name'], $trip['agency_name'], $trip['route_type'],
            ]);
            $newVariants += $variantInsert->rowCount() > 0 ? 1 : 0;
        }
        $job['lastTripId'] = $trip['trip_id'];
    }
    $pdo->commit();
    $pdo = null;
    $job['variantsFound'] = (int)($job['variantsFound'] ?? 0) + $newVariants;
    $job['tripsProcessed'] = (int)($job['tripsProcessed'] ?? 0) + count($trips);
    $job['step'] = count($trips) . ' Trips geprüft, ' . $newVariants . ' neue Varianten';
    if (count($trips) < $tripBatchSize) {
        $job['phase'] = 'finalize';
        $job['step'] = 'Index aktivieren';
    }
    return $job;
}

function gtfs_finalize_batch_index(array $job): array {
    if (!is_file(gtfs_index_building_path())) {
        $existingIndex = gtfs_open_valid_index();
        if ($existingIndex) {
            $job['phase'] = 'done';
            $job['step'] = 'Turboindex fertig';
            $job['variantsFound'] = (int)$existingIndex->query('SELECT COUNT(*) FROM variants')->fetchColumn();
            $job['finishedAt'] = date('c');
            return $job;
        }
        gtfs_error(500, 'GTFS-Zwischenindex fehlt und konnte nicht wiederhergestellt werden.');
    }
    $pdo = new PDO('sqlite:' . gtfs_index_building_path(), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA temp_store=FILE');
    $metaInsert = $pdo->prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
    foreach ([
        'schema_version' => '3',
        'feed_size' => $job['feedSize'],
        'feed_mtime' => $job['feedMtime'],
        'agency_ids' => json_encode($job['agencyIds'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'agency_fingerprint' => $job['agencyFingerprint'],
        'index_fingerprint' => $job['indexFingerprint'],
        'created_at' => date('c'),
        'stop_time_rows' => $job['stopTimeRows'],
    ] as $key => $value) {
        $metaInsert->execute([$key, strval($value)]);
    }
    $variantCount = (int)$pdo->query('SELECT COUNT(*) FROM variants')->fetchColumn();
    $job['sqliteBeforeCleanup'] = gtfs_sqlite_diagnostics($pdo, 'before_staging_cleanup');
    $pdo->exec('DROP TABLE stop_times; DROP TABLE trips; DROP TABLE stops;');
    $job['sqliteAfterCleanup'] = gtfs_sqlite_diagnostics($pdo, 'after_staging_cleanup');
    $job['sqliteDiagnostics'] = $job['sqliteAfterCleanup'];
    unset($metaInsert);
    $pdo = null;

    $finalPath = gtfs_index_path();
    $backupPath = $finalPath . '.previous';
    @unlink($backupPath);
    if (is_file($finalPath) && !@rename($finalPath, $backupPath)) {
        gtfs_error(500, 'Alter GTFS-Index kann nicht für Austausch vorbereitet werden.');
    }
    if (!@rename(gtfs_index_building_path(), $finalPath)) {
        if (is_file($backupPath)) @rename($backupPath, $finalPath);
        gtfs_error(500, 'Neuer GTFS-Index kann nicht aktiviert werden.');
    }
    @unlink($backupPath);
    foreach (glob(gtfs_index_extracted_dir() . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
        if (is_file($file)) @unlink($file);
    }
    @rmdir(gtfs_index_extracted_dir());
    $job['phase'] = 'done';
    $job['step'] = 'Turboindex fertig';
    $job['variantsFound'] = $variantCount;
    $job['finishedAt'] = date('c');
    return $job;
}

function gtfs_run_index_step(): void {
    gtfs_require_sqlite();
    $job = gtfs_read_index_job();
    if (!$job) gtfs_error(404, 'Kein GTFS-Indexjob vorhanden.');
    $signature = gtfs_feed_signature(gtfs_server_zip_path());
    if ((int)$job['feedSize'] !== $signature['size'] || (int)$job['feedMtime'] !== $signature['mtime']) {
        gtfs_error(409, 'latest.zip wurde während der Indexierung geändert. Job bitte neu starten.');
    }
    $lock = @fopen(gtfs_index_dir() . DIRECTORY_SEPARATOR . 'index_job.lock', 'c+');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) gtfs_error(409, 'Ein Indexschritt läuft bereits.');
    try {
        $phase = strval($job['phase'] ?? '');
        if ($phase === 'extract') $job = gtfs_extract_index_file($job);
        elseif ($phase === 'import') $job = gtfs_import_index_rows($job, 50000);
        elseif ($phase === 'prepare') $job = gtfs_prepare_batch_index($job);
        elseif ($phase === 'variants') $job = gtfs_build_variant_batch($job, 500);
        elseif ($phase === 'finalize') $job = gtfs_finalize_batch_index($job);
        elseif ($phase !== 'done') gtfs_error(409, 'Unbekannter GTFS-Indexjob-Status.');
        gtfs_write_index_job($job);
        flock($lock, LOCK_UN);
        fclose($lock);
        gtfs_reply(['ok' => true, 'job' => $job, 'done' => $job['phase'] === 'done']);
    } catch (Throwable $error) {
        flock($lock, LOCK_UN);
        fclose($lock);
        throw $error;
    }
}

function gtfs_index_job_status(): void {
    $job = gtfs_read_index_job();
    gtfs_reply(['ok' => true, 'job' => $job, 'active' => is_array($job) && ($job['phase'] ?? '') !== 'done']);
}

function gtfs_open_session_zip(string $dir): ZipArchive {
    $sourcePath = $dir . DIRECTORY_SEPARATOR . 'source.json';
    $source = json_decode(strval(@file_get_contents($sourcePath)), true);
    if (!is_array($source)) gtfs_error(410, 'GTFS-Sitzung ist unvollständig. Quelle bitte erneut laden.');

    $zipPath = ($source['type'] ?? '') === 'session'
        ? $dir . DIRECTORY_SEPARATOR . 'feed.zip'
        : gtfs_server_zip_path();
    if (!is_file($zipPath) || !is_readable($zipPath)) {
        gtfs_error(410, 'GTFS-Quelldatei der Sitzung ist nicht mehr verfügbar.');
    }
    if ((int)@filesize($zipPath) !== (int)($source['size'] ?? -1)
        || (int)@filemtime($zipPath) !== (int)($source['mtime'] ?? -1)) {
        gtfs_error(409, 'GTFS-Quelldatei wurde während der Auswahl geändert. Bitte neu laden.');
    }

    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) gtfs_error(422, 'GTFS-ZIP kann nicht erneut geöffnet werden.');
    return $zip;
}

function gtfs_handle_server_zip(): void {
    gtfs_start_session(gtfs_server_zip_path(), false, 'Server gtfs/data/gtfs/latest.zip');
}

function gtfs_handle_index_agencies(): void {
    $zip = new ZipArchive();
    if ($zip->open(gtfs_server_zip_path()) !== true) gtfs_error(422, 'Server-GTFS-ZIP kann nicht geöffnet werden.');
    $agencies = gtfs_read_agency_options($zip);
    $zip->close();
    gtfs_reply(['ok' => true, 'agencies' => $agencies, 'agencyCount' => count($agencies)]);
}

function gtfs_handle_route_filter(string $dir): void {
    $agencyIds = json_decode(strval($_POST['agencyIds'] ?? '[]'), true);
    if (!is_array($agencyIds)) gtfs_error(400, 'agencyIds muss eine JSON-Liste sein.');
    $agencyIds = array_values(array_unique(array_filter(array_map('strval', $agencyIds), static fn(string $id): bool => $id !== '')));
    if (!$agencyIds) gtfs_error(400, 'Bitte mindestens einen Betreiber auswählen.');
    $selection = [
        'agencyIds' => $agencyIds,
        'search' => trim(strval($_POST['search'] ?? '')),
    ];

    $zip = gtfs_open_session_zip($dir);
    $routes = gtfs_read_routes($zip, [
        'agencyIds' => $agencyIds,
        'search' => $selection['search'],
        'regionFilter' => 'all',
    ]);
    $zip->close();

    $routesJson = json_encode($routes, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $selectionJson = json_encode($selection, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($routesJson === false || $selectionJson === false
        || @file_put_contents($dir . DIRECTORY_SEPARATOR . 'routes.json', $routesJson) === false
        || @file_put_contents($dir . DIRECTORY_SEPARATOR . 'selection.json', $selectionJson) === false) {
        gtfs_error(500, 'GTFS-Betreiber- und Linienauswahl kann nicht temporär gespeichert werden.');
    }
    gtfs_reply([
        'ok' => true,
        'routes' => $routes,
        'routeCount' => count($routes),
        'selection' => $selection,
    ]);
}

function gtfs_load_listed_route(string $dir, string $routeId): array {
    $routes = json_decode(strval(@file_get_contents($dir . DIRECTORY_SEPARATOR . 'routes.json')), true);
    if (!is_array($routes)) gtfs_error(410, 'Gefilterte GTFS-Linienliste ist nicht mehr verfügbar.');
    foreach ($routes as $route) {
        if (is_array($route) && ($route['id'] ?? '') === $routeId) return $route;
    }
    gtfs_error(404, 'Gewählte Linie gehört nicht zur gefilterten GTFS-Linienliste.');
}

function gtfs_variant_cache_path(string $dir, string $routeId): string {
    return $dir . DIRECTORY_SEPARATOR . 'variants_' . sha1($routeId) . '.json';
}

function gtfs_source_fingerprint(string $dir): string {
    $source = json_decode(strval(@file_get_contents($dir . DIRECTORY_SEPARATOR . 'source.json')), true);
    if (!is_array($source)) gtfs_error(410, 'GTFS-Sitzungsquelle ist nicht mehr verfügbar.');
    return hash('sha256', implode('|', [
        strval($source['type'] ?? ''),
        strval($source['label'] ?? ''),
        strval($source['size'] ?? ''),
        strval($source['mtime'] ?? ''),
    ]));
}

function gtfs_save_variants(string $dir, string $routeId, array $variants): void {
    $payload = json_encode([
        'routeId' => $routeId,
        'sourceFingerprint' => gtfs_source_fingerprint($dir),
        'variants' => $variants,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false || @file_put_contents(gtfs_variant_cache_path($dir, $routeId), $payload) === false) {
        gtfs_error(500, 'GTFS-Varianten können nicht temporär gespeichert werden.');
    }
}

function gtfs_read_cached_variants(string $dir, string $routeId): ?array {
    $cachePath = gtfs_variant_cache_path($dir, $routeId);
    if (!is_file($cachePath)) return null;
    $payload = json_decode(strval(@file_get_contents($cachePath)), true);
    if (!is_array($payload)
        || ($payload['routeId'] ?? '') !== $routeId
        || ($payload['sourceFingerprint'] ?? '') !== gtfs_source_fingerprint($dir)
        || !is_array($payload['variants'] ?? null)) {
        @unlink($cachePath);
        return null;
    }
    return $payload['variants'];
}

function gtfs_public_variants(array $variants): array {
    return array_map(static function (array $variant): array {
        unset($variant['items']);
        return $variant;
    }, $variants);
}

function gtfs_load_variant(string $dir, string $routeId, string $variantId): array {
    $variants = gtfs_read_cached_variants($dir, $routeId);
    if ($variants === null) {
        gtfs_error(409, 'Varianten für diese GTFS-Linie müssen neu geladen werden.');
    }
    foreach ($variants as $variant) {
        if (is_array($variant) && ($variant['id'] ?? '') === $variantId) return $variant;
    }
    gtfs_error(404, 'Gewählte GTFS-Variante wurde nicht gefunden.');
}

try {
    $action = strtolower(trim(strval($_POST['action'] ?? 'upload')));
    if ($action === 'upload') gtfs_handle_upload();
    if ($action === 'server') gtfs_handle_server_zip();
    if ($action === 'indexagencies') gtfs_handle_index_agencies();
    if ($action === 'indexstatus') gtfs_index_job_status();
    if ($action === 'indexanalyze') gtfs_analyze_server_index();
    if ($action === 'indexstart') {
        $agencyIds = json_decode(strval($_POST['agencyIds'] ?? '[]'), true);
        if (!is_array($agencyIds)) gtfs_error(400, 'agencyIds muss eine JSON-Liste sein.');
        gtfs_start_index_job(($_POST['restart'] ?? '') === '1', $agencyIds);
    }
    if ($action === 'indexstep') gtfs_run_index_step();
    $token = trim(strval($_POST['token'] ?? ''));
    $dir = gtfs_session_dir($token);
    if ($action === 'routes') gtfs_handle_route_filter($dir);
    if ($action === 'variants') {
        $routeId = trim(strval($_POST['routeId'] ?? ''));
        if ($routeId === '') gtfs_error(400, 'routeId fehlt.');
        $route = gtfs_load_listed_route($dir, $routeId);
        $zip = gtfs_open_session_zip($dir);
        $variants = gtfs_read_cached_variants($dir, $routeId);
        $fromCache = $variants !== null;
        $fromTurboIndex = false;
        if (!$fromCache && gtfs_session_uses_server_source($dir)) {
            $variants = gtfs_read_index_variants($routeId);
            $fromTurboIndex = $variants !== null;
            if ($fromTurboIndex) gtfs_save_variants($dir, $routeId, $variants);
        }
        if ($variants === null) {
            $variants = gtfs_build_variants($zip, $routeId, $route);
            gtfs_save_variants($dir, $routeId, $variants);
        }
        $zip->close();
        $publicVariants = gtfs_public_variants($variants);
        gtfs_reply([
            'ok' => true,
            'variants' => $publicVariants,
            'variantCount' => count($publicVariants),
            'fromCache' => $fromCache || $fromTurboIndex,
            'fromTurboIndex' => $fromTurboIndex,
        ]);
    }
    if ($action === 'import') {
        $routeId = trim(strval($_POST['routeId'] ?? ''));
        $variantId = trim(strval($_POST['variantId'] ?? $_POST['tripId'] ?? ''));
        if ($routeId === '' || $variantId === '') gtfs_error(400, 'routeId oder variantId fehlt.');
        $variant = gtfs_load_variant($dir, $routeId, $variantId);
        $items = is_array($variant['items'] ?? null) ? $variant['items'] : [];
        if (count($items) < 2) gtfs_error(422, 'GTFS-Variante enthält weniger als zwei nutzbare Stops.');
        $zip = null;
        $stopData = [];
        $hasEmbeddedStops = array_key_exists('name', $items[0])
            && array_key_exists('lat', $items[0])
            && array_key_exists('lon', $items[0]);
        if ($hasEmbeddedStops) {
            foreach ($items as $item) {
                $stopId = strval($item['stopId'] ?? '');
                if ($stopId === '' || !is_numeric($item['lat'] ?? null) || !is_numeric($item['lon'] ?? null)) continue;
                $stopData[$stopId] = [
                    'name' => strval($item['name'] ?? $stopId),
                    'lat' => (float)$item['lat'],
                    'lon' => (float)$item['lon'],
                    'coordinateSource' => 'turbo_index',
                ];
            }
        } else {
            $zip = gtfs_open_session_zip($dir);
            $stopData = gtfs_read_stops($zip, array_values(array_unique(array_column($items, 'stopId'))));
        }
        $editorStops = [];
        $skippedStopCount = 0;
        $parentCoordinateCount = 0;
        foreach ($items as $item) {
            $stopId = $item['stopId'];
            if (!isset($stopData[$stopId])) {
                $skippedStopCount++;
                continue;
            }
            $data = $stopData[$stopId];
            if (($data['coordinateSource'] ?? '') === 'parent_station') $parentCoordinateCount++;
            $editorStops[] = [
                'id' => 'stop_' . (count($editorStops) + 1),
                'stopId' => $stopId,
                'catalogId' => $stopId,
                'name' => $data['name'],
                'lat' => round($data['lat'], 6),
                'lon' => round($data['lon'], 6),
                'stopSequence' => $item['sequence'],
                'order' => $item['sequence'],
                'sourceType' => 'catalog',
                'note' => '',
                'isGhostPoint' => false,
            ];
        }
        if (count($editorStops) < 2) gtfs_error(422, 'Stopkoordinaten der Variante sind unvollständig.');
        if ($zip) $zip->close();
        $route = gtfs_load_listed_route($dir, $routeId);
        $lineName = trim(strval($route['shortName'] ?? '')) ?: trim(strval($route['name'] ?? $routeId));
        $direction = trim(strval($variant['headsign'] ?? '')) ?: ($editorStops[0]['name'] . ' – ' . $editorStops[count($editorStops) - 1]['name']);
        $line = [
            'lineName' => 'Linie ' . preg_replace('/^Linie\s+/i', '', $lineName),
            'routeName' => 'Route 01',
            'directionName' => $direction,
            'color' => '#d32f2f',
            'routeMode' => 'auto',
            'routingMode' => 'guidedStreet',
            'preserveManualChains' => true,
            'placementMode' => 'freeStop',
            'stops' => $editorStops,
            'routePoints' => [],
            'routePointsSimplified' => [],
            'meta' => ['source' => 'GTFS ZIP import', 'importsTimetable' => false, 'importedAt' => date('c')],
        ];
        $warnings = [];
        if ($skippedStopCount > 0) {
            $warnings[] = $skippedStopCount . ' Stops ohne gültige Koordinaten wurden übersprungen.';
        }
        gtfs_reply([
            'ok' => true,
            'line' => $line,
            'stopCount' => count($editorStops),
            'warningCount' => $skippedStopCount,
            'warnings' => $warnings,
            'parentCoordinateCount' => $parentCoordinateCount,
        ]);
    }
    gtfs_error(400, 'Unbekannte GTFS-Aktion.');
} catch (Throwable $error) {
    gtfs_error(500, 'GTFS-Import fehlgeschlagen: ' . $error->getMessage());
}
