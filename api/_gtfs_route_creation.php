<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_route_preview.php';
require_once __DIR__ . '/_gtfs_route_assignment.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';

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

function lehrfahrer_gtfs_creation_index_rows(string $indexPath, string $agencyId, string $line, array $keys): array {
    $pdo = lehrfahrer_gtfs_change_open_index($indexPath, [$agencyId]);
    $query = $pdo->prepare('SELECT v.*, r.short_name, r.long_name FROM variants v
        JOIN routes r ON r.route_id=v.route_id WHERE r.agency_id=? AND r.short_name=?');
    $query->execute([$agencyId, $line]);
    $matches = [];
    foreach ($query as $row) {
        $items = json_decode(strval($row['stops_json']), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($items) || count($items) < 2) continue;
        $stopKeys = [];
        try {
            foreach ($items as $item) {
                $stopKeys[] = lehrfahrer_gtfs_service_stop_key([
                    'stop_name' => $item['name'] ?? '', 'stop_lat' => $item['lat'] ?? null,
                    'stop_lon' => $item['lon'] ?? null
                ]);
            }
        } catch (RuntimeException $error) { continue; }
        $key = hash('sha256', json_encode($stopKeys, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        if (!isset($keys[$key])) continue;
        $row['items'] = $items;
        if (isset($matches[$key]) && array_column($matches[$key]['items'], 'stopId') !== array_column($items, 'stopId')) {
            throw new RuntimeException('GTFS-Variante besitzt mehrere nicht eindeutige Stopkennungen.');
        }
        $matches[$key] = $row;
    }
    $pdo = null;
    foreach ($keys as $key => $_) if (!isset($matches[$key])) {
        throw new RuntimeException('Markierte Variante fehlt im geprueften Kandidatenindex.');
    }
    return $matches;
}

function lehrfahrer_gtfs_creation_plans(array $preview, array $assignments, array $routes,
    array $categories, string $sha, array $indexRows): array {
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
        $row = $indexRows[$key] ?? null;
        if (!is_array($row)) throw new RuntimeException('Markierte Variante fehlt im geprueften Kandidatenindex.');
        $names = array_map('strval', array_column($row['items'], 'name'));
        if ($names !== $variant['stopNames'] || count($names) !== (int)$variant['stopCount']) {
            throw new RuntimeException('Haltestellenfolge im Kandidatenindex weicht von der Vorschau ab.');
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
    ?callable $afterInstall = null): void {
    if (!is_dir($cityRoot) || is_link($cityRoot)) throw new RuntimeException('Cottbus-Routenablage ist nicht sicher.');
    $lockPath = $cityRoot . DIRECTORY_SEPARATOR . '.gtfs-create.lock';
    if (is_link($lockPath)) throw new RuntimeException('Routensperre ist ein Symlink.');
    $lock = fopen($lockPath, 'c');
    if ($lock === false) throw new RuntimeException('Routensperre ist nicht verfuegbar.');
    $installed = []; $temps = [];
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Routensperre fehlgeschlagen.');
        $checkExisting();
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
