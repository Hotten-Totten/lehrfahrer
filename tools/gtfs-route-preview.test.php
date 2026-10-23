<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_route_preview.php';

function preview_check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
    echo "OK $label\n";
}

$keyA = str_repeat('a', 64);
$keyB = str_repeat('b', 64);
$analysis = ['lines' => [['line' => '16', 'status' => 'PRUEFEN', 'variants' => [
    ['selectionKey' => $keyA, 'status' => 'UNVERAENDERT', 'stopNames' => ['Sandow', 'Mitte', 'Jessener Straße']],
    ['selectionKey' => $keyB, 'status' => 'PRUEFEN', 'stopNames' => ['Jessener Straße', 'Mitte', 'Sandow']],
]]]];
$selected = [lehrfahrer_gtfs_route_selection_id('16', $keyA) => true];
$route = static fn(string $id, array $stops): array => ['id' => $id, 'variantName' => 'Route 1',
    'category' => 'Standard', 'stopNames' => $stops, 'stopCount' => count($stops)];
$exact = $route('cottbus/16/route1', ['Cottbus, Sandow', 'Mitte', 'Jessener Straße']);
$preview = lehrfahrer_gtfs_preview_line($analysis, $selected, [$exact], '16');
preview_check($preview['selectedVariantCount'] === 1 && $preview['variants'][0]['result'] === 'IDENTISCH',
    'identical route and only selected variant');
preview_check($analysis['lines'][0]['variants'][1]['status'] === 'PRUEFEN', 'comparison status unchanged');
preview_check(lehrfahrer_gtfs_preview_line($analysis, $selected,
    [$route('cottbus/16/different-coordinates', $exact['stopNames'])], '16')['variants'][0]['result'] === 'IDENTISCH',
    'feed IDs and small coordinate differences do not affect identical stop names');
$changed = $route('cottbus/16/old', ['Sandow', 'Altmarkt', 'Jessener Straße']);
$preview = lehrfahrer_gtfs_preview_line($analysis, $selected, [$changed], '16');
preview_check($preview['variants'][0]['result'] === 'ANPASSUNG_NOETIG'
    && $preview['variants'][0]['matches'][0]['difference']['addedStops'] === ['Mitte']
    && $preview['variants'][0]['matches'][0]['difference']['removedStops'] === ['Altmarkt'],
    'changed sequence and stop differences');
preview_check(lehrfahrer_gtfs_preview_line($analysis, $selected, [], '16')['variants'][0]['result']
    === 'NEUE_ROUTE_ERFORDERLICH', 'missing route');
preview_check(lehrfahrer_gtfs_preview_line($analysis, $selected, [$changed, $route('cottbus/16/other',
    ['Sandow', 'Bahnhof', 'Jessener Straße'])], '16')['variants'][0]['result'] === 'KONFLIKT',
    'ambiguous assignment');
$both = $selected + [lehrfahrer_gtfs_route_selection_id('16', $keyB) => true];
preview_check(lehrfahrer_gtfs_preview_line($analysis, $both, [$exact], '16')['selectedVariantCount'] === 2,
    'all selected variants included');
preview_check(lehrfahrer_gtfs_preview_difference(['A', 'B', 'C'], ['A', 'C', 'B'])['orderChanged'],
    'changed order visible');

$root = sys_get_temp_dir() . '/gtfs-preview-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
mkdir($root . '/16', 0700);
$line16 = $root . '/16/route.json';
$line17 = $root . '/other.json';
file_put_contents($line16, json_encode(['lineName' => 'Linie 16', 'variantName' => 'Route 1',
    'stops' => [['name' => 'Sandow', 'lat' => 51.7001], ['name' => 'Mitte'], ['name' => 'Jessener Straße']]], JSON_THROW_ON_ERROR));
file_put_contents($line17, json_encode(['lineName' => 'Linie 17', 'stops' => [['name' => 'Fremd']]], JSON_THROW_ON_ERROR));
$before = [hash_file('sha256', $line16), hash_file('sha256', $line17)];
try {
    $routes = lehrfahrer_gtfs_preview_route_files($root, '16');
    preview_check(count($routes) === 1 && $routes[0]['stopCount'] === 3, 'read only line 16 route files');
    preview_check(lehrfahrer_gtfs_preview_line($analysis, $selected, $routes, '16')['variants'][0]['result']
        === 'IDENTISCH', 'pilot preview reads existing route');
    preview_check([hash_file('sha256', $line16), hash_file('sha256', $line17)] === $before,
        'existing route files unchanged');
} finally {
    unlink($line16); unlink($line17); rmdir($root . '/16'); rmdir($root);
}
