<?php
declare(strict_types=1);

const LEHRFAHRER_GTFS_CHANGE_VERSION = 1;
const LEHRFAHRER_GTFS_COTTBUS_NAME = 'Cottbusverkehr';

function lehrfahrer_gtfs_operator_id_from_rows(array $rows, string $operatorName = LEHRFAHRER_GTFS_COTTBUS_NAME): string {
    $matches = [];
    foreach ($rows as $row) {
        if (strcasecmp(trim(strval($row['agency_name'] ?? '')), $operatorName) !== 0) continue;
        $id = trim(strval($row['agency_id'] ?? ''));
        if ($id === '') throw new RuntimeException('GTFS-Betreiber hat keine Agency-ID.');
        $matches[] = $id;
    }
    if (count($matches) !== 1) throw new RuntimeException('Cottbusverkehr ist im GTFS nicht eindeutig identifizierbar.');
    return $matches[0];
}

function lehrfahrer_gtfs_operator_id_from_zip(ZipArchive $zip,
    string $operatorName = LEHRFAHRER_GTFS_COTTBUS_NAME): string {
    $matches = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        if ($zip->getNameIndex($i) === 'agency.txt') $matches++;
    }
    if ($matches !== 1) throw new RuntimeException('GTFS-agency.txt ist nicht eindeutig.');
    $entry = $zip->statName('agency.txt');
    if (!is_array($entry) || (int)($entry['size'] ?? 0) > 1048576) {
        throw new RuntimeException('GTFS-agency.txt fehlt oder ist zu gross.');
    }
    $stream = $zip->getStream('agency.txt');
    if ($stream === false) throw new RuntimeException('GTFS-agency.txt ist nicht lesbar.');
    try {
        $header = fgetcsv($stream, null, ',', '"', '');
        if (!is_array($header)) throw new RuntimeException('GTFS-Agency-Header fehlt.');
        $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', strval($header[0]));
        if (!in_array('agency_id', $header, true) || !in_array('agency_name', $header, true)) {
            throw new RuntimeException('GTFS-Agency-Pflichtfelder fehlen.');
        }
        $rows = [];
        while (($values = fgetcsv($stream, null, ',', '"', '')) !== false) {
            if (count($values) !== count($header)) throw new RuntimeException('GTFS-Agency-Zeile ist ungueltig.');
            $rows[] = array_combine($header, $values);
        }
        return lehrfahrer_gtfs_operator_id_from_rows($rows, $operatorName);
    } finally {
        fclose($stream);
    }
}

function lehrfahrer_gtfs_operator_id_from_index(string $path): string {
    if (!is_file($path) || is_link($path) || !is_readable($path)
        || file_get_contents($path, false, null, 0, 16) !== "SQLite format 3\0") {
        throw new RuntimeException('GTFS-Betreiberindex ist nicht lesbar.');
    }
    $pdo = new PDO('sqlite:file:' . $path . '?mode=ro', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA query_only=ON;');
    $rows = $pdo->query('SELECT agency_id, agency_name FROM agencies')->fetchAll(PDO::FETCH_ASSOC);
    $id = lehrfahrer_gtfs_operator_id_from_rows($rows);
    $meta = $pdo->query("SELECT value FROM meta WHERE key='agency_ids'")->fetchColumn();
    if (json_decode(strval($meta), true) !== [$id]) {
        throw new RuntimeException('GTFS-Index enthaelt nicht ausschliesslich Cottbusverkehr.');
    }
    $foreignRoutes = $pdo->prepare('SELECT COUNT(*) FROM routes WHERE agency_id <> ?');
    $foreignRoutes->execute([$id]);
    if ((int)$foreignRoutes->fetchColumn() !== 0) {
        throw new RuntimeException('GTFS-Index enthaelt Linien eines fremden Betreibers.');
    }
    return $id;
}

function lehrfahrer_gtfs_change_open_index(string $path, array $expectedAgencyIds): PDO {
    if (!is_file($path) || is_link($path) || !is_readable($path)) {
        throw new RuntimeException('GTFS-Vergleichsindex ist nicht lesbar.');
    }
    if (file_get_contents($path, false, null, 0, 16) !== "SQLite format 3\0") {
        throw new RuntimeException('GTFS-Vergleichsindex ist keine SQLite-Datei.');
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    $meta = $pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
    $agencyIds = json_decode(strval($meta['agency_ids'] ?? ''), true);
    if (!is_array($agencyIds)) throw new RuntimeException('GTFS-Index besitzt keine gueltige Betreiberbindung.');
    $agencyIds = array_values(array_unique(array_map('strval', $agencyIds)));
    $expectedAgencyIds = array_values(array_unique(array_map('strval', $expectedAgencyIds)));
    sort($agencyIds, SORT_STRING);
    sort($expectedAgencyIds, SORT_STRING);
    if ($agencyIds !== $expectedAgencyIds) {
        throw new RuntimeException('GTFS-Index enthaelt nicht ausschliesslich den erwarteten Betreiber.');
    }
    return $pdo;
}

function lehrfahrer_gtfs_change_read_index(string $path, array $expectedAgencyIds): array {
    $pdo = lehrfahrer_gtfs_change_open_index($path, $expectedAgencyIds);
    $routes = [];
    foreach ($pdo->query('SELECT route_id, agency_id, short_name, long_name, route_type FROM routes ORDER BY route_id') as $row) {
        $routeId = strval($row['route_id']);
        $routes[$routeId] = [
            'routeId' => $routeId,
            'agencyId' => strval($row['agency_id']),
            'shortName' => strval($row['short_name']),
            'longName' => strval($row['long_name']),
            'routeType' => strval($row['route_type']),
            'variants' => [],
        ];
    }
    $query = $pdo->query('SELECT route_id, variant_id, signature, direction_id, trip_headsign,
        stop_count, start_stop_name, end_stop_name, stops_json
        FROM variants ORDER BY route_id, direction_id, variant_id');
    foreach ($query as $row) {
        $routeId = strval($row['route_id']);
        if (!isset($routes[$routeId])) throw new RuntimeException('GTFS-Variante besitzt keine Linie.');
        $stops = json_decode(strval($row['stops_json']), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($stops) || count($stops) !== (int)$row['stop_count']) {
            throw new RuntimeException('GTFS-Variante besitzt inkonsistente Stopdaten.');
        }
        $stopIds = [];
        $stopNames = [];
        foreach ($stops as $stop) {
            if (!is_array($stop) || trim(strval($stop['stopId'] ?? '')) === '') {
                throw new RuntimeException('GTFS-Variante besitzt eine leere Stop-ID.');
            }
            $stopIds[] = strval($stop['stopId']);
            $stopNames[] = strval($stop['name'] ?? $stop['stopId']);
        }
        $routes[$routeId]['variants'][] = [
            'variantId' => strval($row['variant_id']),
            'signature' => strval($row['signature']),
            'directionId' => strval($row['direction_id']),
            'headsign' => strval($row['trip_headsign']),
            'stopCount' => (int)$row['stop_count'],
            'startStop' => strval($row['start_stop_name']),
            'destination' => strval($row['end_stop_name']),
            'stopIds' => $stopIds,
            'stopNames' => $stopNames,
        ];
    }
    $meta = $pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
    $pdo = null;
    return [
        'path' => $path,
        'sha256' => hash_file('sha256', $path),
        'createdAt' => strval($meta['created_at'] ?? ''),
        'routes' => $routes,
    ];
}

function lehrfahrer_gtfs_change_multiset(array $values): array {
    $counts = [];
    foreach ($values as $value) $counts[$value] = ($counts[$value] ?? 0) + 1;
    ksort($counts, SORT_STRING);
    return $counts;
}

function lehrfahrer_gtfs_change_variant_diff(array $current, array $previous): array {
    $currentCounts = lehrfahrer_gtfs_change_multiset($current['stopIds']);
    $previousCounts = lehrfahrer_gtfs_change_multiset($previous['stopIds']);
    $added = [];
    $removed = [];
    foreach ($currentCounts as $id => $count) {
        for ($i = 0; $i < max(0, $count - ($previousCounts[$id] ?? 0)); $i++) $added[] = $id;
    }
    foreach ($previousCounts as $id => $count) {
        for ($i = 0; $i < max(0, $count - ($currentCounts[$id] ?? 0)); $i++) $removed[] = $id;
    }
    $currentNames = array_combine($current['stopIds'], $current['stopNames']) ?: [];
    $previousNames = array_combine($previous['stopIds'], $previous['stopNames']) ?: [];
    return [
        'headsignChanged' => $current['headsign'] !== $previous['headsign'],
        'stopCountChanged' => $current['stopCount'] !== $previous['stopCount'],
        'orderChanged' => $currentCounts === $previousCounts && $current['stopIds'] !== $previous['stopIds'],
        'addedStopIds' => $added,
        'removedStopIds' => $removed,
        'addedStops' => array_map(static fn(string $id): string => strval($currentNames[$id] ?? $id), $added),
        'removedStops' => array_map(static fn(string $id): string => strval($previousNames[$id] ?? $id), $removed),
        'previousHeadsign' => $previous['headsign'],
        'previousStopCount' => $previous['stopCount'],
    ];
}

function lehrfahrer_gtfs_change_similarity(array $current, array $previous): float {
    if ($current['directionId'] !== $previous['directionId']) return -1.0;
    $a = array_values(array_unique($current['stopIds']));
    $b = array_values(array_unique($previous['stopIds']));
    $intersection = count(array_intersect($a, $b));
    $union = count(array_unique(array_merge($a, $b)));
    $score = $union > 0 ? $intersection / $union : 0.0;
    if ($current['headsign'] !== '' && $current['headsign'] === $previous['headsign']) $score += 0.15;
    if ($current['startStop'] !== '' && $current['startStop'] === $previous['startStop']) $score += 0.05;
    if ($current['destination'] !== '' && $current['destination'] === $previous['destination']) $score += 0.05;
    return $score;
}

function lehrfahrer_gtfs_change_public_variant(array $variant, string $status, ?array $previous = null): array {
    $result = [
        'status' => $status,
        'variantId' => $variant['variantId'],
        'directionId' => $variant['directionId'],
        'headsign' => $variant['headsign'],
        'stopCount' => $variant['stopCount'],
        'startStop' => $variant['startStop'],
        'destination' => $variant['destination'],
        'stopIds' => $variant['stopIds'],
        'stopNames' => $variant['stopNames'],
        'diff' => null,
        'previousVariantId' => $previous !== null ? strval($previous['variantId'] ?? '') : null,
    ];
    if ($previous !== null) $result['diff'] = lehrfahrer_gtfs_change_variant_diff($variant, $previous);
    return $result;
}

function lehrfahrer_gtfs_compare_route(array $current, array $previous): array {
    $currentVariants = $current['variants'];
    $previousVariants = $previous['variants'];
    $usedCurrent = [];
    $usedPrevious = [];
    $variants = [];

    foreach ($currentVariants as $ci => $candidate) {
        foreach ($previousVariants as $pi => $old) {
            if (isset($usedPrevious[$pi]) || $candidate['directionId'] !== $old['directionId']
                || $candidate['signature'] !== $old['signature']) continue;
            $usedCurrent[$ci] = true;
            $usedPrevious[$pi] = true;
            $changed = $candidate['headsign'] !== $old['headsign'];
            $variants[] = lehrfahrer_gtfs_change_public_variant($candidate, $changed ? 'GEAENDERT' : 'UNVERAENDERT', $old);
            break;
        }
    }

    $pairs = [];
    foreach ($currentVariants as $ci => $candidate) {
        if (isset($usedCurrent[$ci])) continue;
        foreach ($previousVariants as $pi => $old) {
            if (isset($usedPrevious[$pi])) continue;
            $score = lehrfahrer_gtfs_change_similarity($candidate, $old);
            if ($score >= 0.5) $pairs[] = ['current' => $ci, 'previous' => $pi, 'score' => $score];
        }
    }
    usort($pairs, static function (array $a, array $b): int {
        $scoreOrder = $b['score'] <=> $a['score'];
        if ($scoreOrder !== 0) return $scoreOrder;
        return [$a['current'], $a['previous']] <=> [$b['current'], $b['previous']];
    });
    foreach ($pairs as $pair) {
        $ci = $pair['current'];
        $pi = $pair['previous'];
        if (isset($usedCurrent[$ci]) || isset($usedPrevious[$pi])) continue;
        $usedCurrent[$ci] = true;
        $usedPrevious[$pi] = true;
        $variants[] = lehrfahrer_gtfs_change_public_variant($currentVariants[$ci], 'GEAENDERT', $previousVariants[$pi]);
    }
    foreach ($currentVariants as $ci => $candidate) {
        if (!isset($usedCurrent[$ci])) $variants[] = lehrfahrer_gtfs_change_public_variant($candidate, 'NEU');
    }
    foreach ($previousVariants as $pi => $old) {
        if (!isset($usedPrevious[$pi])) $variants[] = lehrfahrer_gtfs_change_public_variant($old, 'ENTFALLEN');
    }
    usort($variants, static fn(array $a, array $b): int => [$a['directionId'], $a['headsign'], $a['variantId'], $a['status']]
        <=> [$b['directionId'], $b['headsign'], $b['variantId'], $b['status']]);
    $metadataChanged = $current['shortName'] !== $previous['shortName']
        || $current['longName'] !== $previous['longName']
        || $current['routeType'] !== $previous['routeType'];
    $status = !$metadataChanged && count(array_filter($variants, static fn(array $variant): bool => $variant['status'] !== 'UNVERAENDERT')) === 0
        ? 'UNVERAENDERT' : 'GEAENDERT';
    return ['status' => $status, 'variants' => $variants, 'metadataChanged' => $metadataChanged];
}

function lehrfahrer_gtfs_routes_by_identity(array $routes): array {
    $result = [];
    foreach ($routes as $route) {
        $name = strtolower(trim(strval($route['shortName'])));
        if ($name === '') throw new RuntimeException('GTFS-Linie ohne eindeutigen Liniennamen.');
        $key = $name . "\0" . strval($route['routeType']);
        if (isset($result[$key])) throw new RuntimeException('GTFS-Linienidentitaet ist mehrdeutig.');
        $result[$key] = $route;
    }
    return $result;
}

function lehrfahrer_gtfs_compare_operator_indexes(string $currentPath, ?string $previousPath): array {
    $currentId = lehrfahrer_gtfs_operator_id_from_index($currentPath);
    $previousId = $previousPath !== null && is_file($previousPath)
        ? lehrfahrer_gtfs_operator_id_from_index($previousPath) : $currentId;
    return lehrfahrer_gtfs_compare_indexes($currentPath, $previousPath, [$currentId], [$previousId], true);
}

function lehrfahrer_gtfs_compare_indexes(string $currentPath, ?string $previousPath, array $expectedAgencyIds,
    ?array $previousAgencyIds = null, bool $matchByLine = false): array {
    $current = lehrfahrer_gtfs_change_read_index($currentPath, $expectedAgencyIds);
    $previousAvailable = $previousPath !== null && is_file($previousPath);
    $previous = $previousAvailable
        ? lehrfahrer_gtfs_change_read_index($previousPath, $previousAgencyIds ?? $expectedAgencyIds)
        : ['sha256' => null, 'createdAt' => '', 'routes' => []];
    if ($matchByLine) {
        $current['routes'] = lehrfahrer_gtfs_routes_by_identity($current['routes']);
        $previous['routes'] = lehrfahrer_gtfs_routes_by_identity($previous['routes']);
    }
    $routeIds = array_values(array_unique(array_merge(array_keys($current['routes']), array_keys($previous['routes']))));
    sort($routeIds, SORT_NATURAL | SORT_FLAG_CASE);
    $lines = [];
    $lineCounts = array_fill_keys(['NEU', 'GEAENDERT', 'UNVERAENDERT', 'ENTFALLEN'], 0);
    $variantCounts = array_fill_keys(['NEU', 'GEAENDERT', 'UNVERAENDERT', 'ENTFALLEN'], 0);
    foreach ($routeIds as $routeId) {
        $new = $current['routes'][$routeId] ?? null;
        $old = $previous['routes'][$routeId] ?? null;
        if ($new !== null && $old === null) {
            $status = 'NEU';
            $variants = array_map(static fn(array $variant): array => lehrfahrer_gtfs_change_public_variant($variant, 'NEU'), $new['variants']);
            $route = $new;
            $metadataChanged = false;
        } elseif ($new === null && $old !== null) {
            $status = 'ENTFALLEN';
            $variants = array_map(static fn(array $variant): array => lehrfahrer_gtfs_change_public_variant($variant, 'ENTFALLEN'), $old['variants']);
            $route = $old;
            $metadataChanged = false;
        } else {
            $comparison = lehrfahrer_gtfs_compare_route($new, $old);
            $status = $comparison['status'];
            $variants = $comparison['variants'];
            $route = $new;
            $metadataChanged = $comparison['metadataChanged'];
        }
        $lineCounts[$status]++;
        foreach ($variants as $variant) $variantCounts[$variant['status']]++;
        $lines[] = [
            'routeId' => $route['routeId'],
            'previousRouteId' => $old !== null ? $old['routeId'] : null,
            'line' => $route['shortName'] !== '' ? $route['shortName'] : $route['routeId'],
            'longName' => $route['longName'],
            'routeType' => $route['routeType'],
            'status' => $status,
            'metadataChanged' => $metadataChanged,
            'variantCount' => count(array_filter($variants, static fn(array $variant): bool => $variant['status'] !== 'ENTFALLEN')),
            'previousVariantCount' => $old !== null ? count($old['variants']) : 0,
            'variants' => $variants,
        ];
    }
    return [
        'version' => LEHRFAHRER_GTFS_CHANGE_VERSION,
        'baselineAvailable' => $previousAvailable,
        'agencyIds' => array_values($expectedAgencyIds),
        'previousAgencyIds' => array_values($previousAgencyIds ?? $expectedAgencyIds),
        'current' => [
            'sha256' => $current['sha256'],
            'createdAt' => $current['createdAt'],
            'routeCount' => count($current['routes']),
            'variantCount' => array_sum(array_map(static fn(array $route): int => count($route['variants']), $current['routes'])),
        ],
        'previous' => [
            'sha256' => $previous['sha256'],
            'createdAt' => $previous['createdAt'],
            'routeCount' => count($previous['routes']),
            'variantCount' => array_sum(array_map(static fn(array $route): int => count($route['variants']), $previous['routes'])),
        ],
        'lineCounts' => $lineCounts,
        'variantCounts' => $variantCounts,
        'reviewRequiredLineCount' => $lineCounts['GEAENDERT'] + $lineCounts['ENTFALLEN'],
        'lines' => $lines,
    ];
}

function lehrfahrer_gtfs_working_set(array $analysis, string $scope): array {
    if (!in_array($scope, ['new', 'new_changed', 'all'], true)) {
        throw new InvalidArgumentException('Ungueltiger Uebernahmeumfang.');
    }
    $routeStatuses = $scope === 'new' ? ['NEU'] : ($scope === 'new_changed' ? ['NEU', 'GEAENDERT'] : ['NEU', 'GEAENDERT', 'UNVERAENDERT']);
    $routes = [];
    $variantCount = 0;
    foreach ($analysis['lines'] as $line) {
        if (!in_array($line['status'], $routeStatuses, true) || $line['status'] === 'ENTFALLEN') continue;
        $variantIds = [];
        foreach ($line['variants'] as $variant) {
            if ($variant['status'] === 'ENTFALLEN') continue;
            $variantIds[] = $variant['variantId'];
        }
        sort($variantIds, SORT_STRING);
        $routes[] = [
            'routeId' => $line['routeId'],
            'line' => $line['line'],
            'status' => $line['status'],
            'reviewRequired' => $line['status'] === 'GEAENDERT',
            'variantIds' => $variantIds,
        ];
        $variantCount += count($variantIds);
    }
    usort($routes, static fn(array $a, array $b): int => strnatcasecmp(strval($a['routeId']), strval($b['routeId'])));
    $expectedRoutes = (int)$analysis['current']['routeCount'];
    $expectedVariants = (int)$analysis['current']['variantCount'];
    return [
        'version' => LEHRFAHRER_GTFS_CHANGE_VERSION,
        'scope' => $scope,
        'agencyIds' => $analysis['agencyIds'],
        'sourceIndexSha256' => $analysis['current']['sha256'],
        'createdAt' => date('c'),
        'routes' => $routes,
        'completeness' => [
            'expectedRouteCount' => $expectedRoutes,
            'expectedVariantCount' => $expectedVariants,
            'adoptedRouteCount' => count($routes),
            'adoptedVariantCount' => $variantCount,
            'missingRouteCount' => max(0, $expectedRoutes - count($routes)),
            'missingVariantCount' => max(0, $expectedVariants - $variantCount),
            'complete' => count($routes) === $expectedRoutes && $variantCount === $expectedVariants,
        ],
        'warning' => count($routes) === $expectedRoutes && $variantCount === $expectedVariants
            ? null : 'Nicht alle Linien/Varianten wurden uebernommen.',
    ];
}

function lehrfahrer_gtfs_write_working_set(string $path, array $workingSet): void {
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) {
        throw new RuntimeException('GTFS-Arbeitsstand kann nicht vorbereitet werden.');
    }
    $json = json_encode($workingSet, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $temp = $path . '.tmp-' . bin2hex(random_bytes(8));
    if (file_put_contents($temp, $json, LOCK_EX) === false) throw new RuntimeException('GTFS-Arbeitsstand kann nicht geschrieben werden.');
    @chmod($temp, 0600);
    if (!@rename($temp, $path)) {
        @unlink($temp);
        throw new RuntimeException('GTFS-Arbeitsstand kann nicht atomar aktiviert werden.');
    }
}
