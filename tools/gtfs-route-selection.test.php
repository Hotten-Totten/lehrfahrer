<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_route_selection.php';
require_once __DIR__ . '/../api/_gtfs_route_compare_v1.php';

function selection_check(bool $ok, string $label): void {
    if (!$ok) throw new RuntimeException($label);
    echo "OK $label\n";
}

$root = sys_get_temp_dir() . '/gtfs-route-selection-' . bin2hex(random_bytes(8));
$directory = $root . '/route-selections';
$candidateA = str_repeat('a', 64);
$candidateB = str_repeat('b', 64);
$first = str_repeat('1', 64);
$second = str_repeat('2', 64);
$analysis = ['lineCounts' => ['PRUEFEN' => 1, 'UNVERAENDERT' => 1], 'lines' => [
    ['line' => '16', 'status' => 'PRUEFEN', 'variants' => [
        ['selectionKey' => $first, 'status' => 'PRUEFEN'],
        ['selectionKey' => $second, 'status' => 'UNVERAENDERT']]],
    ['line' => '2', 'status' => 'UNVERAENDERT', 'variants' => [
        ['selectionKey' => $first, 'status' => 'UNVERAENDERT']]],
]];
mkdir($root, 0700);
$protected = $root . '/protected-route.json';
$current = $root . '/current.zip';
$candidate = $root . '/candidate.zip';
file_put_contents($protected, '{"routePoints":[[1,2]]}');
file_put_contents($current, 'current bytes');
file_put_contents($candidate, 'candidate bytes');
$hashes = array_map(static fn(string $file): string => hash_file('sha256', $file), [$protected, $current, $candidate]);
try {
    selection_check(lehrfahrer_gtfs_route_selection_read($directory, $candidateA) === [], 'no automatic selection');
    $choices = lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '16', $first, true);
    $view = lehrfahrer_gtfs_route_selection_apply($analysis, $choices);
    selection_check($view['lines'][0]['selectedVariantCount'] === 1
        && $view['lines'][0]['variants'][0]['currentRouteSelected']
        && !$view['lines'][0]['variants'][1]['currentRouteSelected'], 'mark variant and line progress');
    $choices = lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '16', $second, true);
    $choices = lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '2', $first, true);
    $reloaded = lehrfahrer_gtfs_route_selection_apply($analysis,
        lehrfahrer_gtfs_route_selection_read($directory, $candidateA));
    selection_check($reloaded['lines'][0]['selectedVariantCount'] === 2
        && $reloaded['lines'][1]['selectedVariantCount'] === 1, 'multiple variants and lines survive reload');
    selection_check($reloaded['lines'][0]['status'] === 'PRUEFEN'
        && $reloaded['lines'][0]['variants'][0]['status'] === 'PRUEFEN'
        && $reloaded['lineCounts'] === $analysis['lineCounts'], 'comparison status unaffected');
    selection_check(lehrfahrer_gtfs_route_selection_read($directory, $candidateB) === [], 'candidate SHA isolation');
    $choices = lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '16', $first, false);
    $view = lehrfahrer_gtfs_route_selection_apply($analysis, $choices);
    selection_check(!$view['lines'][0]['variants'][0]['currentRouteSelected']
        && $view['lines'][0]['selectedVariantCount'] === 1, 'deselect persists');
    $manifest = json_decode(file_get_contents(lehrfahrer_gtfs_route_selection_path($directory, $candidateA)), true);
    selection_check($manifest['candidate_sha256'] === $candidateA, 'selection file bound to candidate SHA');
    try {
        lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '3', $first, true);
        throw new RuntimeException('Foreign line accepted');
    } catch (InvalidArgumentException $expected) {}
    selection_check(true, 'foreign line blocked');
    try {
        lehrfahrer_gtfs_route_selection_set($directory, $candidateA, $analysis, '16', str_repeat('f', 64), true);
        throw new RuntimeException('Foreign variant accepted');
    } catch (InvalidArgumentException $expected) {}
    selection_check(true, 'foreign variant blocked');
    selection_check(array_map(static fn(string $file): string => hash_file('sha256', $file),
        [$protected, $current, $candidate]) === $hashes,
        'routes and GTFS bytes unchanged');
    $old = [['name' => 'Sandow', 'lat' => 51.76, 'lon' => 14.34],
        ['name' => 'Jessener Straße', 'lat' => 51.77, 'lon' => 14.35]];
    $public = lehrfahrer_gtfs_v1_public(['stops' => $old], 'UNVERAENDERT');
    selection_check($public['selectionKey'] === lehrfahrer_gtfs_v1_public(['stops' => $old], 'PRUEFEN')['selectionKey'],
        'stable stop-sequence identity independent of status');
} finally {
    foreach (glob($directory . '/*') ?: [] as $file) unlink($file);
    if (is_file($directory . '/.lock')) unlink($directory . '/.lock');
    if (is_dir($directory)) rmdir($directory);
    foreach ([$protected, $current, $candidate] as $file) if (is_file($file)) unlink($file);
    rmdir($root);
}
