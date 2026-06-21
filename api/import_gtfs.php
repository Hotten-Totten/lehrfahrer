<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

const GTFS_MAX_UPLOAD_BYTES = 262144000;
const GTFS_MAX_EXTRACTED_BYTES = 1610612736;
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

function gtfs_open_table(string $path, array $requiredHeaders): array {
    $handle = @fopen($path, 'rb');
    if (!$handle) gtfs_error(500, 'GTFS-Datei kann nicht gelesen werden: ' . basename($path));
    $headers = fgetcsv($handle);
    if (!is_array($headers)) {
        fclose($handle);
        gtfs_error(422, 'GTFS-Datei ist leer: ' . basename($path));
    }
    $headers = array_map(static function ($value): string {
        return trim(preg_replace('/^\xEF\xBB\xBF/', '', strval($value)));
    }, $headers);
    foreach ($requiredHeaders as $required) {
        if (!in_array($required, $headers, true)) {
            fclose($handle);
            gtfs_error(422, basename($path) . ' enthält das Pflichtfeld ' . $required . ' nicht.');
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

function gtfs_read_routes(string $dir): array {
    [$handle, $headers] = gtfs_open_table($dir . '/routes.txt', ['route_id']);
    $routes = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        $routeId = $row['route_id'] ?? '';
        if ($routeId === '') continue;
        $routes[$routeId] = [
            'id' => $routeId,
            'name' => gtfs_route_label($row),
            'shortName' => $row['route_short_name'] ?? '',
            'longName' => $row['route_long_name'] ?? '',
            'routeType' => $row['route_type'] ?? '',
            'color' => $row['route_color'] ?? '',
        ];
        if (count($routes) > 10000) {
            fclose($handle);
            gtfs_error(413, 'GTFS enthält mehr als 10.000 Linien.');
        }
    }
    fclose($handle);
    uasort($routes, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    return array_values($routes);
}

function gtfs_read_route_trips(string $dir, string $routeId): array {
    [$handle, $headers] = gtfs_open_table($dir . '/trips.txt', ['route_id', 'trip_id']);
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

function gtfs_read_trip_sequences(string $dir, array $trips): array {
    [$handle, $headers] = gtfs_open_table($dir . '/stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence']);
    $sequences = [];
    $matchedRows = 0;
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        $tripId = $row['trip_id'] ?? '';
        if (!isset($trips[$tripId])) continue;
        $stopId = $row['stop_id'] ?? '';
        $sequenceRaw = $row['stop_sequence'] ?? '';
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

function gtfs_build_variants(string $dir, string $routeId): array {
    $trips = gtfs_read_route_trips($dir, $routeId);
    if (!$trips) return [];
    $sequences = gtfs_read_trip_sequences($dir, $trips);
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
            'id' => $tripId,
            'name' => trim(strval($trip['headsign'])) !== '' ? $trip['headsign'] : 'GTFS-Variante',
            'directionId' => $trip['directionId'],
            'headsign' => $trip['headsign'],
            'stopCount' => count($stopIds),
            'variantKey' => $signature,
        ];
    }
    $result = array_values($variants);
    usort($result, static function (array $a, array $b): int {
        $directionCompare = strnatcasecmp(strval($a['directionId']), strval($b['directionId']));
        if ($directionCompare !== 0) return $directionCompare;
        return strnatcasecmp(strval($a['name']), strval($b['name']));
    });
    return $result;
}

function gtfs_read_trip_stops(string $dir, string $tripId): array {
    [$handle, $headers] = gtfs_open_table($dir . '/stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence']);
    $items = [];
    while (($values = fgetcsv($handle)) !== false) {
        $row = gtfs_row($headers, $values);
        if (($row['trip_id'] ?? '') !== $tripId) continue;
        if (($row['stop_id'] ?? '') === '' || !is_numeric($row['stop_sequence'] ?? '')) continue;
        $items[] = ['stopId' => $row['stop_id'], 'sequence' => (int)$row['stop_sequence']];
    }
    fclose($handle);
    usort($items, static fn(array $a, array $b): int => $a['sequence'] <=> $b['sequence']);
    return $items;
}

function gtfs_valid_coordinates(array $row): bool {
    if (!is_numeric($row['stop_lat'] ?? '') || !is_numeric($row['stop_lon'] ?? '')) return false;
    $lat = (float)$row['stop_lat'];
    $lon = (float)$row['stop_lon'];
    return $lat >= -90 && $lat <= 90 && $lon >= -180 && $lon <= 180;
}

function gtfs_read_stops(string $dir, array $neededIds): array {
    [$handle, $headers] = gtfs_open_table($dir . '/stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
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
        [$parentHandle, $parentHeaders] = gtfs_open_table($dir . '/stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
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

function gtfs_handle_upload(): void {
    if (!class_exists('ZipArchive')) {
        gtfs_error(501, 'GTFS-Import benötigt PHP ZipArchive.');
    }
    $upload = $_FILES['feed'] ?? null;
    if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        gtfs_error(400, 'Keine gültige GTFS-ZIP-Datei empfangen.');
    }
    $size = (int)($upload['size'] ?? 0);
    if ($size <= 0 || $size > GTFS_MAX_UPLOAD_BYTES) {
        gtfs_error(413, 'GTFS-ZIP muss zwischen 1 Byte und 250 MB groß sein.');
    }
    $zip = new ZipArchive();
    if ($zip->open(strval($upload['tmp_name'])) !== true) {
        gtfs_error(422, 'GTFS-ZIP kann nicht geöffnet werden.');
    }
    $wanted = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'];
    $entries = [];
    $totalSize = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $stat = $zip->statIndex($i);
        if (!is_array($stat)) continue;
        $base = strtolower(basename(str_replace('\\', '/', strval($stat['name'] ?? ''))));
        if (!in_array($base, $wanted, true) || isset($entries[$base])) continue;
        $totalSize += (int)($stat['size'] ?? 0);
        $entries[$base] = strval($stat['name']);
    }
    foreach ($wanted as $required) {
        if (!isset($entries[$required])) {
            $zip->close();
            gtfs_error(422, 'GTFS-ZIP enthält ' . $required . ' nicht.');
        }
    }
    if ($totalSize > GTFS_MAX_EXTRACTED_BYTES) {
        $zip->close();
        gtfs_error(413, 'Benötigte GTFS-Dateien sind entpackt größer als 1,5 GB.');
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
    foreach ($wanted as $fileName) {
        $input = $zip->getStream($entries[$fileName]);
        $output = fopen($dir . DIRECTORY_SEPARATOR . $fileName, 'wb');
        if (!$input || !$output) {
            $zip->close();
            gtfs_error(500, 'GTFS-Datei kann nicht temporär gespeichert werden: ' . $fileName);
        }
        stream_copy_to_stream($input, $output);
        fclose($input);
        fclose($output);
    }
    $zip->close();
    [$h0] = gtfs_open_table($dir . '/routes.txt', ['route_id']); fclose($h0);
    [$h1] = gtfs_open_table($dir . '/trips.txt', ['route_id', 'trip_id']); fclose($h1);
    [$h2] = gtfs_open_table($dir . '/stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence']); fclose($h2);
    [$h3] = gtfs_open_table($dir . '/stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon']); fclose($h3);
    $routes = gtfs_read_routes($dir);
    gtfs_reply(['ok' => true, 'token' => $token, 'routes' => $routes, 'routeCount' => count($routes)]);
}

try {
    $action = strtolower(trim(strval($_POST['action'] ?? 'upload')));
    if ($action === 'upload') gtfs_handle_upload();
    $token = trim(strval($_POST['token'] ?? ''));
    $dir = gtfs_session_dir($token);
    if ($action === 'variants') {
        $routeId = trim(strval($_POST['routeId'] ?? ''));
        if ($routeId === '') gtfs_error(400, 'routeId fehlt.');
        $variants = gtfs_build_variants($dir, $routeId);
        gtfs_reply(['ok' => true, 'variants' => $variants, 'variantCount' => count($variants)]);
    }
    if ($action === 'import') {
        $routeId = trim(strval($_POST['routeId'] ?? ''));
        $tripId = trim(strval($_POST['tripId'] ?? ''));
        if ($routeId === '' || $tripId === '') gtfs_error(400, 'routeId oder tripId fehlt.');
        $trips = gtfs_read_route_trips($dir, $routeId);
        if (!isset($trips[$tripId])) gtfs_error(404, 'Gewählte GTFS-Variante wurde nicht gefunden.');
        $items = gtfs_read_trip_stops($dir, $tripId);
        if (count($items) < 2) gtfs_error(422, 'GTFS-Variante enthält weniger als zwei nutzbare Stops.');
        $stopData = gtfs_read_stops($dir, array_values(array_unique(array_column($items, 'stopId'))));
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
        $routes = gtfs_read_routes($dir);
        $route = null;
        foreach ($routes as $candidate) {
            if ($candidate['id'] === $routeId) { $route = $candidate; break; }
        }
        $trip = $trips[$tripId];
        $lineName = trim(strval($route['shortName'] ?? '')) ?: trim(strval($route['name'] ?? $routeId));
        $direction = trim(strval($trip['headsign'])) ?: ($editorStops[0]['name'] . ' – ' . $editorStops[count($editorStops) - 1]['name']);
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
