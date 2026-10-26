<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_current_postcheck.php';

if (!class_exists('ZipArchive')) throw new RuntimeException('ZipArchive fehlt.');
$root = sys_get_temp_dir() . '/lehrfahrer-current-postcheck-' . bin2hex(random_bytes(8));
if (!mkdir($root, 0700)) throw new RuntimeException('Fixture-Verzeichnis fehlt.');

function current_postcheck_fixture(string $directory, int $lineCount, int $variantCount,
    string $agency = '325', string $agencyName = 'Cottbusverkehr', bool $duplicateAgency = false): array {
    if (!mkdir($directory, 0700)) throw new RuntimeException('Fixture-Verzeichnis fehlt.');
    $agencyRows = "$agency,$agencyName\n" . ($duplicateAgency ? "999,Cottbusverkehr\n" : '');
    $routes = "route_id,agency_id,route_short_name,route_long_name,route_type\n";
    $trips = "route_id,service_id,trip_id,trip_headsign,direction_id\n";
    $times = "trip_id,stop_id,stop_sequence\n";
    $stops = "stop_id,stop_name,stop_lat,stop_lon,parent_station\na,Start,51.7,14.3,\nb,Ziel,51.8,14.4,\n";
    $remaining = $variantCount;
    for ($line = 1; $line <= $lineCount; $line++) {
        $routeId = 'route' . $line;
        $routes .= "$routeId,$agency,$line,Linie $line,3\n";
        $count = $line === $lineCount ? $remaining : 1;
        for ($variant = 1; $variant <= $count; $variant++) {
            $tripId = 'trip' . $line . '_' . $variant;
            $trips .= "$routeId,service,$tripId,Ziel,$variant\n";
            $times .= "$tripId,a,1\n$tripId,b,2\n";
        }
        $remaining -= $count;
    }
    $files = [
        'agency.txt' => "agency_id,agency_name\n" . $agencyRows,
        'routes.txt' => $routes,
        'trips.txt' => $trips,
        'stops.txt' => $stops,
        'stop_times.txt' => $times,
    ];
    $zipPath = $directory . '/latest.zip';
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Fixture-ZIP fehlt.');
    foreach ($files as $name => $body) $zip->addFromString($name, $body);
    $zip->close();
    $indexPath = $directory . '/variants.sqlite';
    lehrfahrer_gtfs_build_variant_index($files, $indexPath, [$agency],
        ['source_sha256' => hash_file('sha256', $zipPath), 'created_at' => '2026-10-25T00:00:00Z']);
    $index = lehrfahrer_gtfs_change_read_index($indexPath, [$agency]);
    $entries = [];
    foreach ($index['routes'] as $route) {
        foreach ($route['variants'] as $variant) {
            $key = strval($route['routeId']) . "\0" . strval($variant['variantId']);
            $entries[] = ['key' => hash('sha256', $key), 'routeId' => $route['routeId'],
                'variantId' => $variant['variantId'], 'status' => 'UNGEPRUEFT', 'timetableStatus' => 'NEU'];
        }
    }
    $inventoryPath = $directory . '/work-inventory.json';
    $inventory = [
        'agencyIds' => [$agency], 'sourceIndexSha256' => hash_file('sha256', $indexPath),
        'completeness' => ['expectedLineCount' => $lineCount, 'capturedLineCount' => $lineCount,
            'expectedVariantCount' => $variantCount, 'capturedVariantCount' => $variantCount, 'complete' => true],
        'entries' => $entries,
    ];
    file_put_contents($inventoryPath, json_encode($inventory, JSON_THROW_ON_ERROR));
    $workingPath = $directory . '/working-set.json';
    file_put_contents($workingPath, json_encode(['agencyIds' => [$agency],
        'sourceIndexSha256' => hash_file('sha256', $indexPath)], JSON_THROW_ON_ERROR));
    return [$zipPath, $indexPath, $inventoryPath, $workingPath];
}

function current_postcheck_ok(array $paths, int $lines, int $variants, string $message): void {
    $result = lehrfahrer_gtfs_current_postcheck(...$paths);
    if ($result['lines'] !== $lines || $result['variants'] !== $variants) throw new RuntimeException($message);
    echo "OK $message\n";
}

function current_postcheck_blocked(array $paths, string $message): void {
    try { lehrfahrer_gtfs_current_postcheck(...$paths); }
    catch (Throwable $error) { echo "OK $message\n"; return; }
    throw new RuntimeException($message . ' wurde nicht blockiert.');
}

function current_postcheck_cleanup(string $path): void {
    foreach (new DirectoryIterator($path) as $entry) {
        if ($entry->isDot()) continue;
        $item = $entry->getPathname();
        if ($entry->isDir() && !$entry->isLink()) current_postcheck_cleanup($item);
        else unlink($item);
    }
    rmdir($path);
}

try {
    $legacy = current_postcheck_fixture($root . '/legacy', 1, 1, '143');
    current_postcheck_ok($legacy, 1, 1, 'Alter Bestand ohne festen Zahlenwert gueltig');
    $new = current_postcheck_fixture($root . '/new', 2, 3);
    current_postcheck_ok($new, 2, 3, 'Neuer Bestand mit anderer Agency und anderen Zahlen gueltig');

    $mismatch = current_postcheck_fixture($root . '/mismatch', 2, 3);
    $zip = new ZipArchive();
    $zip->open($mismatch[0]);
    $zip->addFromString('feed_info.txt', "feed_publisher_name\nTest\n");
    $zip->close();
    current_postcheck_blocked($mismatch, 'ZIP-/Index-SHA-Mismatch');

    $missing = current_postcheck_fixture($root . '/missing', 2, 3, '325', 'Fremdbetrieb');
    current_postcheck_blocked($missing, 'Fehlender Cottbusverkehr-Betreiber');
    $ambiguous = current_postcheck_fixture($root . '/ambiguous', 2, 3, '325', 'Cottbusverkehr', true);
    current_postcheck_blocked($ambiguous, 'Mehrdeutiger Cottbusverkehr-Betreiber');

    $inventory = json_decode((string)file_get_contents($new[2]), true, 512, JSON_THROW_ON_ERROR);
    $inventory['entries'][] = $inventory['entries'][0];
    file_put_contents($new[2], json_encode($inventory, JSON_THROW_ON_ERROR));
    current_postcheck_blocked($new, 'Doppelte CURRENT-Variante im Arbeitsvorrat');
    array_pop($inventory['entries']);
    $removed = $inventory['entries'][0];
    $removed['routeId'] = 'previous-only';
    $removed['key'] = hash('sha256', 'previous-only' . "\0" . $removed['variantId']);
    $removed['timetableStatus'] = 'ENTFALLEN';
    $inventory['entries'][] = $removed;
    file_put_contents($new[2], json_encode($inventory, JSON_THROW_ON_ERROR));
    current_postcheck_ok($new, 2, 3, 'Entfallene Altvariante bleibt im Arbeitsvorrat erlaubt');
    $originalWorking = (string)file_get_contents($new[3]);
    unlink($new[3]);
    current_postcheck_ok($new, 2, 3, 'Nicht vorhandenes optionales Working-Set blockiert nicht');
    file_put_contents($new[3], $originalWorking);
    $working = json_decode((string)file_get_contents($new[3]), true, 512, JSON_THROW_ON_ERROR);
    $working['sourceIndexSha256'] = str_repeat('a', 64);
    file_put_contents($new[3], json_encode($working, JSON_THROW_ON_ERROR));
    current_postcheck_blocked($new, 'Fremdes Working-Set');

    $broken = current_postcheck_fixture($root . '/broken', 2, 3);
    file_put_contents($broken[1], 'kein SQLite');
    current_postcheck_blocked($broken, 'Beschaedigter SQLite-Index');
} finally {
    current_postcheck_cleanup($root);
}
