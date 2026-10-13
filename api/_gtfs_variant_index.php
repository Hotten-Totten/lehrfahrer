<?php
declare(strict_types=1);

const LEHRFAHRER_GTFS_INDEX_SCHEMA_VERSION = 3;

function lehrfahrer_gtfs_index_via_names(array $stopNames): array {
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

function lehrfahrer_gtfs_index_create_schema(PDO $pdo): void {
    $pdo->exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE;');
    $pdo->exec('PRAGMA auto_vacuum=FULL; VACUUM;');
    $pdo->exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE agencies (agency_id TEXT PRIMARY KEY, agency_name TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE routes (route_id TEXT PRIMARY KEY, agency_id TEXT, short_name TEXT, long_name TEXT, route_type TEXT)');
    $pdo->exec('CREATE TABLE stops (stop_pk INTEGER PRIMARY KEY, stop_id TEXT NOT NULL UNIQUE, stop_name TEXT, lat REAL, lon REAL, parent_station TEXT)');
    $pdo->exec('CREATE TABLE trips (trip_pk INTEGER PRIMARY KEY, trip_id TEXT NOT NULL UNIQUE, route_id TEXT NOT NULL, direction_id TEXT, headsign TEXT)');
    $pdo->exec('CREATE TABLE stop_times (trip_pk INTEGER NOT NULL, stop_sequence INTEGER NOT NULL, stop_pk INTEGER NOT NULL, PRIMARY KEY (trip_pk, stop_sequence)) WITHOUT ROWID');
    $pdo->exec('CREATE TABLE variants (
        route_id TEXT NOT NULL, variant_id TEXT NOT NULL, signature TEXT NOT NULL, direction_id TEXT,
        trip_headsign TEXT, stop_count INTEGER NOT NULL, start_stop_name TEXT, end_stop_name TEXT,
        via_stops_json TEXT NOT NULL, stops_json TEXT NOT NULL,
        route_short_name TEXT, route_long_name TEXT, agency_name TEXT, route_type TEXT,
        PRIMARY KEY (route_id, variant_id)
    ) WITHOUT ROWID');
}

function lehrfahrer_gtfs_index_csv_rows(string $bytes, array $required, callable $consumer): int {
    $stream = fopen('php://temp', 'r+');
    if ($stream === false || fwrite($stream, $bytes) !== strlen($bytes)) throw new RuntimeException('GTFS-Tabelle kann nicht gelesen werden.');
    rewind($stream);
    $header = fgetcsv($stream, null, ',', '"', '');
    if (!is_array($header)) throw new RuntimeException('GTFS-Header fehlt.');
    if (isset($header[0])) $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', strval($header[0]));
    foreach ($required as $name) if (!in_array($name, $header, true)) throw new RuntimeException('GTFS-Pflichtfeld fehlt: ' . $name);
    $count = 0;
    while (($values = fgetcsv($stream, null, ',', '"', '')) !== false) {
        if (count($values) !== count($header)) throw new RuntimeException('Ungueltige GTFS-Zeile.');
        $consumer(array_combine($header, $values));
        $count++;
    }
    fclose($stream);
    return $count;
}

function lehrfahrer_gtfs_build_variant_index(array $files, string $databasePath, array $agencyIds, array $metadata = []): array {
    try {
        return lehrfahrer_gtfs_build_variant_index_implementation($files, $databasePath, $agencyIds, $metadata);
    } catch (Throwable $error) {
        $message = $error->getMessage();
        $code = (int)$error->getCode();
        unset($error);
        gc_collect_cycles();
        @unlink($databasePath . '-journal');
        @unlink($databasePath);
        throw new RuntimeException($message, $code);
    }
}

function lehrfahrer_gtfs_build_variant_index_implementation(array $files, string $databasePath, array $agencyIds, array $metadata = []): array {
    if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('PDO_SQLite ist fuer den Variantenindex nicht verfuegbar.');
    }
    foreach (['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'] as $name) {
        if (!isset($files[$name]) || !is_string($files[$name])) throw new RuntimeException('Gefilterte GTFS-Datei fehlt: ' . $name);
    }
    if (file_exists($databasePath) || is_link($databasePath)) throw new RuntimeException('Variantenindex-Ziel existiert bereits.');
    $agencyIds = array_values(array_unique(array_map('strval', $agencyIds)));
    sort($agencyIds, SORT_STRING);
    $pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        lehrfahrer_gtfs_index_create_schema($pdo);
        $pdo->beginTransaction();
        $agency = $pdo->prepare('INSERT INTO agencies VALUES (?, ?)');
        lehrfahrer_gtfs_index_csv_rows($files['agency.txt'], ['agency_id', 'agency_name'], static function (array $row) use ($agency, $agencyIds): void {
            if (in_array(strval($row['agency_id']), $agencyIds, true)) $agency->execute([strval($row['agency_id']), strval($row['agency_name'])]);
        });
        $route = $pdo->prepare('INSERT INTO routes VALUES (?, ?, ?, ?, ?)');
        lehrfahrer_gtfs_index_csv_rows($files['routes.txt'], ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], static function (array $row) use ($route, $agencyIds): void {
            if (in_array(strval($row['agency_id']), $agencyIds, true)) $route->execute([$row['route_id'], $row['agency_id'], $row['route_short_name'], $row['route_long_name'], $row['route_type']]);
        });
        $stop = $pdo->prepare('INSERT INTO stops (stop_id, stop_name, lat, lon, parent_station) VALUES (?, ?, ?, ?, ?)');
        lehrfahrer_gtfs_index_csv_rows($files['stops.txt'], ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'parent_station'], static function (array $row) use ($stop): void {
            $stop->execute([$row['stop_id'], $row['stop_name'], $row['stop_lat'] !== '' ? $row['stop_lat'] : null, $row['stop_lon'] !== '' ? $row['stop_lon'] : null, $row['parent_station']]);
        });
        $trip = $pdo->prepare('INSERT INTO trips (trip_id, route_id, direction_id, headsign) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM routes WHERE route_id = ?)');
        lehrfahrer_gtfs_index_csv_rows($files['trips.txt'], ['trip_id', 'route_id'], static function (array $row) use ($trip): void {
            $trip->execute([$row['trip_id'], $row['route_id'], strval($row['direction_id'] ?? ''), strval($row['trip_headsign'] ?? ''), $row['route_id']]);
        });
        $stopTime = $pdo->prepare('INSERT OR REPLACE INTO stop_times SELECT t.trip_pk, ?, s.stop_pk FROM trips t JOIN stops s ON s.stop_id = ? WHERE t.trip_id = ?');
        lehrfahrer_gtfs_index_csv_rows($files['stop_times.txt'], ['trip_id', 'stop_id', 'stop_sequence'], static function (array $row) use ($stopTime): void {
            if (!ctype_digit(strval($row['stop_sequence']))) throw new RuntimeException('Ungueltige stop_sequence im Variantenindex.');
            $stopTime->execute([(int)$row['stop_sequence'], $row['stop_id'], $row['trip_id']]);
        });
        $pdo->commit();

        $trips = $pdo->query('SELECT t.trip_pk, t.route_id, t.direction_id, t.headsign, r.short_name, r.long_name, r.route_type, a.agency_name
            FROM trips t JOIN routes r ON r.route_id=t.route_id JOIN agencies a ON a.agency_id=r.agency_id ORDER BY t.trip_id');
        $stops = $pdo->prepare('SELECT s.stop_id, st.stop_sequence, COALESCE(s.stop_name, "") stop_name,
            CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lat ELSE p.lat END lat,
            CASE WHEN s.lat IS NOT NULL AND s.lon IS NOT NULL THEN s.lon ELSE p.lon END lon
            FROM stop_times st JOIN stops s ON s.stop_pk=st.stop_pk LEFT JOIN stops p ON p.stop_id=s.parent_station
            WHERE st.trip_pk=? ORDER BY st.stop_sequence');
        $insert = $pdo->prepare('INSERT OR IGNORE INTO variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $pdo->beginTransaction();
        foreach ($trips as $row) {
            $stops->execute([(int)$row['trip_pk']]);
            $items = []; $ids = []; $names = [];
            foreach ($stops as $item) {
                $ids[] = strval($item['stop_id']); $names[] = strval($item['stop_name']);
                $items[] = ['stopId' => strval($item['stop_id']), 'sequence' => (int)$item['stop_sequence'], 'name' => strval($item['stop_name']),
                    'lat' => $item['lat'] !== null ? (float)$item['lat'] : null, 'lon' => $item['lon'] !== null ? (float)$item['lon'] : null];
            }
            if (count($ids) < 2) continue;
            $signature = sha1(implode('>', $ids));
            $insert->execute([$row['route_id'], strval($row['direction_id']) . '|' . $signature, $signature, $row['direction_id'], $row['headsign'], count($ids),
                $names[0], $names[count($names) - 1], json_encode(lehrfahrer_gtfs_index_via_names($names), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $row['short_name'], $row['long_name'], $row['agency_name'], $row['route_type']]);
        }
        $pdo->commit();
        $meta = $pdo->prepare('INSERT INTO meta VALUES (?, ?)');
        $metaValues = [
            'schema_version' => strval(LEHRFAHRER_GTFS_INDEX_SCHEMA_VERSION),
            'agency_ids' => json_encode($agencyIds, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'source_sha256' => strval($metadata['source_sha256'] ?? ''),
            'created_at' => strval($metadata['created_at'] ?? '1970-01-01T00:00:00Z'),
        ];
        foreach ($metaValues as $key => $value) $meta->execute([$key, $value]);
        $pdo->exec('DROP TABLE stop_times; DROP TABLE trips; DROP TABLE stops; VACUUM;');
        $pdo = null;
        return lehrfahrer_gtfs_validate_variant_index($databasePath, $agencyIds);
}

function lehrfahrer_gtfs_validate_variant_index(string $databasePath, array $expectedAgencyIds): array {
    if (!is_file($databasePath) || is_link($databasePath) || !is_readable($databasePath)) throw new RuntimeException('Variantenindex ist keine lesbare regulaere Datei.');
    $header = file_get_contents($databasePath, false, null, 0, 16);
    if ($header !== "SQLite format 3\0") throw new RuntimeException('Variantenindex besitzt keinen SQLite-Header.');
    $pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    if ($pdo->query('PRAGMA integrity_check')->fetchColumn() !== 'ok') throw new RuntimeException('SQLite-integrity_check ist fehlgeschlagen.');
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    if ($tables !== ['agencies', 'meta', 'routes', 'variants']) throw new RuntimeException('Variantenindex besitzt unerwartete Tabellen.');
    $meta = $pdo->query('SELECT key,value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
    sort($expectedAgencyIds, SORT_STRING);
    if (($meta['schema_version'] ?? '') !== strval(LEHRFAHRER_GTFS_INDEX_SCHEMA_VERSION)
        || json_decode(strval($meta['agency_ids'] ?? ''), true) !== $expectedAgencyIds) throw new RuntimeException('Variantenindex-Metadaten sind ungueltig.');
    $actualAgencies = $pdo->query('SELECT agency_id FROM agencies ORDER BY agency_id')->fetchAll(PDO::FETCH_COLUMN);
    if ($actualAgencies !== $expectedAgencyIds) throw new RuntimeException('Variantenindex enthaelt fremde Agencies.');
    $routes = (int)$pdo->query('SELECT COUNT(*) FROM routes')->fetchColumn();
    $variants = (int)$pdo->query('SELECT COUNT(*) FROM variants')->fetchColumn();
    $bad = (int)$pdo->query('SELECT COUNT(*) FROM variants v LEFT JOIN routes r ON r.route_id=v.route_id WHERE r.route_id IS NULL OR v.stop_count < 2')->fetchColumn();
    if ($routes < 1 || $variants < 1 || $bad !== 0) throw new RuntimeException('Variantenindex ist fachlich unvollstaendig.');
    foreach ($pdo->query('SELECT stop_count,stops_json,via_stops_json FROM variants') as $row) {
        $items = json_decode(strval($row['stops_json']), true, 512, JSON_THROW_ON_ERROR);
        json_decode(strval($row['via_stops_json']), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($items) || count($items) !== (int)$row['stop_count']) throw new RuntimeException('Variantenindex enthaelt inkonsistente Stopdaten.');
        foreach ($items as $item) if (!is_array($item) || trim(strval($item['stopId'] ?? '')) === '') throw new RuntimeException('Variantenindex enthaelt leere Stop-IDs.');
    }
    $pdo = null;
    return ['schema_version' => LEHRFAHRER_GTFS_INDEX_SCHEMA_VERSION, 'agency_ids' => $expectedAgencyIds, 'routes' => $routes, 'variants' => $variants,
        'bytes' => (int)filesize($databasePath), 'sha256' => hash_file('sha256', $databasePath), 'integrity_check' => 'ok'];
}
