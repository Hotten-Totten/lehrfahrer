<?php
declare(strict_types=1);

require_once __DIR__ . '/../api/_gtfs_timetable_change.php';
require_once __DIR__ . '/../api/_gtfs_service_compare.php';

function check_service(bool $ok, string $label): void {
    if (!$ok) throw new RuntimeException($label);
    echo "OK $label\n";
}
function csv_service(array $rows): string {
    $out = fopen('php://temp', 'r+');
    foreach ($rows as $row) fputcsv($out, $row, ',', '"', '');
    rewind($out); $text = stream_get_contents($out); fclose($out);
    return $text;
}
function zip_service(string $path, string $agency, array $routes, string $start = '20261019',
    string $end = '20261025', array $exceptions = []): void {
    $stopRows = [['stop_id','stop_name','stop_lat','stop_lon']];
    $routeRows = [['route_id','agency_id','route_short_name','route_type']];
    $tripRows = [['route_id','service_id','trip_id']];
    $timeRows = [['trip_id','stop_id','stop_sequence']];
    $seen = [];
    foreach ($routes as $route) {
        $routeRows[] = [$route['id'],$agency,$route['line'],'3'];
        foreach ($route['trips'] as $trip) {
            $tripRows[] = [$route['id'],$trip['service'],$trip['id']];
            foreach ($trip['stops'] as $i => $stop) {
                if (!isset($seen[$stop[0]])) {
                    $stopRows[] = $stop; $seen[$stop[0]] = true;
                }
                $timeRows[] = [$trip['id'],$stop[0],$i+1];
            }
        }
    }
    $files = [
        'agency.txt' => csv_service([['agency_id','agency_name'],[$agency,'Cottbusverkehr']]),
        'routes.txt' => csv_service($routeRows), 'trips.txt' => csv_service($tripRows),
        'stops.txt' => csv_service($stopRows), 'stop_times.txt' => csv_service($timeRows),
        'calendar.txt' => csv_service([['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'],
            ['s',1,1,1,1,1,0,0,$start,$end]]),
        'calendar_dates.txt' => csv_service(array_merge([['service_id','date','exception_type']],$exceptions)),
    ];
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Fixture ZIP');
    foreach ($files as $name => $data) $zip->addFromString($name,$data);
    $zip->close();
}
function cmp_service(string $new, string $old, ?string $date = '2026-10-21'): array {
    return lehrfahrer_gtfs_compare_service_zips($new,$old,$date);
}

$dir = sys_get_temp_dir() . '/gtfs-service-fixture-' . bin2hex(random_bytes(8));
mkdir($dir,0700);
$a = ['a','Start','51.7000','14.3000'];
$b = ['b','Mitte','51.7100','14.3100'];
$u = ['u','Uhlandstraße','51.7200','14.3200'];
$a2 = ['aa','Start','51.7000','14.3000'];
$b2 = ['bb','Mitte','51.7100','14.3100'];
$u2 = ['uu','Uhlandstraße','51.7200','14.3200'];
$x = ['x','Neue Haltestelle','51.7150','14.3150'];
$base = [['id'=>'old16','line'=>'16','trips'=>[['id'=>'oldtrip','service'=>'s','stops'=>[$a,$b,$u]]]]];
$same = [['id'=>'new16','line'=>'16','trips'=>[['id'=>'newtrip','service'=>'s','stops'=>[$a2,$b2,$u2]]]]];
try {
    zip_service($dir.'/old.zip','143',$base);
    zip_service($dir.'/same.zip','325',$same);
    $calendar = [['service_id'=>'s','start_date'=>'20261019','end_date'=>'20261025',
        'monday'=>'1','tuesday'=>'1','wednesday'=>'1','thursday'=>'1','friday'=>'1','saturday'=>'0','sunday'=>'0']];
    $days = lehrfahrer_gtfs_service_calendar(['s'=>$calendar[0]],[]);
    check_service(isset($days['s']['2026-10-21']) && !isset($days['s']['2026-10-24']), 'calendar weekdays');
    $days = lehrfahrer_gtfs_service_calendar(['s'=>$calendar[0]], [
        ['service_id'=>'s','date'=>'20261024','exception_type'=>'1'],
        ['service_id'=>'s','date'=>'20261021','exception_type'=>'2']]);
    check_service(isset($days['s']['2026-10-24']) && !isset($days['s']['2026-10-21']), 'calendar_dates additions and removals override calendar');
    $sameResult = cmp_service($dir.'/same.zip',$dir.'/old.zip');
    check_service($sameResult['comparable'] && $sameResult['currentAgency']==='143'
        && $sameResult['candidateAgency']==='325' && $sameResult['lineCounts']['UNVERAENDERT']===1,
        'feed-local agency and stop IDs do not fabricate changes');
    check_service($sameResult['currentValidTrips']===1 && $sameResult['candidateValidTrips']===1,
        'only active services contribute trips');
    $ambiguous = $same;
    $ambiguous[0]['trips'][] = ['id'=>'ambiguous','service'=>'s',
        'stops'=>[$a2,['other-middle','Mitte','51.7100','14.3100'],$u2]];
    zip_service($dir.'/ambiguous.zip','325',$ambiguous);
    try {
        cmp_service($dir.'/ambiguous.zip',$dir.'/old.zip');
        throw new RuntimeException('Ambiguous stops were merged');
    } catch (RuntimeException $error) {
        if ($error->getMessage()==='Ambiguous stops were merged') throw $error;
    }
    check_service(true, 'ambiguous real stops are not merged');
    $changed = $same; $changed[0]['trips'][0]['stops'] = [$a2,$x,$u2];
    zip_service($dir.'/changed.zip','325',$changed);
    $r = cmp_service($dir.'/changed.zip',$dir.'/old.zip');
    check_service($r['lineCounts']['GEAENDERT']===1 && count($r['lines'][0]['stopSequenceChanges'])===1
        && count($r['lines'][0]['addedVariants'])===0, 'true changed stop sequence');
    $more = $same; $more[0]['trips'][] = ['id'=>'another','service'=>'s','stops'=>[$a2,$x,$u2]];
    zip_service($dir.'/more.zip','325',$more);
    $r=cmp_service($dir.'/more.zip',$dir.'/same.zip');
    check_service(count($r['lines'][0]['addedVariants'])===1 && count($r['lines'][0]['removedVariants'])===0,
        'variant added');
    $r=cmp_service($dir.'/same.zip',$dir.'/more.zip');
    check_service(count($r['lines'][0]['removedVariants'])===1, 'variant removed');
    $two=$same; $two[]=['id'=>'r20','line'=>'20','trips'=>[['id'=>'t20','service'=>'s','stops'=>[$a2,$x]]]];
    zip_service($dir.'/two.zip','325',$two);
    check_service(cmp_service($dir.'/two.zip',$dir.'/same.zip')['lineCounts']['NEU']===1,'line added');
    check_service(cmp_service($dir.'/same.zip',$dir.'/two.zip')['lineCounts']['ENTFALLEN']===1,'line removed');
    zip_service($dir.'/future.zip','325',$same,'20261102','20261108');
    $r=cmp_service($dir.'/future.zip',$dir.'/old.zip',null);
    check_service(!$r['comparable'] && $r['comparisonMode']==='KEINE_GEMEINSAME_FAHRPLANPERIODE'
        && $r['lineCounts']['GEAENDERT']===0,'no common period blocks change claims');
    zip_service($dir.'/exception.zip','325',$same,'20261019','20261025',[
        ['s','20261021','2'],['s','20261024','1']]);
    $r=cmp_service($dir.'/exception.zip',$dir.'/old.zip','2026-10-21');
    check_service(!$r['comparable'] && $r['candidateValidTrips']===0,'removed service excluded');
    $r=cmp_service($dir.'/exception.zip',$dir.'/old.zip','2026-10-24');
    check_service(!$r['comparable'] && $r['candidateValidTrips']===1,'added service included');
    check_service($sameResult['lines'][0]['line']==='16' && $sameResult['lineCounts']['UNVERAENDERT']===1,
        'line 16 to Uhlandstraße is not new solely from feed IDs');
} finally {
    foreach (glob($dir.'/*.zip') ?: [] as $file) unlink($file);
    rmdir($dir);
}
