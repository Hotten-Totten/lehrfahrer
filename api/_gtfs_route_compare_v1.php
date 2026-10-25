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
        $key = lehrfahrer_gtfs_v1_name(strval($route['route_short_name']));
        if ($key === '') throw new RuntimeException('GTFS-Linienidentitaet fehlt.');
        $lines[$key] ??= ['line' => trim(strval($route['route_short_name'])), 'routeId' => strval($trip['route_id']),
            'routeTypes' => [], 'variants' => []];
        $lines[$key]['routeTypes'][strval($route['route_type'])] = true;
        $found = null;
        foreach ($lines[$key]['variants'] as $i => $variant) {
            if (lehrfahrer_gtfs_v1_same_sequence($variant['stops'], $stoppage)) { $found = $i; break; }
        }
        if ($found === null) {
            $found = count($lines[$key]['variants']);
            $lines[$key]['variants'][] = ['stops' => $stoppage, 'dates' => [], 'regularService' => false];
        }
        if (!empty($feed['regularServiceDays'][strval($trip['service_id'])])) $lines[$key]['variants'][$found]['regularService'] = true;
        foreach ($feed['serviceDays'][strval($trip['service_id'])] as $date => $_) {
            $lines[$key]['variants'][$found]['dates'][$date] = true;
        }
    }
    return $lines;
}

function lehrfahrer_gtfs_v1_feed_lines(array $feed): array {
    $lines = [];
    foreach ($feed['routes'] as $route) {
        $key = lehrfahrer_gtfs_v1_name(strval($route['route_short_name']));
        if ($key === '') throw new RuntimeException('GTFS-Linienidentitaet fehlt.');
        $lines[$key]['line'] ??= trim(strval($route['route_short_name']));
        $lines[$key]['routeTypes'][strval($route['route_type'])] = true;
    }
    return $lines;
}

function lehrfahrer_gtfs_v1_line_status(bool $oldPresent, bool $newPresent,
    bool $oldActive, bool $newActive, array $variants, bool $ambiguousType): string {
    $confirmed = false;
    $review = false;
    foreach ($variants as $variant) {
        if ($variant['status'] === 'GEAENDERT') $confirmed = true;
        if ($variant['status'] === 'PRUEFEN') $review = true;
    }
    // Feed absence alone does not turn exclusively temporary variants into a
    // confirmed new/removed line.
    if (!$oldPresent && $newPresent) return ($newActive && $confirmed) ? 'NEU' : 'PRUEFEN';
    if ($oldPresent && !$newPresent) return ($oldActive && $confirmed) ? 'ENTFALLEN' : 'PRUEFEN';
    if (!$oldPresent || !$newPresent || !$oldActive || !$newActive || $ambiguousType) return 'PRUEFEN';
    if ($confirmed) return 'GEAENDERT';
    if ($review) return 'PRUEFEN';
    return 'UNVERAENDERT';
}

function lehrfahrer_gtfs_v1_temporary(array $variant, array $feed): bool {
    if (!$variant['regularService']) return true;
    $weekdays = [];
    foreach ($variant['dates'] as $date => $_) $weekdays[(int)(new DateTimeImmutable($date))->format('N')] = true;
    foreach ($feed['activeDays'] as $date => $_) {
        if (isset($weekdays[(int)(new DateTimeImmutable($date))->format('N')]) && !isset($variant['dates'][$date])) return true;
    }
    return false;
}

function lehrfahrer_gtfs_v1_public(array $variant, string $status, ?array $diff = null,
    bool $candidatePresent = true): array {
    $names = array_column($variant['stops'], 'name');
    $stopKeys = array_map(static fn(array $stop): string => lehrfahrer_gtfs_service_stop_key([
        'stop_name' => $stop['name'], 'stop_lat' => $stop['lat'], 'stop_lon' => $stop['lon']
    ]), $variant['stops']);
    return ['status' => $status, 'candidatePresent' => $candidatePresent,
        'headsign' => '', 'directionId' => '', 'stopCount' => count($names),
        'startStop' => $names[0], 'destination' => $names[count($names) - 1],
        'stopNames' => $names, 'selectionKey' => hash('sha256', json_encode($stopKeys, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
        'temporary' => $variant['temporary'] ?? false, 'diff' => $diff];
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
    $newLines = lehrfahrer_gtfs_v1_feed_lines($newFeed);
    $oldLines = lehrfahrer_gtfs_v1_feed_lines($oldFeed);
    $keys = array_unique(array_merge(array_keys($oldLines), array_keys($newLines)));
    sort($keys, SORT_NATURAL | SORT_FLAG_CASE);
    $result = ['comparisonMode' => 'SERVICEGUELTIGE_STRECKEN_V1', 'comparable' => true,
        'commonPeriod' => (bool)array_intersect_key($newFeed['activeDays'], $oldFeed['activeDays']),
        'currentPeriod' => $oldFeed['period'], 'candidatePeriod' => $newFeed['period'],
        'currentAgency' => $oldFeed['agencyId'], 'candidateAgency' => $newFeed['agencyId'],
        'currentValidTrips' => $oldFeed['tripCount'], 'candidateValidTrips' => $newFeed['tripCount'],
        'currentValidLines' => count($old), 'candidateValidLines' => count($new),
        'currentVariantCount' => array_sum(array_map(static fn(array $line): int => count($line['variants']), $old)),
        'candidateVariantCount' => array_sum(array_map(static fn(array $line): int => count($line['variants']), $new)),
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
        foreach ($nv as $ni => $variant) if (!isset($matchedNew[$ni])) $public[] = lehrfahrer_gtfs_v1_public($variant,
            $variant['temporary'] ? 'PRUEFEN' : 'GEAENDERT',
            ['note' => $variant['temporary'] ? 'Zeitweise neue Stopfolge; fachlich prüfen.' : 'Variante hinzugekommen.']);
        foreach ($ov as $oi => $variant) if (!isset($matchedOld[$oi])) $public[] = lehrfahrer_gtfs_v1_public($variant,
            $variant['temporary'] ? 'PRUEFEN' : 'GEAENDERT',
            ['note' => $variant['temporary'] ? 'Zeitweise entfallene Stopfolge; fachlich prüfen.' : 'Variante entfallen.'], false);
        $oldTypes = array_keys($oldLines[$key]['routeTypes'] ?? []);
        $newTypes = array_keys($newLines[$key]['routeTypes'] ?? []);
        sort($oldTypes); sort($newTypes);
        $ambiguousType = count($oldTypes) !== 1 || count($newTypes) !== 1 || $oldTypes !== $newTypes;
        $status = lehrfahrer_gtfs_v1_line_status(isset($oldLines[$key]), isset($newLines[$key]),
            $o !== null, $n !== null, $public, $ambiguousType);
        $result['lineCounts'][$status]++;
        $result['lines'][] = ['line' => ($n ?? $o ?? $newLines[$key] ?? $oldLines[$key])['line'],
            'routeId' => ($n ?? $o ?? [])['routeId'] ?? null,
            'status' => $status, 'variantCount' => count($nv), 'previousVariantCount' => count($ov),
            'stopSequenceChanges' => $changes, 'variants' => $public];
    }
    return $result;
}

// The official ZIP takes minutes to stream. Keep only the derived report outside
// the immutable candidate package, bound to both SHA-checked ZIPs and this rule version.
function lehrfahrer_gtfs_routes_v1_cached(string $candidateZip, string $currentZip,
    string $cacheDir, string $candidateSha, string $currentSha): array {
    foreach ([$candidateSha, $currentSha] as $sha) {
        if (preg_match('/^[a-f0-9]{64}$/D', $sha) !== 1) throw new RuntimeException('GTFS-Vergleichs-SHA ist ungueltig.');
    }
    if (is_link($cacheDir)) throw new RuntimeException('GTFS-Vergleichscache ist ein Symlink.');
    if (!is_dir($cacheDir) && !mkdir($cacheDir, 0700)) throw new RuntimeException('GTFS-Vergleichscache kann nicht angelegt werden.');
    $path = $cacheDir . '/v1-8-' . $candidateSha . '-' . $currentSha . '.json';
    if (is_link($path)) throw new RuntimeException('GTFS-Vergleichscache ist ein Symlink.');
    if (is_file($path)) {
        $data = json_decode(strval(file_get_contents($path)), true);
        if (is_array($data) && ($data['candidateSha'] ?? '') === $candidateSha
            && ($data['currentSha'] ?? '') === $currentSha
            && ($data['rule'] ?? '') === 'routes-v1-8'
            && is_array($data['analysis'] ?? null)
            && ($data['analysis']['comparisonMode'] ?? '') === 'SERVICEGUELTIGE_STRECKEN_V1') {
            return $data['analysis'];
        }
        throw new RuntimeException('GTFS-Vergleichscache ist beschaedigt.');
    }
    $analysis = lehrfahrer_gtfs_compare_routes_v1($candidateZip, $currentZip);
    $payload = json_encode(['rule' => 'routes-v1-8', 'candidateSha' => $candidateSha,
        'currentSha' => $currentSha, 'analysis' => $analysis], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $temp = $cacheDir . '/.building-' . bin2hex(random_bytes(8));
    try {
        if (file_put_contents($temp, $payload, LOCK_EX) !== strlen($payload) || !chmod($temp, 0600)
            || !rename($temp, $path)) throw new RuntimeException('GTFS-Vergleichscache konnte nicht gespeichert werden.');
    } finally { if (is_file($temp)) unlink($temp); }
    return $analysis;
}
