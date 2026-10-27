<?php
declare(strict_types=1);

const LEHRFAHRER_GTFS_WORK_VERSION = 1;
const LEHRFAHRER_GTFS_WORK_STATUSES = ['UNGEPRUEFT', 'IN_BEARBEITUNG', 'GEPRUEFT', 'FREIGEGEBEN'];

function lehrfahrer_gtfs_work_inventory_path(string $companyId): string {
    return lehrfahrer_tenant_path($companyId, 'imports', 'gtfs/index/work-inventory.json');
}

function lehrfahrer_gtfs_work_drafts_dir(string $companyId): string {
    return lehrfahrer_tenant_ensure_directory($companyId, 'imports', 'gtfs/work-routes');
}

function lehrfahrer_gtfs_work_key(string $routeId, string $variantId): string {
    return hash('sha256', $routeId . "\0" . $variantId);
}

function lehrfahrer_gtfs_work_read_json(string $path): ?array {
    if (!is_file($path) || is_link($path)) return null;
    $decoded = json_decode(strval(@file_get_contents($path)), true);
    return is_array($decoded) ? $decoded : null;
}

function lehrfahrer_gtfs_work_write_json(string $path, array $payload): void {
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht vorbereitet werden.');
    }
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(8));
    if (file_put_contents($temporary, $json, LOCK_EX) === false) throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht geschrieben werden.');
    @chmod($temporary, 0600);
    if (!@rename($temporary, $path)) {
        @unlink($temporary);
        throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht atomar aktiviert werden.');
    }
}

function lehrfahrer_gtfs_work_existing_entries(string $companyId): array {
    $inventory = lehrfahrer_gtfs_work_read_json(lehrfahrer_gtfs_work_inventory_path($companyId));
    $result = [];
    foreach (($inventory['entries'] ?? []) as $entry) {
        if (!is_array($entry)) continue;
        $routeId = trim(strval($entry['routeId'] ?? ''));
        $variantId = trim(strval($entry['variantId'] ?? ''));
        if ($routeId === '' || $variantId === '') continue;
        $result[lehrfahrer_gtfs_work_key($routeId, $variantId)] = $entry;
    }
    return $result;
}

function lehrfahrer_gtfs_work_reconcile(string $companyId, string $indexPath, array $agencyIds): array {
    $index = lehrfahrer_gtfs_change_read_index($indexPath, $agencyIds);
    $comparisonStatuses = [];
    $previousKeys = [];
    $previousPath = dirname($indexPath) . DIRECTORY_SEPARATOR . 'variants.sqlite.previous';
    if (is_file($previousPath)) {
        $analysis = lehrfahrer_gtfs_compare_operator_indexes($indexPath, $previousPath);
        foreach ($analysis['lines'] as $line) {
            foreach ($line['variants'] as $variant) {
                if (($variant['status'] ?? '') === 'ENTFALLEN') continue;
                $currentKey = lehrfahrer_gtfs_work_key(strval($line['routeId']), strval($variant['variantId']));
                $comparisonStatuses[$currentKey] = strval($variant['status']);
                $previousVariantId = trim(strval($variant['previousVariantId'] ?? ''));
                if ($previousVariantId !== '') {
                    $previousKeys[$currentKey] = lehrfahrer_gtfs_work_key(strval($line['previousRouteId'] ?? $line['routeId']), $previousVariantId);
                }
            }
        }
    }
    $oldInventory = lehrfahrer_gtfs_work_read_json(lehrfahrer_gtfs_work_inventory_path($companyId)) ?? [];
    $oldEntries = [];
    foreach (($oldInventory['entries'] ?? []) as $entry) {
        if (!is_array($entry)) continue;
        $key = lehrfahrer_gtfs_work_key(strval($entry['routeId'] ?? ''), strval($entry['variantId'] ?? ''));
        $oldEntries[$key] = $entry;
    }
    $sameIndex = hash_equals(strval($oldInventory['sourceIndexSha256'] ?? ''), strval($index['sha256']));
    $entries = [];
    $currentKeys = [];
    foreach ($index['routes'] as $route) {
        foreach ($route['variants'] as $variant) {
            $routeId = strval($route['routeId']);
            $variantId = strval($variant['variantId']);
            $key = lehrfahrer_gtfs_work_key($routeId, $variantId);
            $currentKeys[$key] = true;
            $oldKey = isset($oldEntries[$key]) ? $key : ($previousKeys[$key] ?? $key);
            $currentKeys[$oldKey] = true;
            $old = $oldEntries[$oldKey] ?? null;
            $status = is_array($old) && in_array(($old['status'] ?? ''), LEHRFAHRER_GTFS_WORK_STATUSES, true)
                ? strval($old['status']) : 'UNGEPRUEFT';
            $timetableStatus = $comparisonStatuses[$key] ?? ($old === null ? 'NEU' : 'UNVERAENDERT');
            if (!$sameIndex && in_array($timetableStatus, ['NEU', 'GEAENDERT'], true)) $status = 'UNGEPRUEFT';
            $entries[] = [
                'key' => $key,
                'routeId' => $routeId,
                'variantId' => $variantId,
                'line' => trim(strval($route['shortName'])) !== '' ? strval($route['shortName']) : $routeId,
                'directionId' => strval($variant['directionId']),
                'destination' => trim(strval($variant['headsign'])) !== '' ? strval($variant['headsign']) : strval($variant['destination']),
                'startStop' => strval($variant['startStop']),
                'endStop' => strval($variant['destination']),
                'stopNames' => $variant['stopNames'],
                'stopCount' => (int)$variant['stopCount'],
                'signature' => strval($variant['signature']),
                'status' => $status,
                'timetableStatus' => $timetableStatus,
                'reviewRequired' => $status !== 'FREIGEGEBEN',
                'draftPrepared' => is_file(lehrfahrer_gtfs_work_drafts_dir($companyId) . DIRECTORY_SEPARATOR . $key . '.json'),
                'savedRoute' => is_array($old) ? ($old['savedRoute'] ?? null) : null,
                'updatedAt' => is_array($old) ? ($old['updatedAt'] ?? null) : null,
            ];
        }
    }
    foreach ($oldEntries as $key => $old) {
        if (isset($currentKeys[$key])) continue;
        $old['timetableStatus'] = 'ENTFALLEN';
        $old['reviewRequired'] = true;
        $entries[] = $old;
    }
    usort($entries, static function (array $a, array $b): int {
        $lineOrder = strnatcasecmp(strval($a['line']), strval($b['line']));
        if ($lineOrder !== 0) return $lineOrder;
        return [strval($a['directionId']), strval($a['destination']), strval($a['variantId'])]
            <=> [strval($b['directionId']), strval($b['destination']), strval($b['variantId'])];
    });
    $currentEntries = array_values(array_filter($entries, static fn(array $entry): bool => ($entry['timetableStatus'] ?? '') !== 'ENTFALLEN'));
    $lines = [];
    foreach ($currentEntries as $entry) $lines[strval($entry['routeId'])] = true;
    $inventory = [
        'version' => LEHRFAHRER_GTFS_WORK_VERSION,
        'agencyIds' => array_values(array_map('strval', $agencyIds)),
        'sourceIndexSha256' => $index['sha256'],
        'updatedAt' => date('c'),
        'completeness' => [
            'expectedLineCount' => count($index['routes']),
            'capturedLineCount' => count($lines),
            'expectedVariantCount' => array_sum(array_map(static fn(array $route): int => count($route['variants']), $index['routes'])),
            'capturedVariantCount' => count($currentEntries),
        ],
        'entries' => $entries,
    ];
    $inventory['completeness']['complete'] = $inventory['completeness']['expectedLineCount'] === $inventory['completeness']['capturedLineCount']
        && $inventory['completeness']['expectedVariantCount'] === $inventory['completeness']['capturedVariantCount'];
    lehrfahrer_gtfs_work_write_json(lehrfahrer_gtfs_work_inventory_path($companyId), $inventory);
    return $inventory;
}

function lehrfahrer_gtfs_work_variant_row(string $indexPath, string $routeId, string $variantId): array {
    $pdo = lehrfahrer_gtfs_change_open_index($indexPath, [lehrfahrer_gtfs_operator_id_from_index($indexPath)]);
    $statement = $pdo->prepare('SELECT v.*, r.short_name, r.long_name FROM variants v JOIN routes r ON r.route_id=v.route_id WHERE v.route_id=? AND v.variant_id=?');
    $statement->execute([$routeId, $variantId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    $pdo = null;
    if (!is_array($row)) throw new RuntimeException('GTFS-Variante wurde nicht gefunden.');
    $items = json_decode(strval($row['stops_json']), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($items) || count($items) < 2) throw new RuntimeException('GTFS-Variante besitzt keine vollstaendige Haltestellenfolge.');
    $row['items'] = $items;
    return $row;
}

function lehrfahrer_gtfs_work_build_line(array $row): array {
    $stops = [];
    foreach ($row['items'] as $item) {
        if (!is_numeric($item['lat'] ?? null) || !is_numeric($item['lon'] ?? null)) {
            throw new RuntimeException('GTFS-Variante besitzt unvollstaendige Stopkoordinaten.');
        }
        $stops[] = [
            'id' => 'stop_' . (count($stops) + 1), 'stopId' => strval($item['stopId']), 'catalogId' => strval($item['stopId']),
            'name' => strval($item['name'] ?? $item['stopId']), 'lat' => round((float)$item['lat'], 6), 'lon' => round((float)$item['lon'], 6),
            'stopSequence' => (int)($item['sequence'] ?? count($stops) + 1), 'order' => (int)($item['sequence'] ?? count($stops) + 1),
            'sourceType' => 'catalog', 'note' => '', 'isGhostPoint' => false,
        ];
    }
    $lineName = trim(strval($row['short_name'])) !== '' ? strval($row['short_name']) : strval($row['route_id']);
    $direction = trim(strval($row['trip_headsign'])) !== '' ? strval($row['trip_headsign']) : ($stops[0]['name'] . ' - ' . $stops[count($stops) - 1]['name']);
    return [
        'lineName' => 'Linie ' . preg_replace('/^Linie\s+/i', '', $lineName), 'routeName' => 'Route 01', 'directionName' => $direction,
        'variantName' => $direction, 'variantCategory' => 'Standard', 'color' => '#d32f2f', 'routeMode' => 'auto',
        'routingMode' => 'guidedStreet', 'preserveManualChains' => true, 'placementMode' => 'freeStop',
        'stops' => $stops, 'routePoints' => [], 'routePointsSimplified' => [],
        'meta' => [
            'source' => 'GTFS-Arbeitsvorrat', 'importsTimetable' => false, 'importedAt' => date('c'),
            'gtfsWork' => ['routeId' => strval($row['route_id']), 'variantId' => strval($row['variant_id']), 'signature' => strval($row['signature'])],
        ],
    ];
}

function lehrfahrer_gtfs_work_prepare(string $companyId, string $indexPath, string $routeId, string $variantId): array {
    $key = lehrfahrer_gtfs_work_key($routeId, $variantId);
    $path = lehrfahrer_gtfs_work_drafts_dir($companyId) . DIRECTORY_SEPARATOR . $key . '.json';
    if (!is_file($path)) lehrfahrer_gtfs_work_write_json($path, lehrfahrer_gtfs_work_build_line(lehrfahrer_gtfs_work_variant_row($indexPath, $routeId, $variantId)));
    $draft = lehrfahrer_gtfs_work_read_json($path);
    if (!is_array($draft)) throw new RuntimeException('GTFS-Arbeitsentwurf ist nicht lesbar.');
    return $draft;
}

function lehrfahrer_gtfs_work_prepare_all(string $companyId, string $indexPath, array $inventory): int {
    $count = 0;
    foreach ($inventory['entries'] as $entry) {
        if (($entry['timetableStatus'] ?? '') === 'ENTFALLEN') continue;
        lehrfahrer_gtfs_work_prepare($companyId, $indexPath, strval($entry['routeId']), strval($entry['variantId']));
        $count++;
    }
    return $count;
}

function lehrfahrer_gtfs_work_update_entry(string $companyId, string $routeId, string $variantId, callable $update): array {
    $path = lehrfahrer_gtfs_work_inventory_path($companyId);
    $inventory = lehrfahrer_gtfs_work_read_json($path);
    if (!is_array($inventory)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
    $found = false;
    foreach ($inventory['entries'] as &$entry) {
        if (strval($entry['routeId'] ?? '') !== $routeId || strval($entry['variantId'] ?? '') !== $variantId) continue;
        $entry = $update($entry);
        $entry['updatedAt'] = date('c');
        $found = true;
        break;
    }
    unset($entry);
    if (!$found) throw new RuntimeException('GTFS-Arbeitsvariante fehlt.');
    $inventory['updatedAt'] = date('c');
    lehrfahrer_gtfs_work_write_json($path, $inventory);
    return $inventory;
}

function lehrfahrer_gtfs_work_set_status(string $companyId, string $routeId, string $variantId, string $status): array {
    if (!in_array($status, LEHRFAHRER_GTFS_WORK_STATUSES, true)) throw new InvalidArgumentException('Ungueltiger Freigabestatus.');
    $hasSavedRoute = !in_array($status, ['GEPRUEFT', 'FREIGEGEBEN'], true)
        || lehrfahrer_gtfs_work_has_saved_route($companyId, $routeId, $variantId);
    return lehrfahrer_gtfs_work_update_entry($companyId, $routeId, $variantId, static function (array $entry) use ($status, $hasSavedRoute): array {
        if (!$hasSavedRoute) {
            throw new RuntimeException('Vor Pruefung oder Freigabe muss eine Lehrfahrer-Route gespeichert sein.');
        }
        $entry['status'] = $status;
        $entry['reviewRequired'] = $status !== 'FREIGEGEBEN';
        return $entry;
    });
}

function lehrfahrer_gtfs_work_has_saved_route(string $companyId, string $routeId, string $variantId): bool {
    $root = lehrfahrer_tenant_area($companyId, 'lines');
    if (!is_dir($root) || is_link($root)) return false;
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink() || !$file->isFile() || strtolower($file->getExtension()) !== 'json') continue;
        $data = json_decode(strval(@file_get_contents($file->getPathname())), true);
        if (!is_array($data)) continue;
        $work = $data['meta']['gtfsWork'] ?? null;
        if (!is_array($work) || strval($work['routeId'] ?? '') !== $routeId || strval($work['variantId'] ?? '') !== $variantId) continue;
        $points = $data['routePoints'] ?? ($data['route']['original'] ?? []);
        if (is_array($points) && count($points) >= 2) return true;
    }
    return false;
}

function lehrfahrer_gtfs_work_mark_saved(string $companyId, array $data, string $routeReference): void {
    $work = $data['meta']['gtfsWork'] ?? null;
    if (!is_array($work)) return;
    $routeId = trim(strval($work['routeId'] ?? ''));
    $variantId = trim(strval($work['variantId'] ?? ''));
    if ($routeId === '' || $variantId === '') return;
    lehrfahrer_gtfs_work_update_entry($companyId, $routeId, $variantId, static function (array $entry) use ($routeReference): array {
        $entry['savedRoute'] = $routeReference;
        if (($entry['status'] ?? '') === 'UNGEPRUEFT') $entry['status'] = 'IN_BEARBEITUNG';
        $entry['reviewRequired'] = true;
        return $entry;
    });
}

function lehrfahrer_gtfs_work_route_is_released(string $companyId, array $data): bool {
    $inventory = lehrfahrer_gtfs_work_read_json(lehrfahrer_gtfs_work_inventory_path($companyId));
    if (!is_array($inventory)) return true;
    $work = $data['meta']['gtfsWork'] ?? null;
    if (!is_array($work)) return false;
    foreach ($inventory['entries'] as $entry) {
        if (strval($entry['routeId'] ?? '') === strval($work['routeId'] ?? '')
            && strval($entry['variantId'] ?? '') === strval($work['variantId'] ?? '')) {
            return ($entry['status'] ?? '') === 'FREIGEGEBEN' && ($entry['timetableStatus'] ?? '') !== 'ENTFALLEN';
        }
    }
    return false;
}
