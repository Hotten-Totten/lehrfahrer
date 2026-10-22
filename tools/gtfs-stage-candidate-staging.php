<?php
declare(strict_types=1);

$webroot = trim((string)getenv('GTFS_STAGING_WEBROOT'));
if ($webroot === '' || !is_dir($webroot . '/api') || is_link($webroot)) {
    throw new RuntimeException('Staging-Webroot fuer Kandidatenpruefung fehlt.');
}
require_once $webroot . '/api/_tenant_storage.php';
require_once $webroot . '/api/_gtfs_candidate.php';

if (strtolower(trim((string)getenv('LEHRFAHRER_ENV'))) !== 'staging') {
    throw new RuntimeException('Kandidatenpaket darf nur auf Staging gespeichert werden.');
}
$companyId = 'cmp_2ff1b82166c99988ed6f7eb51cca7b56';
$privateRoot = lehrfahrer_private_storage_root();
$projectRoot = realpath($webroot);
$privateNorm = rtrim(str_replace('\\', '/', $privateRoot), '/');
$projectNorm = $projectRoot === false ? '' : rtrim(str_replace('\\', '/', $projectRoot), '/');
if ($projectNorm === '' || $privateNorm === $projectNorm || str_starts_with($privateNorm, $projectNorm . '/')) {
    throw new RuntimeException('Staging-Private-Storage ist ungueltig.');
}
$candidateRoot = lehrfahrer_tenant_ensure_directory($companyId, 'imports', 'gtfs/candidate');
$currentZip = lehrfahrer_tenant_path($companyId, 'imports', 'gtfs/latest.zip');
$currentIndex = lehrfahrer_tenant_path($companyId, 'imports', 'gtfs/index/variants.sqlite');
$uploadedZip = trim((string)getenv('GTFS_CANDIDATE_UPLOAD_ZIP'));
$uploadedIndex = trim((string)getenv('GTFS_CANDIDATE_UPLOAD_INDEX'));
$sourceZip = realpath($uploadedZip);
$sourceIndex = realpath($uploadedIndex);
if ($sourceZip === false || $sourceIndex === false || is_link($uploadedZip) || is_link($uploadedIndex)
    || !str_starts_with(str_replace('\\', '/', $sourceZip), str_replace('\\', '/', $privateRoot) . '/')
    || !str_starts_with(str_replace('\\', '/', $sourceIndex), str_replace('\\', '/', $privateRoot) . '/')) {
    throw new RuntimeException('Kandidaten-Upload liegt nicht im privaten Staging-Speicher.');
}
$publishedAt = trim((string)getenv('GTFS_CANDIDATE_PUBLISHED_AT'));
if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $publishedAt)) {
    throw new RuntimeException('Offizieller Last-Modified-Zeitpunkt fehlt.');
}
$ready = lehrfahrer_gtfs_candidate_publish($candidateRoot, $sourceZip, $sourceIndex,
    $currentZip, $currentIndex, $publishedAt, 50000000, true);
$line16 = array_values(array_filter($ready['analysis']['lines'], static fn(array $line): bool => $line['line'] === '16'));
if (count($line16) !== 1 || $line16[0]['status'] !== 'GEAENDERT') {
    throw new RuntimeException('Linie 16 ist im offiziellen Kandidaten nicht eindeutig geaendert.');
}
$result = json_encode([
    'candidate_id' => $ready['manifest']['candidate_id'],
    'agency_id' => $ready['agencyId'],
    'line16_changed' => true,
    'manual_adoption_ready' => true,
], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$resultFile = trim((string)getenv('GTFS_CANDIDATE_RESULT_FILE'));
if ($resultFile === '' || dirname($resultFile) !== dirname($sourceZip)
    || file_put_contents($resultFile, $result, LOCK_EX) === false) {
    throw new RuntimeException('Privates GTFS-Kandidatenergebnis konnte nicht geschrieben werden.');
}
