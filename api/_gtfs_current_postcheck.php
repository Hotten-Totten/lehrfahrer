<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_variant_index.php';
require_once __DIR__ . '/_gtfs_timetable_change.php';
require_once __DIR__ . '/_gtfs_version.php';

function lehrfahrer_gtfs_current_postcheck(string $zipPath, string $indexPath, string $inventoryPath,
    string $workingSetPath): array {
    if (!is_file($zipPath) || is_link($zipPath) || !is_readable($zipPath)) {
        throw new RuntimeException('CURRENT-GTFS-ZIP fehlt oder ist nicht lesbar.');
    }
    if (!is_file($indexPath) || is_link($indexPath) || !is_readable($indexPath)) {
        throw new RuntimeException('CURRENT-Variantenindex fehlt oder ist nicht lesbar.');
    }
    $agencyId = lehrfahrer_gtfs_operator_id_from_index($indexPath);
    $validated = lehrfahrer_gtfs_validate_variant_index($indexPath, [$agencyId]);
    $version = lehrfahrer_gtfs_version_info($zipPath, $indexPath, LEHRFAHRER_GTFS_COTTBUS_NAME);
    if (preg_match('/^[a-f0-9]{64}$/D', strval($version['sha256'] ?? '')) !== 1
        || preg_match('/^[a-f0-9]{64}$/D', strval($version['indexSourceSha256'] ?? '')) !== 1
        || $version['indexMatchesZip'] !== true
        || ($version['agencyId'] ?? null) !== $agencyId
        || ($version['lineCount'] ?? null) !== $validated['routes']
        || ($version['variantCount'] ?? null) !== $validated['variants']) {
        throw new RuntimeException('CURRENT-GTFS-ZIP und Variantenindex sind inkonsistent.');
    }

    if (!is_file($inventoryPath) || is_link($inventoryPath) || !is_readable($inventoryPath)) {
        throw new RuntimeException('GTFS-Arbeitsvorrat fehlt oder ist nicht lesbar.');
    }
    $inventory = json_decode((string)file_get_contents($inventoryPath), true, 512, JSON_THROW_ON_ERROR);
    $complete = $inventory['completeness'] ?? [];
    if (!is_array($inventory) || !is_array($complete)
        || ($inventory['sourceIndexSha256'] ?? null) !== $validated['sha256']
        || ($inventory['agencyIds'] ?? null) !== [$agencyId]
        || ($complete['complete'] ?? null) !== true
        || ($complete['expectedLineCount'] ?? null) !== $validated['routes']
        || ($complete['capturedLineCount'] ?? null) !== $validated['routes']
        || ($complete['expectedVariantCount'] ?? null) !== $validated['variants']
        || ($complete['capturedVariantCount'] ?? null) !== $validated['variants']) {
        throw new RuntimeException('GTFS-Arbeitsvorrat passt nicht zum CURRENT-Index.');
    }
    $entries = $inventory['entries'] ?? null;
    if (!is_array($entries)) throw new RuntimeException('GTFS-Variantenbestand fehlt.');
    $indexed = lehrfahrer_gtfs_change_read_index($indexPath, [$agencyId]);
    if ($indexed['sha256'] !== $validated['sha256']) {
        throw new RuntimeException('CURRENT-Index hat sich waehrend des Postchecks geaendert.');
    }
    $expected = [];
    foreach ($indexed['routes'] as $route) {
        foreach ($route['variants'] as $variant) {
            $expected[strval($route['routeId']) . "\0" . strval($variant['variantId'])] = true;
        }
    }
    $captured = [];
    foreach ($entries as $entry) {
        if (!is_array($entry) || !in_array($entry['status'] ?? null,
            ['UNGEPRUEFT', 'IN_BEARBEITUNG', 'GEPRUEFT', 'FREIGEGEBEN'], true)) {
            throw new RuntimeException('GTFS-Freigabestatus ist ungueltig.');
        }
        if (($entry['timetableStatus'] ?? null) === 'ENTFALLEN') continue;
        $key = strval($entry['routeId'] ?? '') . "\0" . strval($entry['variantId'] ?? '');
        if (!isset($expected[$key]) || isset($captured[$key])) {
            throw new RuntimeException('GTFS-Arbeitsvorrat enthaelt fremde oder doppelte CURRENT-Varianten.');
        }
        if (($entry['key'] ?? null) !== hash('sha256', $key)) {
            throw new RuntimeException('GTFS-Arbeitsvorrat enthaelt eine ungueltige Variantenkennung.');
        }
        $captured[$key] = true;
    }
    if (count($captured) !== $validated['variants']) {
        throw new RuntimeException('GTFS-Arbeitsvorrat enthaelt nicht alle CURRENT-Varianten.');
    }

    // A working set is optional for a current feed, but if one exists its
    // source binding must not silently refer to an earlier index.
    if (file_exists($workingSetPath) || is_link($workingSetPath)) {
        if (!is_file($workingSetPath) || is_link($workingSetPath) || !is_readable($workingSetPath)) {
            throw new RuntimeException('GTFS-Working-Set ist nicht lesbar.');
        }
        $working = json_decode((string)file_get_contents($workingSetPath), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($working) || ($working['sourceIndexSha256'] ?? null) !== $validated['sha256']
            || ($working['agencyIds'] ?? null) !== [$agencyId]) {
            throw new RuntimeException('GTFS-Working-Set passt nicht zum CURRENT-Index.');
        }
    }
    if (hash_file('sha256', $zipPath) !== $version['sha256']
        || hash_file('sha256', $indexPath) !== $validated['sha256']) {
        throw new RuntimeException('CURRENT-GTFS hat sich waehrend des Postchecks geaendert.');
    }
    return ['agencyId' => $agencyId, 'lines' => $validated['routes'], 'variants' => $validated['variants']];
}
