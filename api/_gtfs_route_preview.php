<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_route_selection.php';

function lehrfahrer_gtfs_preview_name(string $value): string {
    $value = trim(preg_replace('/\s+/u', ' ', $value));
    $value = preg_replace('/^cottbus\s*,\s*/iu', '', $value) ?? $value;
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function lehrfahrer_gtfs_preview_line_name(string $value): string {
    return lehrfahrer_gtfs_preview_name(preg_replace('/^linie\s+/iu', '', trim($value)) ?? $value);
}

function lehrfahrer_gtfs_preview_route_files(string $cityRoot, string $line): array {
    if (is_link($cityRoot) || !is_dir($cityRoot)) return [];
    $routes = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($cityRoot, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink() || !$file->isFile() || strtolower($file->getExtension()) !== 'json') continue;
        $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($cityRoot) + 1));
        $parts = explode('/', $relative);
        if (count($parts) > 3 || in_array('backup', $parts, true)) continue;
        $data = json_decode(strval(file_get_contents($file->getPathname())), true);
        if (!is_array($data)) continue;
        $routeLine = strval($data['lineName'] ?? ($data['line']['lineName'] ?? ''));
        if (lehrfahrer_gtfs_preview_line_name($routeLine) !== lehrfahrer_gtfs_preview_line_name($line)) continue;
        $stops = $data['stops'] ?? [];
        if (!is_array($stops)) continue;
        $names = [];
        foreach ($stops as $stop) {
            if (!is_array($stop)) continue;
            $name = trim(strval($stop['name'] ?? ''));
            if ($name !== '') $names[] = $name;
        }
        $routes[] = ['id' => 'cottbus/' . preg_replace('/\.json$/i', '', $relative),
            'routeNumber' => trim(preg_replace('/^Route\s+/iu', '', strval($data['routeName'] ?? ($data['line']['routeName'] ?? '')))),
            'variantName' => strval($data['variantName'] ?? ($data['line']['variantName'] ?? '')),
            'category' => strval($data['variantCategory'] ?? ($data['line']['variantCategory'] ?? '')),
            'stopNames' => $names, 'stopCount' => count($names)];
    }
    usort($routes, static fn(array $a, array $b): int => strcmp($a['id'], $b['id']));
    return $routes;
}

function lehrfahrer_gtfs_preview_overlap(array $a, array $b): int {
    $counts = array_count_values($b);
    $overlap = 0;
    foreach ($a as $name) {
        if (($counts[$name] ?? 0) > 0) { $overlap++; $counts[$name]--; }
    }
    return $overlap;
}

function lehrfahrer_gtfs_preview_plausible(array $candidate, array $existing): bool {
    if (count($candidate) < 2 || count($existing) < 2) return false;
    if ($candidate[0] === $existing[0] && $candidate[count($candidate) - 1] === $existing[count($existing) - 1]) return true;
    $sameEndpoint = $candidate[0] === $existing[0]
        || $candidate[count($candidate) - 1] === $existing[count($existing) - 1];
    return $sameEndpoint && lehrfahrer_gtfs_preview_overlap($candidate, $existing) >= 3
        && lehrfahrer_gtfs_preview_overlap($candidate, $existing) * 2 >= min(count($candidate), count($existing));
}

function lehrfahrer_gtfs_preview_difference(array $candidate, array $existing): array {
    $new = array_map('lehrfahrer_gtfs_preview_name', $candidate);
    $old = array_map('lehrfahrer_gtfs_preview_name', $existing);
    $newCounts = array_count_values($new);
    $oldCounts = array_count_values($old);
    $added = []; $removed = [];
    $seen = [];
    foreach ($candidate as $i => $name) {
        $key = $new[$i]; $seen[$key] = ($seen[$key] ?? 0) + 1;
        if ($seen[$key] > ($oldCounts[$key] ?? 0)) $added[] = $name;
    }
    $seen = [];
    foreach ($existing as $i => $name) {
        $key = $old[$i]; $seen[$key] = ($seen[$key] ?? 0) + 1;
        if ($seen[$key] > ($newCounts[$key] ?? 0)) $removed[] = $name;
    }
    // Compare the order of shared stops, including repeated stop names.
    $commonNew = []; $seen = [];
    foreach ($new as $name) if (($seen[$name] ?? 0) < min($newCounts[$name], $oldCounts[$name] ?? 0)) {
        $commonNew[] = $name; $seen[$name] = ($seen[$name] ?? 0) + 1;
    }
    $commonOld = []; $seen = [];
    foreach ($old as $name) if (($seen[$name] ?? 0) < min($oldCounts[$name], $newCounts[$name] ?? 0)) {
        $commonOld[] = $name; $seen[$name] = ($seen[$name] ?? 0) + 1;
    }
    return ['addedStops' => $added, 'removedStops' => $removed, 'orderChanged' => $commonNew !== $commonOld];
}

function lehrfahrer_gtfs_preview_line(array $analysis, array $selected, array $routes, string $line): array {
    $target = null;
    foreach ($analysis['lines'] ?? [] as $item) if (($item['line'] ?? '') === $line) { $target = $item; break; }
    if ($target === null) throw new RuntimeException('Pilotlinie fehlt im Kandidatenvergleich.');
    $results = [];
    foreach ($target['variants'] ?? [] as $variant) {
        $key = strval($variant['selectionKey'] ?? '');
        if ($key === '' || !isset($selected[lehrfahrer_gtfs_route_selection_id($line, $key)])) continue;
        $names = array_values(array_map('strval', $variant['stopNames'] ?? []));
        $normalized = array_map('lehrfahrer_gtfs_preview_name', $names);
        $exact = []; $plausible = [];
        foreach ($routes as $route) {
            $existing = array_map('lehrfahrer_gtfs_preview_name', $route['stopNames']);
            if ($normalized === $existing) $exact[] = $route;
            elseif (lehrfahrer_gtfs_preview_plausible($normalized, $existing)) $plausible[] = $route;
        }
        $matches = $exact !== [] ? $exact : $plausible;
        $status = count($matches) > 1 ? 'KONFLIKT'
            : ($exact !== [] ? 'IDENTISCH' : ($matches !== [] ? 'ANPASSUNG_NOETIG' : 'NEUE_ROUTE_ERFORDERLICH'));
        $result = ['line' => $line, 'selectionKey' => $key, 'startStop' => $names[0] ?? '',
            'destination' => $names[count($names) - 1] ?? '', 'stopCount' => count($names),
            'stopNames' => $names, 'result' => $status, 'matches' => []];
        foreach ($matches as $route) {
            $match = ['id' => $route['id'], 'variantName' => $route['variantName'],
                'category' => $route['category'], 'stopCount' => $route['stopCount']];
            if ($status === 'ANPASSUNG_NOETIG') $match['difference'] = lehrfahrer_gtfs_preview_difference(
                $names, $route['stopNames']);
            $result['matches'][] = $match;
        }
        $results[] = $result;
    }
    return ['line' => $line, 'selectedVariantCount' => count($results),
        'existingRouteCount' => count($routes), 'variants' => $results];
}

function lehrfahrer_gtfs_preview_creation_proposals(array $preview, string $candidateSha): array {
    if (preg_match('/^[a-f0-9]{64}$/D', $candidateSha) !== 1) {
        throw new InvalidArgumentException('Ungueltiger GTFS-Candidate-SHA.');
    }
    foreach ($preview['variants'] ?? [] as $index => $variant) {
        if (($variant['result'] ?? '') !== 'NEUE_ROUTE_ERFORDERLICH') continue;
        $preview['variants'][$index]['creationPreview'] = [
            'label' => 'NEUE LEHRFAHRER-ROUTE',
            'line' => strval($variant['line']),
            'proposedRoute' => 'Linie ' . strval($variant['line']) . ' · neue Lehrfahrer-Route',
            'routeNumber' => 'noch festzulegen',
            'startStop' => strval($variant['startStop']),
            'destination' => strval($variant['destination']),
            'stopCount' => (int)$variant['stopCount'],
            'stopNames' => $variant['stopNames'],
            'category' => 'noch festzulegen',
            'variant' => strval($variant['startStop']) . ' → ' . strval($variant['destination']),
            'candidateSha256' => $candidateSha,
        ];
    }
    return $preview;
}
