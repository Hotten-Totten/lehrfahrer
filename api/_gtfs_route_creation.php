<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_route_preview.php';
require_once __DIR__ . '/_gtfs_route_assignment.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';
require_once __DIR__ . '/_gtfs_timetable_change.php';
require_once __DIR__ . '/_gtfs_service_compare.php';

function lehrfahrer_gtfs_creation_fingerprint(string $sha, array $preview, array $assignments): string {
    $rows = [];
    foreach ($preview['variants'] ?? [] as $variant) {
        $key = strval($variant['selectionKey']);
        $id = lehrfahrer_gtfs_route_selection_id('16', $key);
        $saved = $assignments[$id] ?? [];
        $rows[] = [$key, strval($saved['action'] ?? ''), strval($saved['routeNumber'] ?? ''),
            strval($saved['targetRoute'] ?? ''), strval($saved['category'] ?? '')];
    }
    return hash('sha256', json_encode([$sha, $rows], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
}

function lehrfahrer_gtfs_creation_folder(string $name): string {
    $name = str_replace(['ä','ö','ü','Ä','Ö','Ü','ß'], ['ae','oe','ue','Ae','Oe','Ue','ss'], $name);
    $name = trim(preg_replace('/[^a-zA-Z0-9_\-]/', '_', $name), '_');
    if ($name === '') throw new RuntimeException('Kategorie besitzt keinen sicheren Ordnernamen.');
    return lehrfahrer_route_segment($name);
}

function lehrfahrer_gtfs_creation_zip_rows(string $zipPath, string $line, array $keys): array {
    // The derived variants index can cover a narrower service period than the
    // official ZIP. The checked ZIP is the authoritative source of selected rows.
    $feed = lehrfahrer_gtfs_service_feed($zipPath);
    $routeIds = [];
    foreach ($feed['routes'] as $id => $route) {
        if (trim(strval($route['route_short_name'] ?? '')) === $line) $routeIds[strval($id)] = true;
    }
    if ($routeIds === []) throw new RuntimeException('Pilotlinie fehlt im geprueften GTFS-Kandidaten.');
    $trips = [];
    foreach ($feed['trips'] as $id => $trip) {
        if (isset($routeIds[strval($trip['route_id'])])
            && !empty($feed['serviceDays'][strval($trip['service_id'])])) $trips[strval($id)] = $trip;
    }
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) throw new RuntimeException('Gepruefter GTFS-Kandidat ist nicht lesbar.');
    try {
        $sequences = []; $usedStops = [];
        lehrfahrer_gtfs_service_rows($zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence'],
            static function (array $row) use ($trips, &$sequences, &$usedStops): void {
                $tripId = strval($row['trip_id']);
                if (!isset($trips[$tripId])) return;
                $sequence = strval($row['stop_sequence']);
                if (!ctype_digit($sequence) || isset($sequences[$tripId][(int)$sequence])) {
                    throw new RuntimeException('GTFS-Stopfolge ist nicht eindeutig.');
                }
                $stopId = strval($row['stop_id']);
                $sequences[$tripId][(int)$sequence] = $stopId;
                $usedStops[$stopId] = true;
            });
        $stops = [];
        lehrfahrer_gtfs_service_rows($zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
            static function (array $row) use ($usedStops, &$stops): void {
                $stopId = strval($row['stop_id']);
                if (isset($usedStops[$stopId])) $stops[$stopId] = $row;
            });
    } finally { $zip->close(); }
    $matches = [];
    foreach ($trips as $tripId => $trip) {
        $ids = $sequences[$tripId] ?? [];
        ksort($ids, SORT_NUMERIC);
        if (count($ids) < 2) continue;
        $items = []; $stopKeys = [];
        foreach ($ids as $sequence => $stopId) {
            $stop = $stops[$stopId] ?? null;
            if ($stop === null) throw new RuntimeException('GTFS-Stopfolge verweist auf unbekannte Haltestelle.');
            $key = lehrfahrer_gtfs_service_stop_key($stop);
            $stopKeys[] = $key;
            $items[] = ['stopId' => $stopId, 'sequence' => (int)$sequence,
                'name' => trim(strval($stop['stop_name'])), 'lat' => (float)$stop['stop_lat'],
                'lon' => (float)$stop['stop_lon']];
        }
        $key = hash('sha256', json_encode($stopKeys, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        if (!isset($keys[$key]) || isset($matches[$key])) continue;
        $matches[$key] = ['items' => $items, 'short_name' => $line, 'trip_headsign' => strval($trip['trip_headsign'] ?? ''),
            'route_id' => strval($trip['route_id']), 'variant_id' => $tripId, 'signature' => sha1(implode('>', $ids))];
        if (count($matches) === count($keys)) break;
    }
    foreach ($keys as $key => $_) if (!isset($matches[$key])) {
        throw new RuntimeException('Markierte Variante fehlt im geprueften Kandidaten-ZIP.');
    }
    return $matches;
}

function lehrfahrer_gtfs_creation_plans(array $preview, array $assignments, array $routes,
    array $categories, string $sha, array $sourceRows): array {
    if (preg_match('/^[a-f0-9]{64}$/D', $sha) !== 1) throw new InvalidArgumentException('Ungueltiger Kandidaten-SHA.');
    $variants = $preview['variants'] ?? [];
    if ($variants === []) throw new RuntimeException('Keine aktuelle Route fuer die Pilotlinie markiert.');
    $plans = []; $numbers = [];
    foreach ($variants as $variant) {
        $key = strval($variant['selectionKey'] ?? '');
        $id = lehrfahrer_gtfs_route_selection_id('16', $key);
        if (!isset($assignments[$id])) throw new RuntimeException('Fachliche Routenzuordnung ist unvollstaendig.');
        $assignment = lehrfahrer_gtfs_assignment_validate($assignments[$id], $routes, $categories);
        if ($assignment['action'] !== 'new') throw new RuntimeException('Bestehende Route ersetzen ist noch nicht freigeschaltet.');
        if (!$assignment['ready']) throw new RuntimeException('Fachliche Routenzuordnung ist unvollstaendig oder Routennummer bereits vorhanden.');
        $number = $assignment['routeNumber'];
        $numberKey = function_exists('mb_strtolower') ? mb_strtolower($number, 'UTF-8') : strtolower($number);
        if (isset($numbers[$numberKey])) throw new RuntimeException('Routennummer ist mehrfach fuer die Pilotlinie vorgesehen.');
        $numbers[$numberKey] = true;
        $row = $sourceRows[$key] ?? null;
        if (!is_array($row)) throw new RuntimeException('Markierte Variante fehlt im geprueften Kandidaten-ZIP.');
        $names = array_map('strval', array_column($row['items'], 'name'));
        if ($names !== $variant['stopNames'] || count($names) !== (int)$variant['stopCount']) {
            throw new RuntimeException('Haltestellenfolge im Kandidaten-ZIP weicht von der Vorschau ab.');
        }
        $data = lehrfahrer_gtfs_work_build_line($row);
        $data['city'] = 'cottbus';
        $data['lineName'] = 'Linie 16';
        $data['routeName'] = 'Route ' . $number;
        $data['directionName'] = $variant['startStop'] . ' → ' . $variant['destination'];
        $data['startStopName'] = $variant['startStop'];
        $data['endStopName'] = $variant['destination'];
        $data['variantName'] = $data['directionName'];
        $data['variantCategory'] = $assignment['category'];
        $data['lineFolder'] = 'Linie_16';
        $data['categoryFolder'] = lehrfahrer_gtfs_creation_folder($assignment['category']);
        $data['fileBase'] = 'Route_' . $number;
        $data['id'] = 'linie_16_' . $key;
        $data['routePoints'] = [];
        $data['routePointsSimplified'] = [];
        $data['route'] = ['original' => [], 'simplified' => []];
        $data['meta'] = ['formatVersion' => '1.2', 'source' => 'GTFS-Fahrplanwechsel',
            'candidateSha256' => $sha, 'importedAt' => date('c'), 'reviewRequired' => true];
        $data['savedAt'] = date('c');
        $plans[] = ['line' => '16', 'routeNumber' => $number, 'category' => $assignment['category'],
            'selectionKey' => $key, 'data' => $data];
    }
    return $plans;
}

function lehrfahrer_gtfs_creation_install(string $cityRoot, array $writes, callable $checkExisting,
    ?callable $afterInstall = null, ?callable $registerCity = null): void {
    if (!is_dir($cityRoot) || is_link($cityRoot)) throw new RuntimeException('Cottbus-Routenablage ist nicht sicher.');
    $lockPath = $cityRoot . DIRECTORY_SEPARATOR . '.gtfs-create.lock';
    if (is_link($lockPath)) throw new RuntimeException('Routensperre ist ein Symlink.');
    $lock = fopen($lockPath, 'c');
    if ($lock === false) throw new RuntimeException('Routensperre ist nicht verfuegbar.');
    $installed = []; $temps = [];
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Routensperre fehlgeschlagen.');
        $checkExisting();
        if ($registerCity !== null) $registerCity();
        foreach ($writes as $write) {
            $target = strval($write['path']);
            $directory = dirname($target);
            if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Routenordner nicht anlegbar.');
            if (is_link($directory) || is_link($target) || file_exists($target)) {
                throw new RuntimeException('Routendatei existiert bereits oder besitzt einen unsicheren Pfad.');
            }
            $payload = json_encode($write['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $temp = $directory . DIRECTORY_SEPARATOR . '.gtfs-create-' . bin2hex(random_bytes(8));
            $temps[] = $temp;
            if (file_put_contents($temp, $payload, LOCK_EX) !== strlen($payload) || !chmod($temp, 0600)) {
                throw new RuntimeException('Routenentwurf konnte nicht geschrieben werden.');
            }
        }
        foreach ($writes as $i => $write) {
            if (!link($temps[$i], $write['path'])) throw new RuntimeException('Route existiert bereits oder konnte nicht angelegt werden.');
            $installed[] = $write['path'];
            if ($afterInstall !== null) $afterInstall($i, $write['path']);
        }
    } catch (Throwable $error) {
        foreach (array_reverse($installed) as $path) if (is_file($path)) unlink($path);
        throw $error;
    } finally {
        foreach ($temps as $temp) if (is_file($temp)) unlink($temp);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
