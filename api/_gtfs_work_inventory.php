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

function lehrfahrer_gtfs_work_with_inventory_lock(string $companyId, callable $operation) {
    $path = lehrfahrer_gtfs_work_inventory_path($companyId);
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht vorbereitet werden.');
    }
    $lockPath = $path . '.lock';
    if (is_link($lockPath)) throw new RuntimeException('GTFS-Arbeitsvorrats-Sperre ist ungueltig.');
    $lock = fopen($lockPath, 'c');
    if ($lock === false) throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht gesperrt werden.');
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('GTFS-Arbeitsvorrat kann nicht gesperrt werden.');
        return $operation();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
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
    return lehrfahrer_gtfs_work_with_inventory_lock($companyId, static fn(): array =>
        lehrfahrer_gtfs_work_reconcile_locked($companyId, $indexPath, $agencyIds));
}

function lehrfahrer_gtfs_work_reconcile_locked(string $companyId, string $indexPath, array $agencyIds): array {
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
            $identicalOld = $oldEntries[$key] ?? null;
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
                'archived' => is_array($identicalOld) && ($identicalOld['archived'] ?? false) === true,
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

function lehrfahrer_gtfs_work_reference_target(string $companyId, string $reference): array {
    $parts = explode('/', $reference);
    if (count($parts) !== 4 || !str_ends_with($parts[3], '.json')) {
        throw new RuntimeException('Gespeicherte Lehrfahrer-Route hat einen ungueltigen Pfad.');
    }
    try {
        [$city, $lineFolder, $categoryFolder, $file] = $parts;
        $fileBase = substr($file, 0, -5);
        if ($fileBase === '') throw new InvalidArgumentException('Leerer Routenname.');
        $path = lehrfahrer_route_file($companyId, $city, $fileBase, 'json', $lineFolder, $categoryFolder);
    } catch (InvalidArgumentException $error) {
        throw new RuntimeException('Gespeicherte Lehrfahrer-Route hat einen ungueltigen Pfad.', 0, $error);
    }
    return ['path' => $path, 'source' => [
        'city' => $city, 'lineFolder' => $lineFolder,
        'categoryFolder' => $categoryFolder, 'fileBase' => $fileBase,
    ]];
}

function lehrfahrer_gtfs_work_load_saved_route(string $companyId, string $reference, string $routeId, string $variantId): array {
    $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
    $path = $target['path'];
    if (!is_file($path)) throw new RuntimeException('Gespeicherte Lehrfahrer-Route wurde nicht gefunden.');
    $line = lehrfahrer_gtfs_work_read_json($path);
    $points = $line['routePoints'] ?? null;
    if ($line === null || !is_array($line['stops'] ?? null)
        || !is_array($points) || count(array_filter($points, static fn($point): bool =>
            is_array($point) && is_numeric($point['lat'] ?? ($point[0] ?? null))
                && is_numeric($point['lon'] ?? ($point[1] ?? null)))) < 2) {
        throw new RuntimeException('Gespeicherte Lehrfahrer-Route ist kein gueltiges Route-JSON.');
    }
    $work = $line['meta']['gtfsWork'] ?? null;
    if (!is_array($work) || strval($work['routeId'] ?? '') !== $routeId
        || strval($work['variantId'] ?? '') !== $variantId) {
        throw new RuntimeException('Gespeicherte Lehrfahrer-Route gehoert nicht zu dieser GTFS-Fuehrung.');
    }
    return ['line' => $line, 'source' => $target['source']];
}

// An older editor save can have lost gtfsWork while the inventory still points to
// exactly that file. Only an in-progress route may be opened for an explicit resave.
function lehrfahrer_gtfs_work_load_saved_route_for_repair(string $companyId, array $inventory,
    array $entry, string $routeId, string $variantId): array {
    if (strval($entry['routeId'] ?? '') !== $routeId || strval($entry['variantId'] ?? '') !== $variantId
        || lehrfahrer_gtfs_work_unique_entry($inventory, $routeId, $variantId) !== $entry) {
        throw new RuntimeException('GTFS-Fuehrung ist nicht eindeutig.');
    }
    if (($entry['status'] ?? '') !== 'IN_BEARBEITUNG') {
        throw new RuntimeException('Nur eine Route in Bearbeitung kann erneut verknuepft werden.');
    }
    $reference = $entry['savedRoute'] ?? null;
    $signature = $entry['signature'] ?? null;
    if (!is_string($reference) || $reference === '' || !is_string($signature) || $signature === '') {
        throw new RuntimeException('GTFS-Routenreferenz oder Signatur fehlt.');
    }
    $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
    $matches = 0;
    foreach ($inventory['entries'] ?? [] as $other) {
        if (!is_array($other)) throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
        $otherReference = $other['savedRoute'] ?? null;
        if ($otherReference === null || $otherReference === '') continue;
        if (!is_string($otherReference)) throw new RuntimeException('GTFS-Routenreferenz ist ungueltig.');
        $otherTarget = lehrfahrer_gtfs_work_reference_target($companyId, $otherReference);
        if (lehrfahrer_tenant_same_path($target['path'], $otherTarget['path'])) $matches++;
    }
    if ($matches !== 1 || is_link($target['path'])) throw new RuntimeException('GTFS-Routenreferenz ist nicht eindeutig.');
    $line = lehrfahrer_gtfs_work_read_json($target['path']);
    $points = is_array($line) ? ($line['routePoints'] ?? null) : null;
    if (!is_array($line) || !is_array($line['stops'] ?? null) || !is_array($points)
        || count(array_filter($points, static fn($point): bool =>
            is_array($point) && is_numeric($point['lat'] ?? ($point[0] ?? null))
                && is_numeric($point['lon'] ?? ($point[1] ?? null)))) < 2) {
        throw new RuntimeException('Gespeicherte Lehrfahrer-Route ist kein gueltiges Route-JSON.');
    }
    $meta = $line['meta'] ?? null;
    if (!is_array($meta) || array_key_exists('gtfsWork', $meta)
        || ($meta['source'] ?? null) !== 'Lehrfahrer Linien-Editor') {
        throw new RuntimeException('Gespeicherte GTFS-Identitaet ist nicht reparierbar.');
    }
    $line['meta']['gtfsWork'] = ['routeId' => $routeId, 'variantId' => $variantId, 'signature' => $signature];
    return ['line' => $line, 'source' => $target['source']];
}

function lehrfahrer_gtfs_work_save_manual_route(string $companyId, string $path, string $json): void {
    lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use ($companyId, $path, $json): void {
        $inventoryPath = lehrfahrer_gtfs_work_inventory_path($companyId);
        $inventory = lehrfahrer_gtfs_work_read_json($inventoryPath);
        if (is_file($inventoryPath) && (!is_array($inventory) || !is_array($inventory['entries'] ?? null))) {
            throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
        }
        foreach ($inventory['entries'] ?? [] as $entry) {
            if (!is_array($entry)) throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
            $reference = $entry['savedRoute'] ?? null;
            if ($reference === null || $reference === '') continue;
            if (!is_string($reference)) throw new RuntimeException('GTFS-Routenreferenz ist ungueltig.');
            $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
            if (lehrfahrer_tenant_same_path($path, $target['path'])) {
                throw new RuntimeException('Diese GTFS-Arbeitsroute muss mit ihrer GTFS-Identitaet gespeichert werden.');
            }
        }
        if (file_put_contents($path, $json) === false) {
            throw new RuntimeException('Datei konnte nicht gespeichert werden.');
        }
    });
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

function lehrfahrer_gtfs_work_unique_entry(array $inventory, string $routeId, string $variantId): array {
    $matches = array_values(array_filter($inventory['entries'] ?? [], static fn($entry): bool =>
        is_array($entry) && strval($entry['routeId'] ?? '') === $routeId
            && strval($entry['variantId'] ?? '') === $variantId));
    if (count($matches) !== 1) throw new RuntimeException('GTFS-Fuehrung ist nicht eindeutig im Arbeitsvorrat vorhanden.');
    return $matches[0];
}

function lehrfahrer_gtfs_work_update_entry(string $companyId, string $routeId, string $variantId, callable $update, bool $requireUnique = false, bool $touchEntry = true, bool $skipUnchanged = false): array {
    return lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use ($companyId, $routeId, $variantId, $update, $requireUnique, $touchEntry, $skipUnchanged): array {
        $path = lehrfahrer_gtfs_work_inventory_path($companyId);
        $inventory = lehrfahrer_gtfs_work_read_json($path);
        if (!is_array($inventory)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
        if ($requireUnique) lehrfahrer_gtfs_work_unique_entry($inventory, $routeId, $variantId);
        $found = false;
        foreach ($inventory['entries'] as &$entry) {
            if (strval($entry['routeId'] ?? '') !== $routeId || strval($entry['variantId'] ?? '') !== $variantId) continue;
            $updated = $update($entry, $inventory);
            if ($skipUnchanged && $updated === $entry) return $inventory;
            $entry = $updated;
            if ($touchEntry) $entry['updatedAt'] = date('c');
            $found = true;
            break;
        }
        unset($entry);
        if (!$found) throw new RuntimeException('GTFS-Arbeitsvariante fehlt.');
        $inventory['updatedAt'] = date('c');
        lehrfahrer_gtfs_work_write_json($path, $inventory);
        return $inventory;
    });
}

function lehrfahrer_gtfs_work_set_archived(string $companyId, string $indexPath, string $routeId, string $variantId, bool $archived, bool $confirmed = false): array {
    if ($routeId === '' || $variantId === '') throw new InvalidArgumentException('GTFS-Fuehrung fehlt.');
    return lehrfahrer_gtfs_work_update_entry($companyId, $routeId, $variantId,
        static function (array $entry, array $inventory) use ($indexPath, $routeId, $variantId, $archived, $confirmed): array {
            if (($entry['timetableStatus'] ?? '') === 'ENTFALLEN') throw new RuntimeException('GTFS-Fuehrung ist nicht mehr im CURRENT.');
            $index = lehrfahrer_gtfs_change_read_index($indexPath, [lehrfahrer_gtfs_operator_id_from_index($indexPath)]);
            if (!hash_equals(strval($inventory['sourceIndexSha256'] ?? ''), strval($index['sha256']))) {
                throw new RuntimeException('GTFS-Arbeitsvorrat gehoert nicht zum aktuellen Index.');
            }
            $matches = 0;
            foreach ($index['routes'] as $route) {
                if (strval($route['routeId']) !== $routeId) continue;
                foreach ($route['variants'] as $variant) {
                    if (strval($variant['variantId']) === $variantId) $matches++;
                }
            }
            if ($matches !== 1) throw new RuntimeException('GTFS-Fuehrung ist im CURRENT nicht eindeutig vorhanden.');
            if ($archived && !$confirmed && (($entry['status'] ?? '') !== 'UNGEPRUEFT'
                || ($entry['draftPrepared'] ?? false) === true || !empty($entry['savedRoute']))) {
                throw new RuntimeException('Bearbeitete GTFS-Fuehrung erfordert eine bestaetigte Archivierung.');
            }
            $entry['archived'] = $archived;
            return $entry;
        }, true, false);
}

function lehrfahrer_gtfs_work_set_status(string $companyId, string $routeId, string $variantId, string $status): array {
    if (!in_array($status, LEHRFAHRER_GTFS_WORK_STATUSES, true)) throw new InvalidArgumentException('Ungueltiger Freigabestatus.');
    return lehrfahrer_gtfs_work_update_entry($companyId, $routeId, $variantId, static function (array $entry) use ($companyId, $routeId, $variantId, $status): array {
        $current = strval($entry['status'] ?? '');
        if (!in_array($current, LEHRFAHRER_GTFS_WORK_STATUSES, true)) {
            throw new RuntimeException('Bisheriger GTFS-Arbeitsstatus ist ungueltig.');
        }
        if ($status === $current) return $entry;
        $next = [
            'UNGEPRUEFT' => 'IN_BEARBEITUNG',
            'IN_BEARBEITUNG' => 'GEPRUEFT',
            'GEPRUEFT' => 'FREIGEGEBEN',
        ];
        if (($next[$current] ?? null) !== $status) {
            throw new RuntimeException('Dieser GTFS-Arbeitsstatus kann nicht direkt gesetzt werden.');
        }
        if (in_array($status, ['GEPRUEFT', 'FREIGEGEBEN'], true)) {
            if (($entry['timetableStatus'] ?? '') === 'ENTFALLEN') {
                throw new RuntimeException('GTFS-Fuehrung ist nicht mehr im CURRENT.');
            }
            $reference = $entry['savedRoute'] ?? null;
            if (!is_string($reference) || $reference === '') {
                throw new RuntimeException('Vor Pruefung oder Freigabe muss eine gueltige Lehrfahrer-Route gespeichert sein.');
            }
            try {
                lehrfahrer_gtfs_work_load_saved_route($companyId, $reference, $routeId, $variantId);
            } catch (Throwable $error) {
                throw new RuntimeException('Vor Pruefung oder Freigabe muss eine gueltige Lehrfahrer-Route gespeichert sein.', 0, $error);
            }
        }
        $entry['status'] = $status;
        $entry['reviewRequired'] = $status !== 'FREIGEGEBEN';
        return $entry;
    }, true, true, true);
}

function lehrfahrer_gtfs_work_revoke_release(string $companyId, string $routeId, string $variantId): array {
    return lehrfahrer_gtfs_work_update_entry($companyId, $routeId, $variantId, static function (array $entry): array {
        if (($entry['status'] ?? '') !== 'FREIGEGEBEN') {
            throw new RuntimeException('Nur eine freigegebene GTFS-Fuehrung kann zurueckgenommen werden.');
        }
        $entry['status'] = 'IN_BEARBEITUNG';
        $entry['reviewRequired'] = true;
        return $entry;
    }, true);
}

function lehrfahrer_gtfs_work_prepare_route_file(string $path, string $json, string $routeId, string $variantId, ?callable $writer = null): string {
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(8));
    $handle = @fopen($temporary, 'x+b');
    if ($handle === false) throw new RuntimeException('Routendatei kann nicht vorbereitet werden.');
    $complete = false;
    try {
        $expected = strlen($json);
        $written = $writer === null ? @fwrite($handle, $json) : $writer($handle, $json);
        if ($written !== $expected || !@fflush($handle)) {
            throw new RuntimeException('Routendatei wurde nicht vollstaendig geschrieben.');
        }
        if (!@fclose($handle)) {
            $handle = null;
            throw new RuntimeException('Routendatei konnte nicht geschlossen werden.');
        }
        $handle = null;
        clearstatcache(true, $temporary);
        $actual = @file_get_contents($temporary);
        if ($actual === false || strlen($actual) !== $expected || !hash_equals($json, $actual)) {
            throw new RuntimeException('Vorbereitete Routendatei ist unvollstaendig.');
        }
        $decoded = json_decode($actual, true);
        $work = is_array($decoded) ? ($decoded['meta']['gtfsWork'] ?? null) : null;
        if (!is_array($decoded) || !is_array($decoded['stops'] ?? null)
            || !is_array($decoded['routePoints'] ?? null) || !is_array($work)
            || strval($work['routeId'] ?? '') !== $routeId
            || strval($work['variantId'] ?? '') !== $variantId) {
            throw new RuntimeException('Vorbereitete GTFS-Routendatei ist ungueltig.');
        }
        @chmod($temporary, 0600);
        $complete = true;
        return $temporary;
    } finally {
        if (is_resource($handle)) @fclose($handle);
        if (!$complete) @unlink($temporary);
    }
}

// The inventory lock is the transaction boundary for GTFS route saves and driver reads.
function lehrfahrer_gtfs_work_save_route(string $companyId, array $data, string $reference, string $path, string $json): string {
    $work = $data['meta']['gtfsWork'] ?? null;
    $routeId = trim(strval($work['routeId'] ?? ''));
    $variantId = trim(strval($work['variantId'] ?? ''));
    if ($routeId === '' || $variantId === '') throw new RuntimeException('GTFS-Routenkennung fehlt.');
    $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
    if (!lehrfahrer_tenant_same_path($target['path'], $path)) {
        throw new RuntimeException('GTFS-Speicherziel stimmt nicht mit der Routenreferenz ueberein.');
    }
    return lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use ($companyId, $data, $reference, $path, $json, $routeId, $variantId): string {
        $inventoryPath = lehrfahrer_gtfs_work_inventory_path($companyId);
        $inventory = lehrfahrer_gtfs_work_read_json($inventoryPath);
        if (!is_array($inventory)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
        lehrfahrer_gtfs_work_unique_entry($inventory, $routeId, $variantId);
        foreach ($inventory['entries'] as $index => $entry) {
            if (strval($entry['routeId'] ?? '') !== $routeId || strval($entry['variantId'] ?? '') !== $variantId) continue;
            if (($entry['timetableStatus'] ?? '') === 'ENTFALLEN') throw new RuntimeException('GTFS-Fuehrung ist nicht mehr im CURRENT.');
            $current = strval($entry['status'] ?? '');
            if (!in_array($current, LEHRFAHRER_GTFS_WORK_STATUSES, true)) throw new RuntimeException('GTFS-Arbeitsstatus ist ungueltig.');
            $oldReference = $entry['savedRoute'] ?? null;
            if ($oldReference !== null && $oldReference !== '') {
                if (!is_string($oldReference)) throw new RuntimeException('Gespeicherte GTFS-Routenreferenz ist ungueltig.');
                try {
                    lehrfahrer_gtfs_work_load_saved_route($companyId, $oldReference, $routeId, $variantId);
                } catch (Throwable $error) {
                    if ($current !== 'IN_BEARBEITUNG' || !hash_equals($oldReference, $reference)) throw $error;
                    lehrfahrer_gtfs_work_load_saved_route_for_repair($companyId, $inventory, $entry, $routeId, $variantId);
                }
            }
            if (in_array($current, ['GEPRUEFT', 'FREIGEGEBEN'], true)) {
                if (!is_string($oldReference) || !hash_equals($oldReference, $reference)) {
                    throw new RuntimeException('Freigegebene Route darf nicht unter anderem Ziel gespeichert werden.');
                }
            }
            if (is_link($path) || (file_exists($path) && !is_file($path))) {
                throw new RuntimeException('GTFS-Routenziel ist ungueltig.');
            }
            $oldRaw = is_file($path) ? @file_get_contents($path) : null;
            if ($oldRaw === false) throw new RuntimeException('Vorhandene Route kann nicht gelesen werden.');
            $oldRoute = $oldRaw === null ? null : json_decode($oldRaw, true);
            if ($oldRaw !== null && !is_array($oldRoute)) throw new RuntimeException('Vorhandene Route kann nicht verglichen werden.');
            if (is_array($oldRoute)) {
                $oldWork = $oldRoute['meta']['gtfsWork'] ?? null;
                $repairable = !is_array($oldWork) && $current === 'IN_BEARBEITUNG'
                    && is_string($oldReference) && hash_equals($oldReference, $reference)
                    && !array_key_exists('gtfsWork', is_array($oldRoute['meta'] ?? null) ? $oldRoute['meta'] : []);
                if ((!is_array($oldWork) && !$repairable)
                    || (is_array($oldWork) && (strval($oldWork['routeId'] ?? '') !== $routeId
                        || strval($oldWork['variantId'] ?? '') !== $variantId))) {
                    throw new RuntimeException('Zieldatei gehoert zu einer anderen GTFS-Fuehrung.');
                }
            }
            $changeType = $oldRoute === null ? 'NEW' : lehrfahrer_route_content_change($oldRoute, $data);
            $temporary = lehrfahrer_gtfs_work_prepare_route_file($path, $json, $routeId, $variantId);
            $demoted = $changeType === 'CHANGED' && in_array($current, ['GEPRUEFT', 'FREIGEGEBEN'], true);
            $beforeInventory = $inventory;
            try {
                if ($demoted) {
                    $inventory['entries'][$index]['status'] = 'IN_BEARBEITUNG';
                    $inventory['entries'][$index]['reviewRequired'] = true;
                    $inventory['entries'][$index]['updatedAt'] = date('c');
                    $inventory['updatedAt'] = date('c');
                    lehrfahrer_gtfs_work_write_json($inventoryPath, $inventory);
                }
                if (!@rename($temporary, $path)) {
                    throw new RuntimeException('Routendatei kann nicht atomar aktiviert werden.');
                }
            } catch (Throwable $error) {
                @unlink($temporary);
                if ($demoted && $oldRaw !== null && is_file($path)
                    && hash_equals(hash('sha256', $oldRaw), strval(@hash_file('sha256', $path)))) {
                    lehrfahrer_gtfs_work_write_json($inventoryPath, $beforeInventory);
                }
                throw $error;
            }
            $inventory['entries'][$index]['savedRoute'] = $reference;
            if ($current === 'UNGEPRUEFT') $inventory['entries'][$index]['status'] = 'IN_BEARBEITUNG';
            $inventory['entries'][$index]['reviewRequired'] = $inventory['entries'][$index]['status'] !== 'FREIGEGEBEN';
            $inventory['entries'][$index]['updatedAt'] = date('c');
            $inventory['updatedAt'] = date('c');
            lehrfahrer_gtfs_work_write_json($inventoryPath, $inventory);
            return $changeType;
        }
        throw new RuntimeException('GTFS-Arbeitsvariante fehlt.');
    });
}

function lehrfahrer_gtfs_work_has_legacy_gtfs_provenance(array $data): bool {
    $meta = $data['meta'] ?? null;
    if (!is_array($meta)) return false;
    $source = $meta['source'] ?? null;
    if (is_string($source) && stripos($source, 'GTFS') !== false) return true;
    // Older candidate routes predate gtfsWork but still carry their import provenance.
    foreach (['candidateSha256', 'reviewRequired'] as $key) {
        if (array_key_exists($key, $meta)) return true;
    }
    return false;
}

function lehrfahrer_gtfs_work_load_driver_route(string $companyId, string $filePath): ?array {
    return lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use ($companyId, $filePath): ?array {
        try {
            $checkedPath = lehrfahrer_route_checked_path($companyId, $filePath);
            if (is_link($checkedPath) || !is_file($checkedPath)) return null;
            $data = lehrfahrer_gtfs_work_read_json($checkedPath);
            if (!is_array($data)) return null;
            $inventory = lehrfahrer_gtfs_work_read_json(lehrfahrer_gtfs_work_inventory_path($companyId));
            if (!is_array($inventory) || !isset($inventory['entries']) || !is_array($inventory['entries'])
                || !array_is_list($inventory['entries'])) return null;
            $seen = [];
            $referenced = false;
            foreach ($inventory['entries'] as $entry) {
                if (!is_array($entry)) return null;
                $entryRouteId = trim(strval($entry['routeId'] ?? ''));
                $entryVariantId = trim(strval($entry['variantId'] ?? ''));
                if ($entryRouteId === '' || $entryVariantId === '') return null;
                $key = lehrfahrer_gtfs_work_key($entryRouteId, $entryVariantId);
                if (isset($seen[$key])) return null;
                $seen[$key] = true;
                $reference = $entry['savedRoute'] ?? null;
                if ($reference === null || $reference === '') continue;
                if (!is_string($reference)) return null;
                $target = lehrfahrer_gtfs_work_reference_target($companyId, $reference);
                if (lehrfahrer_tenant_same_path($checkedPath, $target['path'])) $referenced = true;
            }
            $meta = $data['meta'] ?? null;
            if (is_array($meta) && array_key_exists('gtfsWork', $meta) && !is_array($meta['gtfsWork'])) return null;
            $work = is_array($meta) ? ($meta['gtfsWork'] ?? null) : null;
            if (!is_array($work)) {
                return $referenced || lehrfahrer_gtfs_work_has_legacy_gtfs_provenance($data) ? null : $data;
            }
            $routeId = trim(strval($work['routeId'] ?? ''));
            $variantId = trim(strval($work['variantId'] ?? ''));
            if ($routeId === '' || $variantId === '') return null;
            $entry = lehrfahrer_gtfs_work_unique_entry($inventory, $routeId, $variantId);
            if (($entry['status'] ?? '') !== 'FREIGEGEBEN' || ($entry['timetableStatus'] ?? '') === 'ENTFALLEN') return null;
            $reference = $entry['savedRoute'] ?? null;
            if (!is_string($reference) || $reference === '') return null;
            $saved = lehrfahrer_gtfs_work_load_saved_route($companyId, $reference, $routeId, $variantId);
            $source = $saved['source'];
            $expected = lehrfahrer_route_file($companyId, $source['city'], $source['fileBase'], 'json',
                $source['lineFolder'], $source['categoryFolder']);
            if (!lehrfahrer_tenant_same_path($checkedPath, $expected)) return null;
            return $data;
        } catch (Throwable $error) {
            return null;
        }
    });
}
