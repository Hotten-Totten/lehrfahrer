<?php
declare(strict_types=1);

$apiRoot = trim(strval(getenv('GTFS_SERVICE_API_ROOT')));
if ($apiRoot === '') $apiRoot = __DIR__ . '/../api';
require_once $apiRoot . '/_gtfs_timetable_change.php';
require_once $apiRoot . '/_gtfs_service_compare.php';

if ($argc !== 3) {
    fwrite(STDERR, "usage: php gtfs-service-compare-cli.php CANDIDATE_ZIP CURRENT_ZIP\n");
    exit(2);
}
$result = lehrfahrer_gtfs_compare_service_zips($argv[1], $argv[2]);
$line16 = array_values(array_filter($result['lines'], static fn(array $line): bool => $line['line'] === '16'));
echo json_encode([
    'comparisonMode' => $result['comparisonMode'],
    'comparisonDate' => $result['comparisonDate'],
    'currentPeriod' => $result['currentPeriod'],
    'candidatePeriod' => $result['candidatePeriod'],
    'currentAgency' => $result['currentAgency'],
    'candidateAgency' => $result['candidateAgency'],
    'currentValidTrips' => $result['currentValidTrips'],
    'candidateValidTrips' => $result['candidateValidTrips'],
    'currentValidLines' => $result['currentValidLines'],
    'candidateValidLines' => $result['candidateValidLines'],
    'lineCounts' => $result['lineCounts'],
    'line16Status' => $line16[0]['status'] ?? 'NICHT_VERGLEICHBAR',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
