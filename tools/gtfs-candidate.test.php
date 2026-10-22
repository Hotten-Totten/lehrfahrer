<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_tenant_storage.php';
require_once __DIR__ . '/../api/_gtfs_candidate.php';

if (!class_exists('ZipArchive')) {
    fwrite(STDERR, "ZipArchive fehlt.\n");
    exit(1);
}
$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'lehrfahrer-candidate-fixture-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
putenv('LEHRFAHRER_PRIVATE_DATA_DIR=' . $root);
$company = 'cmp_' . bin2hex(random_bytes(16));
$imports = lehrfahrer_tenant_ensure_directory($company, 'imports', 'gtfs');
$indexDir = lehrfahrer_tenant_ensure_directory($company, 'imports', 'gtfs/index');
$candidate = lehrfahrer_tenant_ensure_directory($company, 'imports', 'gtfs/candidate');
$currentZip = $imports . DIRECTORY_SEPARATOR . 'latest.zip';
$currentIndex = $indexDir . DIRECTORY_SEPARATOR . 'variants.sqlite';
$candidateZip = $candidate . DIRECTORY_SEPARATOR . 'candidate.zip';
$candidateIndex = $candidate . DIRECTORY_SEPARATOR . 'variants.sqlite';
$manifestPath = $candidate . DIRECTORY_SEPARATOR . 'checked.json';
$routeFile = lehrfahrer_tenant_ensure_directory($company, 'lines', 'Cottbus') . DIRECTORY_SEPARATOR . 'manual.json';
file_put_contents($routeFile, '{"routePoints":[1,2,3],"note":"manual"}');
$routeSha = hash_file('sha256', $routeFile);

function fixture_files(string $agency, bool $changed): array {
    $last = $changed ? 'Uhlandstrasse' : 'Altstadt';
    $lastId = $changed ? 'u' : 'a';
    return [
        'agency.txt' => "agency_id,agency_name\n$agency,Cottbusverkehr\n",
        'routes.txt' => "route_id,agency_id,route_short_name,route_long_name,route_type\nr16,$agency,16,Linie 16,3\n",
        'stops.txt' => "stop_id,stop_name,stop_lat,stop_lon,parent_station\nx,Start,51.7,14.3,\ny,Mitte,51.8,14.4,\n$lastId,$last,51.9,14.5,\n",
        'trips.txt' => "route_id,service_id,trip_id,trip_headsign,direction_id\nr16,s,t16,$last,0\n",
        'stop_times.txt' => "trip_id,stop_id,stop_sequence\nt16,x,1\nt16,y,2\nt16,$lastId,3\n",
    ];
}

function fixture_zip(string $path, array $files): void {
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Fixture ZIP fehlgeschlagen.');
    foreach ($files as $name => $body) $zip->addFromString($name, $body);
    $zip->close();
}

function fixture_index(string $path, array $files, string $agency, string $zip): void {
    if (is_file($path)) unlink($path);
    lehrfahrer_gtfs_build_variant_index($files, $path, [$agency],
        ['source_sha256' => hash_file('sha256', $zip), 'created_at' => '2026-10-17T00:00:00Z']);
}

function fixture_manifest(string $path, string $candidateZip, string $candidateIndex, string $currentZip,
    string $agency = '287'): void {
    file_put_contents($path, json_encode([
        'sourceUrl' => LEHRFAHRER_GTFS_OFFICIAL_URL,
        'checkedSourceSha256' => hash_file('sha256', $candidateZip),
        'checkedIndexSha256' => hash_file('sha256', $candidateIndex),
        'checkedAgainstSha256' => hash_file('sha256', $currentZip),
        'checkedAgencyId' => $agency,
        'publishedAt' => '2026-10-17T00:00:00Z',
    ], JSON_THROW_ON_ERROR));
}

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
    echo "OK $message\n";
}

function blocked(callable $callback, string $message): void {
    try { $callback(); } catch (Throwable $error) { echo "OK $message\n"; return; }
    throw new RuntimeException($message . ' wurde nicht blockiert.');
}

function clean_fixture(string $path): void {
    if (is_dir($path) && !is_link($path)) {
        foreach (new DirectoryIterator($path) as $entry) {
            if ($entry->isDot()) continue;
            clean_fixture($entry->getPathname());
        }
        rmdir($path);
    } else { unlink($path); }
}

try {
    $old = fixture_files('143', false);
    $new = fixture_files('287', true);
    fixture_zip($currentZip, $old);
    touch($currentZip, strtotime('2026-10-13T00:00:00Z'));
    fixture_index($currentIndex, $old, '143', $currentZip);
    fixture_zip($candidateZip, $new);
    fixture_index($candidateIndex, $new, '287', $candidateZip);
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    $preflight = static fn(): array => lehrfahrer_gtfs_candidate_preflight($candidate, $currentZip, $currentIndex, 0);
    $original = json_decode(file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
    $wrongSha = $original;
    $wrongSha['checkedSourceSha256'] = str_repeat('0', 64);
    file_put_contents($manifestPath, json_encode($wrongSha));
    blocked($preflight, 'Falscher SHA');
    file_put_contents($manifestPath, json_encode($original));
    $wrongAgency = $original;
    $wrongAgency['checkedAgencyId'] = '143';
    file_put_contents($manifestPath, json_encode($wrongAgency));
    blocked($preflight, 'Falscher Betreiber/Agency-ID');
    file_put_contents($manifestPath, json_encode($original));
    $foreign = $new;
    $foreign['agency.txt'] = "agency_id,agency_name\n287,Fremdbetrieb\n";
    fixture_zip($candidateZip, $foreign);
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    blocked($preflight, 'Fremdbetrieb im Kandidaten-ZIP');
    fixture_zip($candidateZip, $new);
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    $pdo = new PDO('sqlite:' . $candidateIndex);
    $pdo->exec("UPDATE meta SET value='" . str_repeat('f', 64) . "' WHERE key='source_sha256'");
    $pdo = null;
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    blocked($preflight, 'Nicht passender ZIP/Index-Postcheck');
    fixture_index($candidateIndex, $new, '287', $candidateZip);
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    $notNewer = json_decode(file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
    $notNewer['publishedAt'] = '2026-10-12T00:00:00Z';
    file_put_contents($manifestPath, json_encode($notNewer));
    blocked($preflight, 'Nicht neuerer Kandidat');
    fixture_manifest($manifestPath, $candidateZip, $candidateIndex, $currentZip);
    $ready = $preflight();
    check($ready['agencyId'] === '287' && $ready['workingSet']['completeness']['complete'], 'Kandidat manuell uebernahmebereit');
    $line16 = array_values(array_filter($ready['analysis']['lines'], static fn(array $line): bool => $line['line'] === '16'));
    check(count($line16) === 1 && $line16[0]['status'] === 'GEAENDERT', 'Linie 16 geaendert');
    $oldSha = hash_file('sha256', $currentZip);
    $newSha = hash_file('sha256', $candidateZip);
    $result = lehrfahrer_gtfs_candidate_adopt($candidate, $currentZip, $currentIndex, $company, 0);
    check(hash_file('sha256', $currentZip) === $newSha && hash_file('sha256', $imports . '/previous.zip') === $oldSha,
        'Fixture current zu previous und Kandidat zu current');
    check(is_file($indexDir . '/variants.sqlite.previous') && $result['workingSet']['completeness']['complete'],
        'Fixture Index und Baseline aktualisiert');
    check(hash_file('sha256', $routeFile) === $routeSha, 'Manuelle Lehrfahrer-Route unveraendert');
    blocked($preflight, 'Wiederholte Uebernahme desselben Kandidaten');
} finally {
    clean_fixture($root);
}
