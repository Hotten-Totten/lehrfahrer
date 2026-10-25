<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_tenant_route_storage.php';
require_once __DIR__ . '/../api/_gtfs_route_creation.php';

function creation_check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
    echo "OK $label\n";
}

$private = sys_get_temp_dir() . '/lf-gtfs-create-' . bin2hex(random_bytes(8));
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . $private);
$company = 'cmp_' . str_repeat('f', 32);
$sha = str_repeat('c', 64);
$key1 = str_repeat('a', 64);
$key2 = str_repeat('b', 64);
$variant = static fn(string $key, array $names): array => [
    'line' => '16', 'selectionKey' => $key, 'startStop' => $names[0],
    'destination' => $names[count($names) - 1], 'stopCount' => count($names), 'stopNames' => $names
];
$preview = ['line' => '16', 'variants' => [
    $variant($key1, ['Uhlandstraße', 'Stadthalle Puschkinpromenade']),
    $variant($key2, ['Stadthalle Puschkinpromenade', 'Uhlandstraße'])
]];
$assignment = static fn(string $number): array => ['action' => 'new', 'routeNumber' => $number,
    'targetRoute' => '', 'category' => 'Standard'];
$assignments = [lehrfahrer_gtfs_route_selection_id('16', $key1) => $assignment('01'),
    lehrfahrer_gtfs_route_selection_id('16', $key2) => $assignment('02')];
$row = static fn(array $names, string $id): array => ['short_name' => '16', 'trip_headsign' => $names[1],
    'route_id' => 'r16', 'variant_id' => $id, 'signature' => 'sig-' . $id,
    'items' => array_map(static fn(int $i, string $name): array => ['stopId' => 'gtfs-' . $i,
        'sequence' => $i + 1, 'name' => $name, 'lat' => 51.75 + $i * 0.001,
        'lon' => 14.32 + $i * 0.001], array_keys($names), $names)];
$rows = [$key1 => $row($preview['variants'][0]['stopNames'], 'v1'),
    $key2 => $row($preview['variants'][1]['stopNames'], 'v2')];

mkdir($private, 0700);
$zipPath = $private . '/candidate-fixture.zip';
$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE) !== true) throw new RuntimeException('Fixture-ZIP nicht anlegbar.');
$zip->addFromString('agency.txt', "agency_id,agency_name\n287,Cottbusverkehr\n");
$zip->addFromString('routes.txt', "route_id,agency_id,route_short_name,route_type\nr16,287,16,3\n");
$zip->addFromString('trips.txt', "trip_id,route_id,service_id,trip_headsign\nt1,r16,s1,Stadthalle Puschkinpromenade\nt2,r16,s1,Uhlandstraße\n");
$zip->addFromString('calendar.txt', "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns1,1,1,1,1,1,1,1,20261020,20261118\n");
$zip->addFromString('calendar_dates.txt', "service_id,date,exception_type\n");
$zip->addFromString('stop_times.txt', "trip_id,stop_id,stop_sequence\nt1,u,1\nt1,p,2\nt2,p,1\nt2,u,2\n");
$zip->addFromString('stops.txt', "stop_id,stop_name,stop_lat,stop_lon\nu,Uhlandstraße,51.75,14.32\np,Stadthalle Puschkinpromenade,51.751,14.321\n");
$zip->close();
$u = lehrfahrer_gtfs_service_stop_key(['stop_name' => 'Uhlandstraße', 'stop_lat' => 51.75, 'stop_lon' => 14.32]);
$p = lehrfahrer_gtfs_service_stop_key(['stop_name' => 'Stadthalle Puschkinpromenade', 'stop_lat' => 51.751, 'stop_lon' => 14.321]);
$zipKeys = [hash('sha256', json_encode([$u, $p], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)) => true,
    hash('sha256', json_encode([$p, $u], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)) => true];
$zipRows = lehrfahrer_gtfs_creation_zip_rows($zipPath, '16', $zipKeys);
creation_check(count($zipRows) === 2 && array_column(array_values($zipRows)[0]['items'], 'stopId') === ['u', 'p'],
    'checked ZIP supplies exact marked stop IDs and order');

creation_check(lehrfahrer_gtfs_creation_fingerprint($sha, $preview, $assignments)
    !== lehrfahrer_gtfs_creation_fingerprint(str_repeat('d', 64), $preview, $assignments), 'candidate SHA binds plan');
creation_check(lehrfahrer_gtfs_creation_fingerprint($sha, $preview, $assignments)
    !== lehrfahrer_gtfs_creation_fingerprint($sha, $preview, array_replace($assignments,
        [lehrfahrer_gtfs_route_selection_id('16', $key1) => $assignment('03')])), 'assignment change invalidates confirmation');
creation_check(lehrfahrer_gtfs_creation_fingerprint($sha, $preview, $assignments)
    !== lehrfahrer_gtfs_creation_fingerprint($sha, ['variants' => [$preview['variants'][0]]], $assignments),
    'unmarked variant changes confirmation');

$plans = lehrfahrer_gtfs_creation_plans($preview, $assignments, [], ['Standard'], $sha, $rows);
creation_check(count($plans) === 2 && array_column($plans, 'routeNumber') === ['01', '02'], 'two marked routes planned');
creation_check($plans[0]['data']['routePoints'] === [] && $plans[1]['data']['route']['original'] === [],
    'no fabricated road geometry');
creation_check($plans[0]['data']['meta']['candidateSha256'] === $sha
    && $plans[0]['data']['meta']['source'] === 'GTFS-Fahrplanwechsel', 'candidate origin recorded');
creation_check($plans[0]['data']['stops'][0]['stopId'] === 'gtfs-0'
    && $plans[0]['data']['stops'][0]['lat'] === 51.75, 'GTFS stop identity and coordinates retained');
foreach ([
    [$preview, array_replace($assignments, [lehrfahrer_gtfs_route_selection_id('16', $key2) =>
        ['action' => 'new', 'routeNumber' => '', 'category' => 'Standard']]), [], 'incomplete'],
    [$preview, array_replace($assignments, [lehrfahrer_gtfs_route_selection_id('16', $key2) =>
        ['action' => 'replace', 'targetRoute' => 'cottbus/16/Route_02', 'category' => 'Standard']]),
        [['id' => 'cottbus/16/Route_02', 'routeNumber' => '02']], 'replacement'],
    [$preview, $assignments, [['id' => 'cottbus/16/Route_01', 'routeNumber' => '01']], 'duplicate']
] as [$testPreview, $testAssignments, $existing, $label]) {
    try {
        lehrfahrer_gtfs_creation_plans($testPreview, $testAssignments, $existing, ['Standard'], $sha, $rows);
        throw new RuntimeException($label . ' accepted');
    } catch (InvalidArgumentException | RuntimeException $expected) {
        if ($expected->getMessage() === $label . ' accepted') throw $expected;
        creation_check(true, $label . ' rejected');
    }
}

$cityRoot = lehrfahrer_tenant_ensure_directory($company, 'lines', 'cottbus');
creation_check(!lehrfahrer_route_city_exists($company, 'cottbus'), 'preview and plans never register a city');
$writes = array_map(static fn(array $plan): array => ['path' => lehrfahrer_route_file($company, 'cottbus',
    $plan['data']['fileBase'], 'json', $plan['data']['lineFolder'], $plan['data']['categoryFolder'], true),
    'data' => $plan['data']], $plans);
$check = static function () use ($cityRoot): void {
    if (lehrfahrer_gtfs_preview_route_files($cityRoot, '16') !== []) throw new RuntimeException('Route already exists.');
};
$registrationCount = 0;
$registerCity = static function () use ($company, &$registrationCount): void {
    if (lehrfahrer_route_city_exists($company, 'cottbus')) return;
    lehrfahrer_route_register_city($company, 'Cottbus');
    $registrationCount++;
};
try {
    lehrfahrer_gtfs_creation_install($cityRoot, $writes, $check, null, $registerCity);
    creation_check(lehrfahrer_route_city_exists($company, 'cottbus') && $registrationCount === 1,
        'confirmed creation registers missing city through normal city storage');
    creation_check(lehrfahrer_route_city_exists($company, 'cottbus')
        && !lehrfahrer_route_city_exists('cmp_' . str_repeat('e', 32), 'cottbus'),
        'city registration remains tenant-scoped');
    $found = [];
    foreach ($plans as $plan) {
        $data = $plan['data'];
        $path = lehrfahrer_route_find_file($company, 'cottbus', $data['fileBase'], 'json',
            $data['lineFolder'], $data['categoryFolder']);
        creation_check($path === $writes[count($found)]['path'], 'normal editor route lookup finds created route');
        $loaded = json_decode(strval(file_get_contents($path)), true, 512, JSON_THROW_ON_ERROR);
        creation_check($loaded['routeName'] === $data['routeName']
            && array_column($loaded['stops'], 'name') === array_column($data['stops'], 'name')
            && $loaded['routePoints'] === [], 'normal editor compatible JSON is loadable');
        $found[] = $path;
    }
    $before = array_map('hash_file', array_fill(0, count($found), 'sha256'), $found);
    try {
        lehrfahrer_gtfs_creation_install($cityRoot, $writes, $check, null, $registerCity);
        throw new RuntimeException('overwrite accepted');
    } catch (RuntimeException $expected) {
        if ($expected->getMessage() === 'overwrite accepted') throw $expected;
        creation_check(true, 'repeat cannot overwrite existing route');
    }
    creation_check(array_map('hash_file', array_fill(0, count($found), 'sha256'), $found) === $before,
        'existing routes unchanged after repeat');
    creation_check($registrationCount === 1, 'existing city is not registered twice');
    $rollbackWrites = [
        ['path' => lehrfahrer_route_file($company, 'cottbus', 'Route_03', 'json', 'Linie_16', 'Standard', true), 'data' => $plans[0]['data']],
        ['path' => lehrfahrer_route_file($company, 'cottbus', 'Route_04', 'json', 'Linie_16', 'Standard', true), 'data' => $plans[1]['data']]
    ];
    try {
        lehrfahrer_gtfs_creation_install($cityRoot, $rollbackWrites, static function (): void {},
            static function (int $i): void { if ($i === 0) throw new RuntimeException('simulated second-route failure'); });
        throw new RuntimeException('rollback not triggered');
    } catch (RuntimeException $expected) {
        if ($expected->getMessage() === 'rollback not triggered') throw $expected;
        creation_check(!is_file($rollbackWrites[0]['path']) && !is_file($rollbackWrites[1]['path']),
            'failure leaves no partial routes');
    }
    creation_check(array_map('hash_file', array_fill(0, count($found), 'sha256'), $found) === $before,
        'previous routes survive rollback byte-identically');
} finally {
    foreach (glob($cityRoot . '/Linie_16/Standard/*') ?: [] as $file) if (is_file($file)) unlink($file);
    foreach (glob($cityRoot . '/.*') ?: [] as $file) if (is_file($file)) unlink($file);
    rmdir($cityRoot . '/Linie_16/Standard');
    rmdir($cityRoot . '/Linie_16');
    rmdir($cityRoot);
    rmdir(lehrfahrer_tenant_area($company, 'lines'));
    rmdir(lehrfahrer_tenant_area($company, 'cities') . '/cottbus');
    rmdir(lehrfahrer_tenant_area($company, 'cities'));
    rmdir(lehrfahrer_tenant_root($company));
    rmdir($private . '/companies');
    unlink($zipPath);
    rmdir($private);
}
