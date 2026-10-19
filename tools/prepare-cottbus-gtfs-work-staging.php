<?php
declare(strict_types=1);

const COTTBUS_WORK_COMPANY_ID = 'cmp_2ff1b82166c99988ed6f7eb51cca7b56';
const COTTBUS_WORK_AGENCY_ID = '143';

function cottbus_work_fail(string $message): never {
    file_put_contents('php://stderr', $message . PHP_EOL);
    exit(1);
}

function cottbus_work_tree_hash(string $path): string {
    if (!is_dir($path) || is_link($path)) return hash('sha256', 'missing');
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink()) cottbus_work_fail('Symbolischer Link im geschuetzten Cottbus-Bestand.');
        if (!$file->isFile()) continue;
        $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($path) + 1));
        $files[$relative] = hash_file('sha256', $file->getPathname());
    }
    ksort($files, SORT_STRING);
    return hash('sha256', json_encode($files, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
}

if (strtolower(trim(strval(getenv('LEHRFAHRER_ENV')))) !== 'staging') {
    cottbus_work_fail('Arbeitsvorrat darf ausschliesslich in Staging vorbereitet werden.');
}
$appRoot = rtrim(str_replace('\\', '/', strval(getenv('LEHRFAHRER_APP_ROOT'))), '/');
if ($appRoot === '' || !is_file($appRoot . '/api/_gtfs_work_inventory.php')) cottbus_work_fail('Staging-App-Root ist ungueltig.');
require_once $appRoot . '/api/_tenant_route_storage.php';
require_once $appRoot . '/api/_gtfs_variant_index.php';
require_once $appRoot . '/api/_gtfs_timetable_change.php';
require_once $appRoot . '/api/_gtfs_work_inventory.php';

$companyRoot = lehrfahrer_tenant_root(COTTBUS_WORK_COMPANY_ID);
$protectedAreas = ['lines', 'cities', 'drivers', 'trainings', 'packages', 'documents', 'settings'];
$before = [];
foreach ($protectedAreas as $area) $before[$area] = cottbus_work_tree_hash($companyRoot . DIRECTORY_SEPARATOR . $area);

$indexPath = lehrfahrer_tenant_path(COTTBUS_WORK_COMPANY_ID, 'imports', 'gtfs/index/variants.sqlite');
$baselinePath = lehrfahrer_tenant_path(COTTBUS_WORK_COMPANY_ID, 'imports', 'gtfs/index/variants.sqlite.previous');
if (!is_file($baselinePath)) cottbus_work_fail('GTFS-Baseline fehlt.');
$validated = lehrfahrer_gtfs_validate_variant_index($indexPath, [COTTBUS_WORK_AGENCY_ID]);
if ((int)$validated['routes'] !== 75 || (int)$validated['variants'] !== 678) cottbus_work_fail('Aktueller Cottbus-GTFS-Stand ist nicht 75/678.');

$inventory = lehrfahrer_gtfs_work_reconcile(COTTBUS_WORK_COMPANY_ID, $indexPath, [COTTBUS_WORK_AGENCY_ID]);
$prepared = lehrfahrer_gtfs_work_prepare_all(COTTBUS_WORK_COMPANY_ID, $indexPath, $inventory);
$inventory = lehrfahrer_gtfs_work_reconcile(COTTBUS_WORK_COMPANY_ID, $indexPath, [COTTBUS_WORK_AGENCY_ID]);
$complete = $inventory['completeness'] ?? [];
if (($complete['complete'] ?? false) !== true
    || (int)($complete['capturedLineCount'] ?? 0) !== 75
    || (int)($complete['capturedVariantCount'] ?? 0) !== 678
    || $prepared !== 678) cottbus_work_fail('GTFS-Arbeitsvorrat ist unvollstaendig.');

$currentEntries = array_values(array_filter($inventory['entries'], static fn(array $entry): bool => ($entry['timetableStatus'] ?? '') !== 'ENTFALLEN'));
$missingDrafts = 0;
$released = 0;
foreach ($currentEntries as $entry) {
    if (($entry['status'] ?? '') === 'FREIGEGEBEN') $released++;
    $draft = lehrfahrer_gtfs_work_drafts_dir(COTTBUS_WORK_COMPANY_ID) . DIRECTORY_SEPARATOR . strval($entry['key']) . '.json';
    if (!is_file($draft)) $missingDrafts++;
}
if ($missingDrafts !== 0 || $released !== 0) cottbus_work_fail('Entwuerfe fehlen oder wurden unerwartet freigegeben.');

$after = [];
foreach ($protectedAreas as $area) $after[$area] = cottbus_work_tree_hash($companyRoot . DIRECTORY_SEPARATOR . $area);
if ($before !== $after) cottbus_work_fail('Geschuetzte Cottbus-Fachdaten wurden veraendert.');

echo json_encode([
    'ok' => true,
    'lines' => 75,
    'variants' => 678,
    'prepared' => $prepared,
    'released' => $released,
    'protected_data_unchanged' => true,
], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL;
