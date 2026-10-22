<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_variant_index.php';
require_once __DIR__ . '/../api/_gtfs_timetable_change.php';

if (PHP_SAPI !== 'cli' || count($argv) !== 4) {
    fwrite(STDERR, "usage: php gtfs-build-candidate-index.php FILTERED_DIR ORIGINAL_ZIP OUTPUT_INDEX\n");
    exit(2);
}
[$script, $dir, $zipPath, $indexPath] = $argv;
$files = [];
foreach (['agency.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'] as $name) {
    $path = $dir . DIRECTORY_SEPARATOR . $name;
    if (!is_file($path) || is_link($path)) throw new RuntimeException('Gefilterte GTFS-Tabelle fehlt.');
    $files[$name] = file_get_contents($path);
    if (!is_string($files[$name])) throw new RuntimeException('Gefilterte GTFS-Tabelle ist nicht lesbar.');
}
$sha = hash_file('sha256', $zipPath);
if (!is_string($sha)) throw new RuntimeException('Offizielles GTFS-ZIP ist nicht lesbar.');
$rows = [];
lehrfahrer_gtfs_index_csv_rows($files['agency.txt'], ['agency_id', 'agency_name'], static function (array $row) use (&$rows): void { $rows[] = $row; });
$agencyId = lehrfahrer_gtfs_operator_id_from_rows($rows);
$result = lehrfahrer_gtfs_build_variant_index($files, $indexPath, [$agencyId],
    ['source_sha256' => $sha, 'created_at' => gmdate('c')]);
echo json_encode(['agencyId' => $agencyId, 'routes' => $result['routes'], 'variants' => $result['variants']], JSON_THROW_ON_ERROR), "\n";
