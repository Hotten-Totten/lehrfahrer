<?php
declare(strict_types=1);

// Read-only, service-day comparison. Feed-local IDs never form cross-feed identities.
function lehrfahrer_gtfs_service_rows(ZipArchive $zip, string $name, array $required, callable $consume): void {
    $matches = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) if ($zip->getNameIndex($i) === $name) $matches++;
    if ($matches !== 1) throw new RuntimeException("GTFS-Tabelle fehlt oder ist mehrdeutig: $name");
    $stat = $zip->statName($name);
    if (!is_array($stat) || (int)$stat['size'] > 3000000000) throw new RuntimeException("GTFS-Tabelle ist zu gross: $name");
    $stream = $zip->getStream($name);
    if ($stream === false) throw new RuntimeException("GTFS-Tabelle ist nicht lesbar: $name");
    try {
        $header = fgetcsv($stream, null, ',', '"', '');
        if (!is_array($header)) throw new RuntimeException("GTFS-Header fehlt: $name");
        $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', strval($header[0]));
        foreach ($required as $field) if (!in_array($field, $header, true)) throw new RuntimeException("GTFS-Feld fehlt: $name/$field");
        while (($values = fgetcsv($stream, null, ',', '"', '')) !== false) {
            if (count($values) !== count($header)) throw new RuntimeException("GTFS-Zeile ist ungueltig: $name");
            $consume(array_combine($header, $values));
        }
    } finally {
        fclose($stream);
    }
}

function lehrfahrer_gtfs_service_date(string $value): DateTimeImmutable {
    if (!preg_match('/^\d{8}$/D', $value)) throw new RuntimeException('GTFS-Service-Datum ist ungueltig.');
    $date = DateTimeImmutable::createFromFormat('!Ymd', $value, new DateTimeZone('UTC'));
    if ($date === false || $date->format('Ymd') !== $value) throw new RuntimeException('GTFS-Service-Datum ist ungueltig.');
    return $date;
}

function lehrfahrer_gtfs_service_calendar(array $calendar, array $exceptions): array {
    $days = [];
    $week = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    foreach ($calendar as $service => $row) {
        $start = lehrfahrer_gtfs_service_date(strval($row['start_date']));
        $end = lehrfahrer_gtfs_service_date(strval($row['end_date']));
        if ($end < $start || $start->diff($end)->days > 3660) throw new RuntimeException('GTFS-Servicezeitraum ist unplausibel.');
        for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
            $weekday = (int)$day->format('N') - 1;
            if (($row[$week[$weekday]] ?? '') === '1') $days[$service][$day->format('Y-m-d')] = true;
        }
    }
    foreach ($exceptions as $row) {
        $service = strval($row['service_id']);
        $date = lehrfahrer_gtfs_service_date(strval($row['date']))->format('Y-m-d');
        if ($row['exception_type'] === '1') $days[$service][$date] = true;
        elseif ($row['exception_type'] === '2') unset($days[$service][$date]);
        else throw new RuntimeException('GTFS-Ausnahmetyp ist ungueltig.');
    }
    return $days;
}

function lehrfahrer_gtfs_service_feed(string $path): array {
    if (!is_file($path) || is_link($path) || !is_readable($path)) throw new RuntimeException('GTFS-ZIP ist nicht lesbar.');
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new RuntimeException('GTFS-ZIP ist ungueltig.');
    try {
        $agencies = [];
        lehrfahrer_gtfs_service_rows($zip, 'agency.txt', ['agency_id', 'agency_name'],
            static function (array $r) use (&$agencies): void { $agencies[] = $r; });
        $agencyId = lehrfahrer_gtfs_operator_id_from_rows($agencies);
        $routes = [];
        lehrfahrer_gtfs_service_rows($zip, 'routes.txt', ['route_id', 'agency_id', 'route_short_name', 'route_type'],
            static function (array $r) use (&$routes, $agencyId): void {
                if (strval($r['agency_id']) === $agencyId) $routes[strval($r['route_id'])] = $r;
            });
        if ($routes === []) throw new RuntimeException('Cottbusverkehr besitzt keine GTFS-Linien.');
        $trips = []; $services = [];
        lehrfahrer_gtfs_service_rows($zip, 'trips.txt', ['trip_id', 'route_id', 'service_id'],
            static function (array $r) use (&$trips, &$services, $routes): void {
                if (!isset($routes[strval($r['route_id'])])) return;
                $trips[strval($r['trip_id'])] = $r;
                $services[strval($r['service_id'])] = true;
            });
        $calendar = []; $exceptions = [];
        lehrfahrer_gtfs_service_rows($zip, 'calendar.txt', array_merge(['service_id', 'start_date', 'end_date'],
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
            static function (array $r) use (&$calendar, $services): void {
                if (isset($services[strval($r['service_id'])])) $calendar[strval($r['service_id'])] = $r;
            });
        lehrfahrer_gtfs_service_rows($zip, 'calendar_dates.txt', ['service_id', 'date', 'exception_type'],
            static function (array $r) use (&$exceptions, $services): void {
                if (isset($services[strval($r['service_id'])])) $exceptions[] = $r;
            });
        $dates = lehrfahrer_gtfs_service_calendar($calendar, $exceptions);
        $activeDays = [];
        foreach ($dates as $service => $serviceDays) foreach ($serviceDays as $date => $_) $activeDays[$date] = true;
        if ($activeDays === []) throw new RuntimeException('Cottbusverkehr besitzt keine aktiven GTFS-Betriebstage.');
        $dateKeys = array_keys($activeDays); sort($dateKeys, SORT_STRING);
        return ['path' => $path, 'agencyId' => $agencyId, 'routes' => $routes, 'trips' => $trips,
            'serviceDays' => $dates, 'activeDays' => $activeDays,
            'period' => ['start' => $dateKeys[0], 'end' => $dateKeys[count($dateKeys) - 1]],
            'tripCount' => count($trips), 'routeCount' => count($routes), 'serviceCount' => count($services)];
    } finally { $zip->close(); }
}

function lehrfahrer_gtfs_service_stop_key(array $stop): string {
    $name = trim(preg_replace('/\s+/u', ' ', strval($stop['stop_name'] ?? '')));
    if ($name === '' || !is_numeric($stop['stop_lat'] ?? null) || !is_numeric($stop['stop_lon'] ?? null)) {
        throw new RuntimeException('GTFS-Haltestelle besitzt keine eindeutigen Vergleichsmerkmale.');
    }
    $name = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    // Name plus ~10 m coordinates; ambiguous same-feed identities are rejected below.
    return $name . '|' . number_format((float)$stop['stop_lat'], 4, '.', '')
        . '|' . number_format((float)$stop['stop_lon'], 4, '.', '');
}

function lehrfahrer_gtfs_service_variants(array $feed, string $date): array {
    $active = [];
    foreach ($feed['trips'] as $id => $trip) {
        if (isset($feed['serviceDays'][strval($trip['service_id'])][$date])) $active[$id] = $trip;
    }
    $zip = new ZipArchive();
    if ($zip->open($feed['path']) !== true) throw new RuntimeException('GTFS-ZIP ist ungueltig.');
    try {
        $sequences = []; $usedStops = [];
        lehrfahrer_gtfs_service_rows($zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence'],
            static function (array $r) use (&$sequences, &$usedStops, $active): void {
                $id = strval($r['trip_id']);
                if (!isset($active[$id])) return;
                $sequence = strval($r['stop_sequence']);
                if (!ctype_digit($sequence) || isset($sequences[$id][(int)$sequence])) throw new RuntimeException('GTFS-Stopfolge ist ungueltig.');
                $sequences[$id][(int)$sequence] = strval($r['stop_id']);
                $usedStops[strval($r['stop_id'])] = true;
            });
        $stops = []; $keyOwner = [];
        lehrfahrer_gtfs_service_rows($zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
            static function (array $r) use (&$stops, &$keyOwner, $usedStops): void {
                $id = strval($r['stop_id']);
                if (!isset($usedStops[$id])) return;
                $key = lehrfahrer_gtfs_service_stop_key($r);
                if (isset($keyOwner[$key]) && $keyOwner[$key] !== $id) {
                    throw new RuntimeException('Mehrdeutige Haltestellenidentitaet im GTFS.');
                }
                $keyOwner[$key] = $id; $stops[$id] = ['key' => $key, 'name' => strval($r['stop_name'])];
            });
    } finally { $zip->close(); }
    $routes = []; $tripCount = 0;
    foreach ($active as $tripId => $trip) {
        $sequence = $sequences[$tripId] ?? [];
        ksort($sequence, SORT_NUMERIC);
        if (count($sequence) < 2) continue;
        $keys = []; $names = [];
        foreach ($sequence as $stopId) {
            if (!isset($stops[$stopId])) throw new RuntimeException('GTFS-Stopfolge verweist auf unbekannte Haltestelle.');
            $keys[] = $stops[$stopId]['key']; $names[] = $stops[$stopId]['name'];
        }
        $route = $feed['routes'][strval($trip['route_id'])];
        $line = trim(strval($route['route_short_name'])) . "\0" . strval($route['route_type']);
        if ($line === "\0" || (isset($routes[$line]) && $routes[$line]['routeId'] !== strval($route['route_id']))) {
            throw new RuntimeException('GTFS-Linienidentitaet ist mehrdeutig.');
        }
        $routes[$line] ??= ['line' => strval($route['route_short_name']), 'routeId' => strval($route['route_id']),
            'routeType' => strval($route['route_type']), 'variants' => [], 'tripCount' => 0];
        $routes[$line]['tripCount']++; $tripCount++;
        $signature = hash('sha256', json_encode($keys, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $routes[$line]['variants'][$signature] ??= ['signature' => $signature, 'stopKeys' => $keys,
            'stopNames' => $names, 'tripCount' => 0];
        $routes[$line]['variants'][$signature]['tripCount']++;
    }
    return ['routes' => $routes, 'tripCount' => $tripCount, 'lineCount' => count($routes)];
}

function lehrfahrer_gtfs_service_day_counts(array $feed, string $date): array {
    $count = 0; $lines = [];
    foreach ($feed['trips'] as $trip) {
        if (!isset($feed['serviceDays'][strval($trip['service_id'])][$date])) continue;
        $count++;
        $route = $feed['routes'][strval($trip['route_id'])];
        $lines[trim(strval($route['route_short_name'])) . "\0" . strval($route['route_type'])] = true;
    }
    return ['trips' => $count, 'lines' => count($lines)];
}

function lehrfahrer_gtfs_service_public_variant(array $variant, string $status): array {
    return ['status' => $status, 'variantId' => $variant['signature'],
        'headsign' => '', 'directionId' => '', 'stopCount' => count($variant['stopNames']),
        'startStop' => $variant['stopNames'][0], 'destination' => $variant['stopNames'][count($variant['stopNames']) - 1],
        'stopNames' => $variant['stopNames'], 'tripCount' => $variant['tripCount'], 'diff' => null];
}

function lehrfahrer_gtfs_compare_service_zips(string $candidateZip, string $currentZip, ?string $requestedDate = null): array {
    $candidate = lehrfahrer_gtfs_service_feed($candidateZip);
    $current = lehrfahrer_gtfs_service_feed($currentZip);
    if ($requestedDate !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $requestedDate)) {
        throw new InvalidArgumentException('Vergleichstag ist ungueltig.');
    }
    $shared = array_keys(array_intersect_key($candidate['activeDays'], $current['activeDays']));
    sort($shared, SORT_STRING);
    $candidateDays = array_keys($candidate['activeDays']); sort($candidateDays, SORT_STRING);
    $today = gmdate('Y-m-d');
    $date = $requestedDate ?? ($shared[0] ?? (isset($candidate['activeDays'][$today]) ? $today : $candidateDays[0]));
    $mode = $shared === [] ? 'KEINE_GEMEINSAME_FAHRPLANPERIODE'
        : ($requestedDate === null ? 'ERSTER_GEMEINSAMER_BETRIEBSTAG' : 'EXPLIZITER_BETRIEBSTAG');
    if ($requestedDate !== null && (!isset($candidate['activeDays'][$date]) || !isset($current['activeDays'][$date]))) {
        $mode = 'VERGLEICHSTAG_NICHT_IN_BEIDEN_FEEDS_AKTIV';
    }
    $candidateCounts = lehrfahrer_gtfs_service_day_counts($candidate, $date);
    $currentCounts = lehrfahrer_gtfs_service_day_counts($current, $date);
    $result = ['comparisonMode' => $mode, 'comparisonDate' => $date,
        'commonPeriod' => $shared !== [], 'comparable' => $date !== null && isset($candidate['activeDays'][$date], $current['activeDays'][$date]),
        'currentPeriod' => $current['period'], 'candidatePeriod' => $candidate['period'],
        'currentAgency' => $current['agencyId'], 'candidateAgency' => $candidate['agencyId'],
        'currentTotalTrips' => $current['tripCount'], 'candidateTotalTrips' => $candidate['tripCount'],
        'currentTotalLines' => $current['routeCount'], 'candidateTotalLines' => $candidate['routeCount'],
        'currentValidTrips' => $currentCounts['trips'], 'candidateValidTrips' => $candidateCounts['trips'],
        'currentValidLines' => $currentCounts['lines'], 'candidateValidLines' => $candidateCounts['lines'],
        'lineCounts' => ['NEU' => 0, 'GEAENDERT' => 0, 'UNVERAENDERT' => 0, 'ENTFALLEN' => 0], 'lines' => []];
    if (!$result['comparable']) return $result;
    $new = lehrfahrer_gtfs_service_variants($candidate, $date);
    $old = lehrfahrer_gtfs_service_variants($current, $date);
    $result['currentValidTrips'] = $old['tripCount']; $result['candidateValidTrips'] = $new['tripCount'];
    $result['currentValidLines'] = $old['lineCount']; $result['candidateValidLines'] = $new['lineCount'];
    $keys = array_unique(array_merge(array_keys($new['routes']), array_keys($old['routes'])));
    sort($keys, SORT_NATURAL | SORT_FLAG_CASE);
    foreach ($keys as $key) {
        $n = $new['routes'][$key] ?? null; $o = $old['routes'][$key] ?? null;
        $added = $n === null ? [] : array_diff_key($n['variants'], $o['variants'] ?? []);
        $removed = $o === null ? [] : array_diff_key($o['variants'], $n['variants'] ?? []);
        $status = $o === null ? 'NEU' : ($n === null ? 'ENTFALLEN' : (($added || $removed) ? 'GEAENDERT' : 'UNVERAENDERT'));
        $result['lineCounts'][$status]++;
        $changes = []; $paired = [];
        foreach ($added as $newSignature => $newVariant) {
            $matches = [];
            foreach ($removed as $oldSignature => $oldVariant) {
                if ($newVariant['stopKeys'][0] === $oldVariant['stopKeys'][0]
                    && $newVariant['stopKeys'][count($newVariant['stopKeys']) - 1]
                        === $oldVariant['stopKeys'][count($oldVariant['stopKeys']) - 1]) $matches[$oldSignature] = $oldVariant;
            }
            if (count($matches) !== 1) continue;
            $oldSignature = array_key_first($matches);
            $oldVariant = $matches[$oldSignature];
            $reverseMatches = array_filter($added, static fn(array $item): bool =>
                $item['stopKeys'][0] === $oldVariant['stopKeys'][0]
                && $item['stopKeys'][count($item['stopKeys']) - 1] === $oldVariant['stopKeys'][count($oldVariant['stopKeys']) - 1]);
            if (count($reverseMatches) !== 1) continue;
            $changes[] = ['previousStopNames' => $oldVariant['stopNames'],
                'newStopNames' => $newVariant['stopNames']];
            $paired[$newSignature] = true;
            unset($added[$newSignature], $removed[$oldSignature]);
        }
        $public = [];
        foreach ($n['variants'] ?? [] as $signature => $variant) {
            $public[] = lehrfahrer_gtfs_service_public_variant($variant,
                isset($o['variants'][$signature]) ? 'UNVERAENDERT' : (isset($paired[$signature]) ? 'GEAENDERT' : 'NEU'));
        }
        foreach ($removed as $variant) $public[] = lehrfahrer_gtfs_service_public_variant($variant, 'ENTFALLEN');
        $result['lines'][] = ['line' => ($n ?? $o)['line'], 'routeId' => ($n ?? $o)['routeId'],
            'previousRouteId' => $o['routeId'] ?? null, 'status' => $status,
            'variantCount' => count($n['variants'] ?? []), 'previousVariantCount' => count($o['variants'] ?? []),
            'tripCount' => $n['tripCount'] ?? 0, 'previousTripCount' => $o['tripCount'] ?? 0,
            'addedVariants' => array_values($added), 'removedVariants' => array_values($removed),
            'stopSequenceChanges' => $changes,
            'variants' => $public];
    }
    return $result;
}
