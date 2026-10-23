<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_service_compare.php';

// Lehrfahrer V1 compares service-valid stop sequences, never timetable density or feed-local IDs.
function lehrfahrer_gtfs_v1_name(string $value): string {
    $value = trim(preg_replace('/\s+/u', ' ', $value));
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function lehrfahrer_gtfs_v1_same_stop(array $a, array $b): bool {
    if (lehrfahrer_gtfs_v1_name($a['name']) !== lehrfahrer_gtfs_v1_name($b['name'])) return false;
    $lat = abs($a['lat'] - $b['lat']) * 111200;
    $lon = abs($a['lon'] - $b['lon']) * 111200 * cos(deg2rad(($a['lat'] + $b['lat']) / 2));
    return hypot($lat, $lon) <= 30;
}

function lehrfahrer_gtfs_v1_same_sequence(array $a, array $b): bool {
    if (count($a) !== count($b)) return false;
    foreach ($a as $i => $stop) if (!lehrfahrer_gtfs_v1_same_stop($stop, $b[$i])) return false;
    return true;
}

function lehrfahrer_gtfs_v1_related(array $a, array $b): bool {
    if (lehrfahrer_gtfs_v1_same_stop($a[0], $b[0])
        && lehrfahrer_gtfs_v1_same_stop($a[count($a) - 1], $b[count($b) - 1])) return true;
    $shared = 0; $used = [];
    foreach ($a as $stop) foreach ($b as $i => $other) {
        if (isset($used[$i]) || !lehrfahrer_gtfs_v1_same_stop($stop, $other)) continue;
        $shared++; $used[$i] = true; break;
    }
    return $shared >= 2 && $shared * 2 >= min(count($a), count($b));
}

function lehrfahrer_gtfs_v1_inventory(array $feed): array {
    $active = [];
    foreach ($feed['trips'] as $id => $trip) {
        if (!empty($feed['serviceDays'][strval($trip['service_id'])])) $active[$id] = $trip;
    }
    $zip = new ZipArchive();
    if ($zip->open($feed['path']) !== true) throw new RuntimeException('GTFS-ZIP ist ungueltig.');
    try {
        $sequences = []; $usedStops = [];
        lehrfahrer_gtfs_service_rows($zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence'],
            static function (array $row) use (&$sequences, &$usedStops, $active): void {
                $trip = strval($row['trip_id']);
                if (!isset($active[$trip])) return;
                $order = strval($row['stop_sequence']);
                if (!ctype_digit($order) || isset($sequences[$trip][(int)$order])) throw new RuntimeException('GTFS-Stopfolge ist ungueltig.');
                $id = strval($row['stop_id']);
                $sequences[$trip][(int)$order] = $id;
                $usedStops[$id] = true;
            });
        $stops = [];
        lehrfahrer_gtfs_service_rows($zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
            static function (array $row) use (&$stops, $usedStops): void {
                $id = strval($row['stop_id']);
                if (!isset($usedStops[$id])) return;
                if (trim(strval($row['stop_name'])) === '' || !is_numeric($row['stop_lat']) || !is_numeric($row['stop_lon'])) {
                    throw new RuntimeException('GTFS-Haltestelle besitzt keine Vergleichsmerkmale.');
                }
                $stops[$id] = ['name' => trim(strval($row['stop_name'])), 'lat' => (float)$row['stop_lat'], 'lon' => (float)$row['stop_lon']];
            });
    } finally { $zip->close(); }
    $lines = [];
    foreach ($active as $tripId => $trip) {
        $ids = $sequences[$tripId] ?? [];
        ksort($ids, SORT_NUMERIC);
        if (count($ids) < 2) continue;
        $stoppage = [];
        foreach ($ids as $id) {
            if (!isset($stops[$id])) throw new RuntimeException('GTFS-Stopfolge verweist auf unbekannte Haltestelle.');
            $stoppage[] = $stops[$id];
        }
        $route = $feed['routes'][strval($trip['route_id'])];
        $key = trim(strval($route['route_short_name'])) . "\0" . strval($route['route_type']);
        if ($key === "\0") throw new RuntimeException('GTFS-Linienidentitaet fehlt.');
        if (isset($lines[$key]) && $lines[$key]['routeId'] !== strval($trip['route_id'])) {
            throw new RuntimeException('GTFS-Linienidentitaet ist mehrdeutig.');
        }
        $lines[$key] ??= ['line' => trim(strval($route['route_short_name'])), 'routeId' => strval($trip['route_id']), 'variants' => []];
        $found = null;
        foreach ($lines[$key]['variants'] as $i => $variant) {
            if (lehrfahrer_gtfs_v1_same_sequence($variant['stops'], $stoppage)) { $found = $i; break; }
        }
        if ($found === null) {
            $found = count($lines[$key]['variants']);
            $lines[$key]['variants'][] = ['stops' => $stoppage, 'dates' => []];
        }
        foreach ($feed['serviceDays'][strval($trip['service_id'])] as $date => $_) {
            $lines[$key]['variants'][$found]['dates'][$date] = true;
        }
    }
    return $lines;
}

function lehrfahrer_gtfs_v1_temporary(array $variant, array $feed): bool {
    $weekdays = [];
    foreach ($variant['dates'] as $date => $_) $weekdays[(int)(new DateTimeImmutable($date))->format('N')] = true;
    foreach ($feed['activeDays'] as $date => $_) {
        if (isset($weekdays[(int)(new DateTimeImmutable($date))->format('N')]) && !isset($variant['dates'][$date])) return true;
    }
    return false;
}

function lehrfahrer_gtfs_v1_public(array $variant, string $status, ?array $diff = null): array {
    $names = array_column($variant['stops'], 'name');
    return ['status' => $status, 'headsign' => '', 'directionId' => '', 'stopCount' => count($names),
        'startStop' => $names[0], 'destination' => $names[count($names) - 1],
        'stopNames' => $names, 'temporary' => $variant['temporary'] ?? false, 'diff' => $diff];
}

function lehrfahrer_gtfs_v1_diff(array $old, array $new): array {
    $a = array_map('lehrfahrer_gtfs_v1_name', array_column($old, 'name'));
    $b = array_map('lehrfahrer_gtfs_v1_name', array_column($new, 'name'));
    $removed = array_values(array_diff($a, $b));
    $added = array_values(array_diff($b, $a));
    return ['addedStops' => $added, 'removedStops' => $removed,
        'orderChanged' => !$added && !$removed && $a !== $b,
        'stopCountChanged' => count($a) !== count($b), 'previousStopCount' => count($a)];
}

function lehrfahrer_gtfs_v1_uncertain(array $old, array $new): bool {
    if (array_map('lehrfahrer_gtfs_v1_name', array_column($old, 'name'))
        === array_map('lehrfahrer_gtfs_v1_name', array_column($new, 'name'))) return true;
    foreach ($old as $a) foreach ($new as $b) {
        if (lehrfahrer_gtfs_v1_name($a['name']) === lehrfahrer_gtfs_v1_name($b['name'])) continue;
        $lat = abs($a['lat'] - $b['lat']) * 111200;
        $lon = abs($a['lon'] - $b['lon']) * 111200 * cos(deg2rad(($a['lat'] + $b['lat']) / 2));
        if (hypot($lat, $lon) <= 30) return true;
    }
    return false;
}

function lehrfahrer_gtfs_compare_routes_v1(string $candidateZip, string $currentZip): array {
    $newFeed = lehrfahrer_gtfs_service_feed($candidateZip);
    $oldFeed = lehrfahrer_gtfs_service_feed($currentZip);
    $new = lehrfahrer_gtfs_v1_inventory($newFeed);
    $old = lehrfahrer_gtfs_v1_inventory($oldFeed);
    $keys = array_unique(array_merge(array_keys($old), array_keys($new)));
    sort($keys, SORT_NATURAL | SORT_FLAG_CASE);
    $result = ['comparisonMode' => 'SERVICEGUELTIGE_STRECKEN_V1', 'comparable' => true,
        'commonPeriod' => (bool)array_intersect_key($newFeed['activeDays'], $oldFeed['activeDays']),
        'currentPeriod' => $oldFeed['period'], 'candidatePeriod' => $newFeed['period'],
        'currentAgency' => $oldFeed['agencyId'], 'candidateAgency' => $newFeed['agencyId'],
        'currentValidTrips' => $oldFeed['tripCount'], 'candidateValidTrips' => $newFeed['tripCount'],
        'currentValidLines' => count($old), 'candidateValidLines' => count($new),
        'lineCounts' => ['NEU' => 0, 'GEAENDERT' => 0, 'UNVERAENDERT' => 0, 'ENTFALLEN' => 0, 'PRUEFEN' => 0], 'lines' => []];
    foreach ($keys as $key) {
        $n = $new[$key] ?? null; $o = $old[$key] ?? null;
        $nv = $n['variants'] ?? []; $ov = $o['variants'] ?? [];
        foreach ($nv as &$variant) $variant['temporary'] = lehrfahrer_gtfs_v1_temporary($variant, $newFeed);
        unset($variant);
        foreach ($ov as &$variant) $variant['temporary'] = lehrfahrer_gtfs_v1_temporary($variant, $oldFeed);
        unset($variant);
        $matchedNew = []; $matchedOld = []; $public = []; $changes = [];
        foreach ($nv as $ni => $variant) foreach ($ov as $oi => $prior) {
            if (isset($matchedNew[$ni]) || isset($matchedOld[$oi])) continue;
            if (!lehrfahrer_gtfs_v1_same_sequence($variant['stops'], $prior['stops'])) continue;
            $matchedNew[$ni] = true; $matchedOld[$oi] = true;
            $public[] = lehrfahrer_gtfs_v1_public($variant, 'UNVERAENDERT');
            break;
        }
        foreach ($nv as $ni => $variant) {
            if (isset($matchedNew[$ni])) continue;
            $possible = [];
            foreach ($ov as $oi => $prior) {
                if (isset($matchedOld[$oi])) continue;
                if (lehrfahrer_gtfs_v1_related($variant['stops'], $prior['stops'])) $possible[] = $oi;
            }
            if (count($possible) !== 1) continue;
            $oi = $possible[0]; $prior = $ov[$oi];
            $reverse = 0;
            foreach ($nv as $other) if (lehrfahrer_gtfs_v1_related($other['stops'], $prior['stops'])) $reverse++;
            if ($reverse !== 1) continue;
            $matchedNew[$ni] = true; $matchedOld[$oi] = true;
            $status = ($variant['temporary'] || $prior['temporary']
                || lehrfahrer_gtfs_v1_uncertain($prior['stops'], $variant['stops'])) ? 'PRUEFEN' : 'GEAENDERT';
            $diff = lehrfahrer_gtfs_v1_diff($prior['stops'], $variant['stops']);
            $public[] = lehrfahrer_gtfs_v1_public($variant, $status, $diff);
            $changes[] = ['previousStopNames' => array_column($prior['stops'], 'name'),
                'newStopNames' => array_column($variant['stops'], 'name'), 'status' => $status];
        }
        foreach ($nv as $ni => $variant) if (!isset($matchedNew[$ni])) $public[] = lehrfahrer_gtfs_v1_public($variant, 'PRUEFEN',
            ['note' => 'Neue oder zeitweise Stopfolge; fachlich pruefen.']);
        foreach ($ov as $oi => $variant) if (!isset($matchedOld[$oi])) $public[] = lehrfahrer_gtfs_v1_public($variant, 'PRUEFEN',
            ['note' => 'Entfallene oder zeitweise Stopfolge; fachlich pruefen.']);
        $unmatched = count($nv) - count($matchedNew) + count($ov) - count($matchedOld);
        $changed = (bool)array_filter($public, static fn(array $item): bool => $item['status'] === 'GEAENDERT');
        $status = $o === null ? 'NEU' : ($n === null ? 'ENTFALLEN' : ($unmatched ? 'PRUEFEN' : ($changed ? 'GEAENDERT' : 'UNVERAENDERT')));
        $result['lineCounts'][$status]++;
        $result['lines'][] = ['line' => ($n ?? $o)['line'], 'routeId' => ($n ?? $o)['routeId'],
            'status' => $status, 'variantCount' => count($nv), 'previousVariantCount' => count($ov),
            'stopSequenceChanges' => $changes, 'variants' => $public];
    }
    return $result;
}
