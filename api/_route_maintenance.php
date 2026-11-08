<?php
declare(strict_types=1);

require_once __DIR__ . '/_route_save_bundle.php';
require_once __DIR__ . '/_route_content_comparison.php';
require_once __DIR__ . '/_route_maintenance_render.php';

/** The caller holds the tenant route lock while reading and preparing the route. */
function lehrfahrer_route_maintenance_artifacts(array $auth, string $path, string $pdf, ?string $gpx): void {
    $companyId = lehrfahrer_route_company_id($auth);
    $actor = lehrfahrer_route_audit_actor($auth, 'routes.maintain');
    $root = lehrfahrer_tenant_area($companyId, 'lines');
    $path = lehrfahrer_route_checked_path($companyId, $path);
    $reference = str_replace('\\', '/', substr($path, strlen($root) + 1));
    if (!str_starts_with($pdf, '%PDF-')) throw new RuntimeException('PDF konnte nicht vorbereitet werden.');
    $files = [];
    foreach (['pdf' => $pdf, 'gpx' => $gpx] as $extension => $bytes) {
        if ($bytes === null) continue;
        $relative = substr($reference, 0, -5) . '.' . $extension;
        $target = lehrfahrer_audit_file_target($companyId, $relative);
        $old = is_file($target) ? @file_get_contents($target) : null;
        if ($old === false) throw new RuntimeException('Begleitartefakt kann nicht gelesen werden.');
        if ($old === $bytes) continue;
        $files[] = ['relative' => $relative, 'kind' => $old === null ? 'CREATE' : 'UPDATE', 'content' => $bytes];
    }
    if ($files === []) return;
    $event = lehrfahrer_route_audit_event($companyId, $reference, 'ROUTE_ARTIFACT_REPAIR', 'routes.maintain');
    lehrfahrer_audit_file_mutate($auth['pdo'], $actor, $companyId, $reference, 'UPDATE', $files, $event);
}

function lehrfahrer_route_maintenance_change(array $auth, string $path, array $data): void {
    $companyId = lehrfahrer_route_company_id($auth);
    $pdo = $auth['pdo'];
    $actor = lehrfahrer_route_audit_actor($auth, 'routes.maintain');
    lehrfahrer_gtfs_work_with_inventory_lock($companyId, static function () use (
        $companyId, $pdo, $actor, $path, $data
    ): void {
        $path = lehrfahrer_route_checked_path($companyId, $path);
        $root = lehrfahrer_tenant_area($companyId, 'lines');
        $reference = str_replace('\\', '/', substr($path, strlen($root) + 1));
        $old = lehrfahrer_gtfs_work_read_json($path);
        if ($old === null) throw new RuntimeException('Route ist nicht lesbar.');
        if (lehrfahrer_route_content_change($old, $data) === 'UNCHANGED') return;
        $data['savedAt'] = date('c');
        $inventoryPath = lehrfahrer_gtfs_work_inventory_path($companyId);
        $inventory = lehrfahrer_gtfs_work_read_json($inventoryPath);
        if (is_file($inventoryPath) && (!is_array($inventory) || !is_array($inventory['entries'] ?? null))) {
            throw new RuntimeException('GTFS-Arbeitsvorrat ist ungueltig.');
        }
        $inventoryBytes = null;
        if (array_key_exists('gtfsWork', is_array($data['meta'] ?? null) ? $data['meta'] : [])) {
            if (!is_array($inventory)) throw new RuntimeException('GTFS-Arbeitsvorrat fehlt.');
            $inventoryBytes = lehrfahrer_route_bundle_gtfs_inventory(
                $companyId, $inventory, $data, $reference, $path, $old, 'CHANGED');
        } else {
            lehrfahrer_route_bundle_manual_target_allowed($companyId, $inventory ?? [], $path);
        }
        $parts = explode('/', $reference);
        $pdf = buildLineOverviewPdf($data, $parts[0], count($parts) > 2 ? $parts[1] : '-');
        if (!str_starts_with($pdf, '%PDF-')) throw new RuntimeException('PDF konnte nicht vorbereitet werden.');
        $gpx = lehrfahrer_route_gpx_from_data($data);
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
            | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $files = [['relative' => $reference, 'content' => $json]];
        foreach (['pdf' => $pdf, 'gpx' => $gpx] as $extension => $bytes) {
            $relative = substr($reference, 0, -5) . '.' . $extension;
            $target = lehrfahrer_audit_file_target($companyId, $relative);
            $oldBytes = is_file($target) ? @file_get_contents($target) : null;
            if ($oldBytes === false) throw new RuntimeException('Begleitartefakt kann nicht gelesen werden.');
            if ($oldBytes !== $bytes) $files[] = ['relative' => $relative,
                'kind' => $oldBytes === null ? 'CREATE' : 'UPDATE', 'content' => $bytes];
        }
        $additionalEvents = [];
        if ($inventoryBytes !== null) {
            $files[] = ['relative' => 'gtfs/index/work-inventory.json', 'area' => 'imports', 'content' => $inventoryBytes];
            $work = $data['meta']['gtfsWork'];
            $entry = lehrfahrer_gtfs_work_unique_entry($inventory, (string)$work['routeId'], (string)$work['variantId']);
            if (in_array($entry['status'], ['GEPRUEFT', 'FREIGEGEBEN'], true)) {
                $additionalEvents[] = lehrfahrer_route_audit_event(
                    $companyId, $reference, 'ROUTE_AUTO_DOWNGRADE', 'routes.maintain');
            }
        }
        $event = lehrfahrer_route_audit_event($companyId, $reference, 'ROUTE_CHANGE', 'routes.maintain');
        lehrfahrer_audit_file_mutate($pdo, $actor, $companyId, $reference, 'UPDATE',
            $files, $event, null, $additionalEvents);
    });
}
