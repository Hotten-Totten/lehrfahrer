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

function gtfs_build_persistent_index(): void {
    gtfs_require_sqlite();
    if (function_exists('set_time_limit')) @set_time_limit(0);
    $zipPath = gtfs_server_zip_path();
    $indexDir = gtfs_index_dir();
    if (!is_dir($indexDir) && !mkdir($indexDir, 0700, true)) {
        gtfs_error(500, 'GTFS-Indexverzeichnis kann nicht erstellt werden: gtfs/imports');
    }

    $lockHandle = @fopen($indexDir . DIRECTORY_SEPARATOR . 'index.lock', 'c+');
    if (!$lockHandle || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
        gtfs_error(409, 'Ein GTFS-Indexlauf ist bereits aktiv.');
    }

    $startedAt = microtime(true);
    $temporaryPath = gtfs_index_path() . '.building';
    @unlink($temporaryPath);
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) gtfs_error(422, 'Server-GTFS-ZIP kann für Indexierung nicht geöffnet werden.');

    try {
        $pdo = new PDO('sqlite:' . $temporaryPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE;');
        $pdo->exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        $pdo->exec('CREATE TABLE agencies (agency_id TEXT PRIMARY KEY, agency_name TEXT NOT NULL)');
        $pdo->exec('CREATE TABLE routes (route_id TEXT PRIMARY KEY, agency_id TEXT, short_name TEXT, long_name TEXT, route_type TEXT)');
        $pdo->exec('CREATE TABLE stops (stop_id TEXT PRIMARY KEY, stop_name TEXT, lat REAL, lon REAL, parent_station TEXT)');
        $pdo->exec('CREATE TABLE trips (trip_id TEXT PRIMARY KEY, route_id TEXT NOT NULL, direction_id TEXT, headsign TEXT)');
        $pdo->exec('CREATE TABLE stop_times (trip_id TEXT NOT NULL, stop_sequence INTEGER NOT NULL, stop_id TEXT NOT NULL)');
        $pdo->exec('CREATE TABLE variants (
            route_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            signature TEXT NOT NULL,
            direction_id TEXT,
            trip_headsign TEXT,
            stop_count INTEGER NOT NULL,
            start_stop_name TEXT,
            end_stop_name TEXT,
            via_stops_json TEXT NOT NULL,
            stop_ids_json TEXT NOT NULL,
            stop_names_json TEXT NOT NULL,
            stop_lats_json TEXT NOT NULL,
            stop_lons_json TEXT NOT NULL,
            stops_json TEXT NOT NULL,
            route_short_name TEXT,
            route_long_name TEXT,
            agency_name TEXT,
            route_type TEXT,
            PRIMARY KEY (route_id, variant_id)
        )');

        $pdo->beginTransaction();
        $agencyInsert = $pdo->prepare('INSERT OR REPLACE INTO agencies VALUES (?, ?)');
        $agencyRows = gtfs_index_import_table($zip, 'agency.txt', ['agency_id', 'agency_name'], static function (array $headers, array $values) use ($agencyInsert): void {
            $id = trim(strval($values[gtfs_header_position($headers, 'agency_id')] ?? ''));
            if ($id === '') return;
            $agencyInsert->execute([$id, trim(strval($values[gtfs_header_position($headers, 'agency_name')] ?? ''))]);
        });

        $routeInsert = $pdo->prepare('INSERT OR REPLACE INTO routes VALUES (?, ?, ?, ?, ?)');
        $routeRows = gtfs_index_import_table($zip, 'routes.txt', ['route_id'], static function (array $headers, array $values) use ($routeInsert): void {
            $row = gtfs_row($headers, $values);
            $routeId = $row['route_id'] ?? '';
            if ($routeId === '') return;
            $routeInsert->execute([$routeId, $row['agency_id'] ?? '', $row['route_short_name'] ?? '', $row['route_long_name'] ?? '', $row['route_type'] ?? '']);
        });

        $stopInsert = $pdo->prepare('INSERT OR REPLACE INTO stops VALUES (?, ?, ?, ?, ?)');
        $stopRows = gtfs_index_import_table($zip, 'stops.txt', ['stop_id', 'stop_name'], static function (array $headers, array $values) use ($stopInsert): void {
            $row = gtfs_row($headers, $values);
            $stopId = $row['stop_id'] ?? '';
            if ($stopId === '') return;
            $lat = is_numeric($row['stop_lat'] ?? '') ? (float)$row['stop_lat'] : null;
            $lon = is_numeric($row['stop_lon'] ?? '') ? (float)$row['stop_lon'] : null;
            if ($lat !== null && ($lat < -90 || $lat > 90)) $lat = null;
            if ($lon !== null && ($lon < -180 || $lon > 180)) $lon = null;
            $stopInsert->execute([$stopId, $row['stop_name'] ?? '', $lat, $lon, $row['parent_station'] ?? '']);
        });

        $tripInsert = $pdo->prepare('INSERT OR REPLACE INTO trips VALUES (?, ?, ?, ?)');
        $tripRows = gtfs_index_import_table($zip, 'trips.txt', ['trip_id', 'route_id'], static function (array $headers, array $values) use ($tripInsert): void {
            $row = gtfs_row($headers, $values);
            if (($row['trip_id'] ?? '') === '' || ($row['route_id'] ?? '') === '') return;
            $tripInsert->execute([$row['trip_id'], $row['route_id'], $row['direction_id'] ?? '', $row['trip_headsign'] ?? '']);
        });

        $stopTimeInsert = $pdo->prepare('INSERT INTO stop_times VALUES (?, ?, ?)');
        [$stopTimeHandle, $stopTimeHeaders] = gtfs_open_zip_table($zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence']);
        $tripIdIndex = gtfs_header_position($stopTimeHeaders, 'trip_id');
        $stopIdIndex = gtfs_header_position($stopTimeHeaders, 'stop_id');
        $sequenceIndex = gtfs_header_position($stopTimeHeaders, 'stop_sequence');
        $stopTimeRows = 0;
        while (($values = fgetcsv($stopTimeHandle)) !== false) {
            $tripId = trim(strval($values[$tripIdIndex] ?? ''));
            $stopId = trim(strval($values[$stopIdIndex] ?? ''));
            $sequence = $values[$sequenceIndex] ?? '';
            if ($tripId === '' || $stopId === '' || !is_numeric($sequence)) continue;
            $stopTimeInsert->execute([$tripId, (int)$sequence, $stopId]);
            $stopTimeRows++;
        }
        fclose($stopTimeHandle);
        $pdo->commit();

        $pdo->exec('CREATE INDEX idx_trips_route ON trips(route_id); CREATE INDEX idx_stop_times_trip_sequence ON stop_times(trip_id, stop_sequence);');
        $tripQuery = $pdo->query('SELECT t.trip_id, t.route_id, t.direction_id, t.headsign,
            r.short_name, r.long_name, r.route_type, COALESCE(a.agency_name, "") AS agency_name
            FROM trips t
            LEFT JOIN routes r ON r.route_id = t.route_id
            LEFT JOIN agencies a ON a.agency_id = r.agency_id
            ORDER BY t.trip_id');
        $stopQuery = $pdo->prepare('SELECT st.stop_id, st.stop_sequence, COALESCE(s.stop_name, "") AS stop_name,
            CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lat ELSE p.lat END AS lat,
            CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lon ELSE p.lon END AS lon
            FROM stop_times st
            LEFT JOIN stops s ON s.stop_id = st.stop_id
            LEFT JOIN stops p ON p.stop_id = s.parent_station
            WHERE st.trip_id = ? ORDER BY st.stop_sequence');
        $variantInsert = $pdo->prepare('INSERT OR IGNORE INTO variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

        $pdo->beginTransaction();
        foreach ($tripQuery as $trip) {
            $stopQuery->execute([$trip['trip_id']]);
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
            if (count($stopIds) < 2) continue;
            $signature = sha1(implode('>', $stopIds));
            $variantId = strval($trip['direction_id']) . '|' . $signature;
            $variantInsert->execute([
                $trip['route_id'], $variantId, $signature, $trip['direction_id'], $trip['headsign'], count($stopIds),
                $stopNames[0] ?? '', $stopNames[count($stopNames) - 1] ?? '',
                json_encode(gtfs_via_names($stopNames), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode($stopIds, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode($stopNames, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                json_encode($lats), json_encode($lons),
                json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $trip['short_name'], $trip['long_name'], $trip['agency_name'], $trip['route_type'],
            ]);
        }
        $pdo->commit();

        $signature = gtfs_feed_signature($zipPath);
        $metaInsert = $pdo->prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
        foreach ([
            'feed_size' => $signature['size'],
            'feed_mtime' => $signature['mtime'],
            'schema_version' => '1',
            'created_at' => date('c'),
            'agency_rows' => $agencyRows,
            'route_rows' => $routeRows,
            'stop_rows' => $stopRows,
            'trip_rows' => $tripRows,
            'stop_time_rows' => $stopTimeRows,
        ] as $key => $value) {
            $metaInsert->execute([$key, strval($value)]);
        }
        $variantCount = (int)$pdo->query('SELECT COUNT(*) FROM variants')->fetchColumn();
        unset(
            $agencyInsert,
            $routeInsert,
            $stopInsert,
            $tripInsert,
            $stopTimeInsert,
            $tripQuery,
            $stopQuery,
            $variantInsert,
            $metaInsert
        );
        $pdo = null;
        $zip->close();

        $finalPath = gtfs_index_path();
        $backupPath = $finalPath . '.previous';
        @unlink($backupPath);
        if (is_file($finalPath) && !@rename($finalPath, $backupPath)) {
            throw new RuntimeException('Alter GTFS-Index kann nicht für Austausch vorbereitet werden.');
        }
        if (!@rename($temporaryPath, $finalPath)) {
            if (is_file($backupPath)) @rename($backupPath, $finalPath);
            throw new RuntimeException('Neuer GTFS-Index kann nicht aktiviert werden.');
        }
        @unlink($backupPath);
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
        gtfs_reply([
            'ok' => true,
            'indexPath' => 'gtfs/imports/variants.sqlite',
            'variantCount' => $variantCount,
            'stopTimeRows' => $stopTimeRows,
            'durationSeconds' => round(microtime(true) - $startedAt, 1),
        ]);
    } catch (Throwable $error) {
        $pdo = null;
        try {
            $zip->close();
        } catch (Throwable $ignored) {
            // ZIP wurde im erfolgreichen Aufbaupfad bereits geschlossen.
        }
        @unlink($temporaryPath);
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
        throw $error;
    }
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
        if (($meta['schema_version'] ?? '') !== '1'
            || (int)($meta['feed_size'] ?? -1) !== $feedSignature['size']
            || (int)($meta['feed_mtime'] ?? -1) !== $feedSignature['mtime']) {
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
    if ($action === 'buildindex') gtfs_build_persistent_index();
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
