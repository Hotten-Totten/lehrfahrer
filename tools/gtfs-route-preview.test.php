<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_route_preview.php';
require_once __DIR__ . '/../api/_gtfs_route_assignment.php';
require_once __DIR__ . '/../api/_route_categories.php';

function preview_check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
    echo "OK $label\n";
}

$keyA = str_repeat('a', 64);
$keyB = str_repeat('b', 64);
$analysis = ['lines' => [['line' => '16', 'status' => 'PRUEFEN', 'variants' => [
    ['selectionKey' => $keyA, 'status' => 'UNVERAENDERT', 'candidatePresent' => true,
        'stopNames' => ['Sandow', 'Mitte', 'Jessener Straße']],
    ['selectionKey' => $keyB, 'status' => 'PRUEFEN', 'candidatePresent' => true,
        'stopNames' => ['Jessener Straße', 'Mitte', 'Sandow']],
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
$oldOnlyAnalysis = $analysis;
$oldOnlyAnalysis['lines'][0]['variants'][1]['candidatePresent'] = false;
preview_check(lehrfahrer_gtfs_preview_line($oldOnlyAnalysis, $both, [$exact], '16')['selectedVariantCount'] === 1,
    'current-only legacy selection excluded from takeover preview');
$candidateSha = str_repeat('c', 64);
$oneProposal = lehrfahrer_gtfs_preview_creation_proposals(
    lehrfahrer_gtfs_preview_line($analysis, $selected, [], '16'), $candidateSha);
preview_check(count($oneProposal['variants']) === 1 && isset($oneProposal['variants'][0]['creationPreview']),
    'only marked variant receives creation preview');
$proposals = lehrfahrer_gtfs_preview_creation_proposals(
    lehrfahrer_gtfs_preview_line($analysis, $both, [], '16'), $candidateSha);
preview_check(count($proposals['variants']) === 2
    && count(array_filter($proposals['variants'], static fn(array $variant): bool => isset($variant['creationPreview']))) === 2,
    'two marked missing routes receive two creation proposals');
foreach ($proposals['variants'] as $variant) {
    $creation = $variant['creationPreview'];
    preview_check($creation['label'] === 'NEUE LEHRFAHRER-ROUTE'
        && $creation['line'] === '16' && $creation['routeNumber'] === 'noch festzulegen'
        && $creation['category'] === 'noch festzulegen'
        && $creation['startStop'] === $variant['startStop']
        && $creation['destination'] === $variant['destination']
        && $creation['stopCount'] === count($creation['stopNames'])
        && $creation['stopNames'] === $variant['stopNames']
        && $creation['candidateSha256'] === $candidateSha,
        'proposal carries complete stops, endpoints, category and candidate SHA');
}
$identical = lehrfahrer_gtfs_preview_creation_proposals(
    lehrfahrer_gtfs_preview_line($analysis, $selected, [$exact], '16'), $candidateSha);
preview_check(!isset($identical['variants'][0]['creationPreview']), 'no creation proposal for identical route');
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

$storage = sys_get_temp_dir() . '/gtfs-assignment-' . bin2hex(random_bytes(8));
mkdir($storage, 0700);
try {
    $sha = str_repeat('d', 64);
    $id = lehrfahrer_gtfs_route_selection_id('16', $keyA);
    $existing = [['id' => 'cottbus/16/Standard/Route_01', 'routeNumber' => '01']];
    $categories = lehrfahrer_route_category_defaults();
    $draft = lehrfahrer_gtfs_assignment_validate(['action' => 'new', 'routeNumber' => '', 'category' => 'Standard'], $existing, $categories);
    preview_check(!$draft['ready'] && $draft['missing'] === ['Routennummer fehlt'], 'new route requires manual number');
    $empty = lehrfahrer_gtfs_assignment_validate(['action' => 'new'], [], $categories);
    preview_check($empty['missing'] === ['Routennummer fehlt', 'Kategorie fehlt'], 'missing details are explicit');
    $noCategory = lehrfahrer_gtfs_assignment_validate(['action' => 'new', 'routeNumber' => '02'], [], $categories);
    preview_check($noCategory['missing'] === ['Kategorie fehlt'], 'missing category is explicit');
    $duplicate = lehrfahrer_gtfs_assignment_validate(['action' => 'new', 'routeNumber' => '01', 'category' => 'Standard'], $existing, $categories);
    preview_check($duplicate['duplicate'] && !$duplicate['ready'], 'duplicate number never implies overwrite');
    $new = lehrfahrer_gtfs_assignment_validate(['action' => 'new', 'routeNumber' => '01a', 'category' => 'Standard'], $existing, $categories);
    preview_check($new['ready'], 'unique manual route number is ready');
    $replace = lehrfahrer_gtfs_assignment_validate(['action' => 'replace', 'targetRoute' => $existing[0]['id'], 'category' => 'Standard'], $existing, $categories);
    preview_check($replace['ready'] && $replace['routeNumber'] === '01', 'replacement retains existing number without manual input');
    $replaceDraft = lehrfahrer_gtfs_assignment_validate(['action' => 'replace', 'category' => 'Standard'], $existing, $categories);
    preview_check($replaceDraft['missing'] === ['Bestehende Route auswählen'], 'replacement needs existing route');
    try {
        lehrfahrer_gtfs_assignment_validate(['action' => 'replace'], [], $categories);
        throw new RuntimeException('replacement without routes accepted');
    } catch (InvalidArgumentException $expected) { preview_check(true, 'replacement without same-line routes rejected'); }
    try {
        lehrfahrer_gtfs_assignment_validate(['action' => 'replace', 'targetRoute' => 'cottbus/17/Route_01', 'category' => 'Standard'], $existing, $categories);
        throw new RuntimeException('foreign target accepted');
    } catch (InvalidArgumentException $expected) { preview_check(true, 'foreign line target rejected'); }
    lehrfahrer_gtfs_assignment_set($storage, $sha, $id, $new);
    preview_check(lehrfahrer_gtfs_assignment_read($storage, $sha)[$id]['routeNumber'] === '01a', 'assignment survives reload');
    preview_check(lehrfahrer_gtfs_assignment_read($storage, str_repeat('e', 64)) === [], 'new candidate SHA has no assignments');
    $categoryFile = $storage . '/route_categories.json';
    $updated = lehrfahrer_route_categories_add($categoryFile, 'Pilotkategorie');
    preview_check(in_array('Pilotkategorie', $updated, true)
        && in_array('Pilotkategorie', lehrfahrer_route_categories_read($categoryFile), true), 'new category stored centrally');
    $withCategory = lehrfahrer_gtfs_assignment_validate(['action' => 'new', 'routeNumber' => '02',
        'category' => 'Pilotkategorie'], [], lehrfahrer_route_categories_read($categoryFile));
    lehrfahrer_gtfs_assignment_set($storage, $sha, $id, $withCategory);
    preview_check(lehrfahrer_gtfs_assignment_read($storage, $sha)[$id]['category'] === 'Pilotkategorie'
        && $withCategory['ready'], 'new category assignment survives reload and is ready');
} finally {
    foreach (glob($storage . '/*') ?: [] as $file) unlink($file);
    foreach (glob($storage . '/.*') ?: [] as $file) if (is_file($file)) unlink($file);
    rmdir($storage);
}
