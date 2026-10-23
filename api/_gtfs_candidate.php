<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_timetable_change.php';
require_once __DIR__ . '/_gtfs_variant_index.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';
require_once __DIR__ . '/_gtfs_version.php';
require_once __DIR__ . '/_gtfs_service_compare.php';
require_once __DIR__ . '/_gtfs_route_compare_v1.php';

const LEHRFAHRER_GTFS_OFFICIAL_URL = 'https://download.gtfs.de/germany/nv_free/latest.zip';

function lehrfahrer_gtfs_candidate_regular(string $path): void {
    if (!is_file($path) || is_link($path) || !is_readable($path)) {
        throw new RuntimeException('Gepruefte GTFS-Kandidatendatei fehlt oder ist kein regulaeres File.');
    }
}

function lehrfahrer_gtfs_candidate_sha(string $path): string {
    lehrfahrer_gtfs_candidate_regular($path);
    $sha = hash_file('sha256', $path);
    if (!is_string($sha)) throw new RuntimeException('GTFS-SHA-256 konnte nicht berechnet werden.');
    return $sha;
}

function lehrfahrer_gtfs_candidate_zip_agency(string $path, int $minimumBytes = 1048576): string {
    lehrfahrer_gtfs_candidate_regular($path);
    $size = filesize($path);
    if ($size === false || $size < $minimumBytes || $size > 500000000) {
        throw new RuntimeException('GTFS-Kandidaten-ZIP hat eine unplausible Dateigroesse.');
    }
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new RuntimeException('GTFS-Kandidaten-ZIP ist ungueltig.');
    try {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            $name = strval($stat['name'] ?? '');
            if ($name === '' || str_contains($name, '\\') || str_starts_with($name, '/')
                || preg_match('/(^|\/)\.\.?($|\/)/', $name)) {
                throw new RuntimeException('GTFS-Kandidaten-ZIP enthaelt einen ungueltigen Pfad.');
            }
            $attributes = $zip->getExternalAttributesIndex($i, $opsys, $attr);
            if ($attributes && $opsys === ZipArchive::OPSYS_UNIX && (($attr >> 16) & 0170000) === 0120000) {
                throw new RuntimeException('GTFS-Kandidaten-ZIP enthaelt einen Symlink.');
            }
        }
        return lehrfahrer_gtfs_operator_id_from_zip($zip);
    } finally {
        $zip->close();
    }
}

function lehrfahrer_gtfs_candidate_preflight(string $candidateDir, string $currentZip, string $currentIndex,
    int $minimumBytes = 1048576, bool $requireNamedDirectory = true, ?string $comparisonDate = null): array {
    if (is_link($candidateDir) || !is_dir($candidateDir)) throw new RuntimeException('Gepruefter GTFS-Kandidat fehlt.');
    $manifestPath = $candidateDir . DIRECTORY_SEPARATOR . 'checked.json';
    lehrfahrer_gtfs_candidate_regular($manifestPath);
    $manifest = json_decode(strval(file_get_contents($manifestPath)), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($manifest) || ($manifest['sourceUrl'] ?? '') !== LEHRFAHRER_GTFS_OFFICIAL_URL) {
        throw new RuntimeException('GTFS-Kandidat besitzt keine gepruefte offizielle Quelle.');
    }
    $candidateZip = $candidateDir . DIRECTORY_SEPARATOR . 'candidate.zip';
    $candidateIndex = $candidateDir . DIRECTORY_SEPARATOR . 'variants.sqlite';
    foreach (['checkedSourceSha256', 'checkedIndexSha256', 'checkedAgainstSha256'] as $field) {
        if (preg_match('/^[a-f0-9]{64}$/D', strval($manifest[$field] ?? '')) !== 1) {
            throw new RuntimeException('GTFS-Kandidatenbindung ist unvollstaendig.');
        }
    }
    if (($manifest['candidate_id'] ?? '') !== $manifest['checkedSourceSha256']
        || ($manifest['source_sha256'] ?? '') !== $manifest['checkedSourceSha256']
        || ($manifest['agency_name'] ?? '') !== LEHRFAHRER_GTFS_COTTBUS_NAME
        || ($manifest['zip_path'] ?? '') !== 'candidate.zip'
        || ($manifest['index_path'] ?? '') !== 'variants.sqlite'
        || ($manifest['validation_status'] ?? '') !== 'OK'
        || strtotime(strval($manifest['validation_timestamp'] ?? '')) === false
        || strtotime(strval($manifest['created_at'] ?? '')) === false
        || ($requireNamedDirectory && basename($candidateDir) !== $manifest['candidate_id'])) {
        throw new RuntimeException('GTFS-Kandidatenmanifest ist unvollstaendig oder ungebunden.');
    }
    if (!hash_equals($manifest['checkedSourceSha256'], lehrfahrer_gtfs_candidate_sha($candidateZip))) {
        throw new RuntimeException('GTFS-Kandidaten-SHA weicht vom geprueften SHA ab.');
    }
    if (!hash_equals($manifest['checkedIndexSha256'], lehrfahrer_gtfs_candidate_sha($candidateIndex))) {
        throw new RuntimeException('GTFS-Kandidatenindex wurde seit der Pruefung veraendert.');
    }
    if (!hash_equals($manifest['checkedAgainstSha256'], lehrfahrer_gtfs_candidate_sha($currentZip))) {
        throw new RuntimeException('Aktueller GTFS-Stand hat sich seit der Kandidatenpruefung geaendert.');
    }
    $agency = lehrfahrer_gtfs_candidate_zip_agency($candidateZip, $minimumBytes);
    if ($agency !== strval($manifest['checkedAgencyId'] ?? '')) {
        throw new RuntimeException('Cottbusverkehr-Agency-ID weicht vom geprueften Kandidaten ab.');
    }
    if ($agency !== strval($manifest['agency_id'] ?? '')) {
        throw new RuntimeException('GTFS-Manifest hat eine abweichende Agency-ID.');
    }
    $indexAgency = lehrfahrer_gtfs_operator_id_from_index($candidateIndex);
    if ($indexAgency !== $agency) throw new RuntimeException('GTFS-Kandidaten-ZIP und Index haben verschiedene Betreiber.');
    $index = lehrfahrer_gtfs_validate_variant_index($candidateIndex, [$agency]);
    $pdo = new PDO('sqlite:file:' . $candidateIndex . '?mode=ro', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $indexSourceSha = strval($pdo->query("SELECT value FROM meta WHERE key='source_sha256'")->fetchColumn());
    $pdo = null;
    if (!hash_equals($manifest['checkedSourceSha256'], $indexSourceSha)) {
        throw new RuntimeException('ZIP/Index-Postcheck des Kandidaten fehlgeschlagen.');
    }
    $currentAgency = lehrfahrer_gtfs_operator_id_from_index($currentIndex);
    lehrfahrer_gtfs_validate_variant_index($currentIndex, [$currentAgency]);
    $pdo = new PDO('sqlite:file:' . $currentIndex . '?mode=ro', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $currentSourceSha = strval($pdo->query("SELECT value FROM meta WHERE key='source_sha256'")->fetchColumn());
    $pdo = null;
    if (!hash_equals($manifest['checkedAgainstSha256'], $currentSourceSha)) {
        throw new RuntimeException('ZIP/Index-Postcheck des aktuellen Standes fehlgeschlagen.');
    }
    $published = strtotime(strval($manifest['publishedAt'] ?? ''));
    $currentModified = filemtime($currentZip);
    if ($published === false || $currentModified === false || $published <= $currentModified
        || hash_equals($manifest['checkedSourceSha256'], $manifest['checkedAgainstSha256'])) {
        throw new RuntimeException('GTFS-Kandidat ist nicht nachweislich neuer als der aktuelle Stand.');
    }
    $inventoryAnalysis = lehrfahrer_gtfs_compare_operator_indexes($candidateIndex, $currentIndex);
    $workingSet = lehrfahrer_gtfs_working_set($inventoryAnalysis, 'all');
    if (!$workingSet['completeness']['complete']) throw new RuntimeException('GTFS-Kandidat ist nicht vollstaendig.');
    $analysis = $requireNamedDirectory
        ? lehrfahrer_gtfs_routes_v1_cached($candidateZip, $currentZip,
            dirname(dirname($candidateDir)) . '/route-v1-cache',
            $manifest['checkedSourceSha256'], $manifest['checkedAgainstSha256'])
        : lehrfahrer_gtfs_compare_routes_v1($candidateZip, $currentZip);
    return ['manifest' => $manifest, 'agencyId' => $agency, 'index' => $index,
        'analysis' => $analysis, 'workingSet' => $workingSet,
        'manualAdoptionReady' => $analysis['comparable']];
}

function lehrfahrer_gtfs_candidate_active_dir(string $candidateRoot): string {
    if (!is_dir($candidateRoot) || is_link($candidateRoot)) throw new RuntimeException('Kein persistierter GTFS-Kandidat vorhanden.');
    $pointer = $candidateRoot . DIRECTORY_SEPARATOR . 'active.json';
    lehrfahrer_gtfs_candidate_regular($pointer);
    $active = json_decode(strval(file_get_contents($pointer)), true, 512, JSON_THROW_ON_ERROR);
    $id = strval($active['candidate_id'] ?? '');
    if (preg_match('/^[a-f0-9]{64}$/D', $id) !== 1) throw new RuntimeException('GTFS-Kandidatenzeiger ist ungueltig.');
    $packages = $candidateRoot . DIRECTORY_SEPARATOR . 'packages';
    if (!is_dir($packages) || is_link($packages)) throw new RuntimeException('GTFS-Kandidatenablage fehlt.');
    return $packages . DIRECTORY_SEPARATOR . $id;
}

function lehrfahrer_gtfs_candidate_publish(string $candidateRoot, string $incomingZip, string $incomingIndex,
    string $currentZip, string $currentIndex, string $publishedAt, int $minimumBytes = 1048576,
    bool $requireChangedLine16 = false): array {
    if (!is_dir($candidateRoot) || is_link($candidateRoot)) throw new RuntimeException('GTFS-Kandidatenablage fehlt.');
    lehrfahrer_gtfs_candidate_regular($incomingZip);
    lehrfahrer_gtfs_candidate_regular($incomingIndex);
    $id = lehrfahrer_gtfs_candidate_sha($incomingZip);
    $packages = $candidateRoot . DIRECTORY_SEPARATOR . 'packages';
    if (!is_dir($packages) && !mkdir($packages, 0700)) throw new RuntimeException('GTFS-Kandidatenablage kann nicht angelegt werden.');
    if (is_link($packages)) throw new RuntimeException('Symlink in der GTFS-Kandidatenablage.');
    $target = $packages . DIRECTORY_SEPARATOR . $id;
    $temp = $packages . DIRECTORY_SEPARATOR . '.building-' . bin2hex(random_bytes(8));
    if (file_exists($target) || is_link($target)) {
        $ready = lehrfahrer_gtfs_candidate_preflight($target, $currentZip, $currentIndex, $minimumBytes);
    } else {
        if (!mkdir($temp, 0700)) throw new RuntimeException('GTFS-Kandidatenpaket kann nicht vorbereitet werden.');
        try {
            if (!copy($incomingZip, $temp . '/candidate.zip') || !copy($incomingIndex, $temp . '/variants.sqlite')) {
                throw new RuntimeException('GTFS-Kandidatendateien konnten nicht gespeichert werden.');
            }
            $agency = lehrfahrer_gtfs_candidate_zip_agency($temp . '/candidate.zip', $minimumBytes);
            $version = lehrfahrer_gtfs_version_info($temp . '/candidate.zip', $temp . '/variants.sqlite', LEHRFAHRER_GTFS_COTTBUS_NAME);
            $now = gmdate('c');
            $manifest = [
                'candidate_id' => $id,
                'created_at' => $now,
                'source' => 'DELFI nv_free',
                'sourceUrl' => LEHRFAHRER_GTFS_OFFICIAL_URL,
                'source_sha256' => $id,
                'checkedSourceSha256' => $id,
                'checkedIndexSha256' => lehrfahrer_gtfs_candidate_sha($temp . '/variants.sqlite'),
                'checkedAgainstSha256' => lehrfahrer_gtfs_candidate_sha($currentZip),
                'agency_id' => $agency,
                'checkedAgencyId' => $agency,
                'agency_name' => LEHRFAHRER_GTFS_COTTBUS_NAME,
                'zip_path' => 'candidate.zip',
                'index_path' => 'variants.sqlite',
                'validation_status' => 'OK',
                'validation_timestamp' => $now,
                'publishedAt' => $publishedAt,
                'feed_info' => $version['feedInfo'],
                'line_count' => $version['lineCount'],
                'variant_count' => $version['variantCount'],
            ];
            $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (file_put_contents($temp . '/checked.json', $json, LOCK_EX) === false) {
                throw new RuntimeException('GTFS-Kandidatenmanifest konnte nicht gespeichert werden.');
            }
            lehrfahrer_gtfs_candidate_preflight($temp, $currentZip, $currentIndex, $minimumBytes, false);
            if (!rename($temp, $target)) throw new RuntimeException('GTFS-Kandidatenpaket konnte nicht aktiviert werden.');
            $temp = '';
            $ready = lehrfahrer_gtfs_candidate_preflight($target, $currentZip, $currentIndex, $minimumBytes);
            foreach (['candidate.zip', 'variants.sqlite', 'checked.json'] as $name) @chmod($target . '/' . $name, 0440);
            @chmod($target, 0550);
        } finally {
            if ($temp !== '' && is_dir($temp)) {
                foreach (['candidate.zip', 'variants.sqlite', 'checked.json'] as $name) @unlink($temp . '/' . $name);
                @rmdir($temp);
            }
        }
    }
    if ($requireChangedLine16) {
        $line16 = array_values(array_filter($ready['analysis']['lines'],
            static fn(array $line): bool => $line['line'] === '16'));
        if (count($line16) !== 1 || $line16[0]['status'] !== 'GEAENDERT') {
            throw new RuntimeException('Linie 16 ist im offiziellen Kandidaten nicht eindeutig geaendert.');
        }
    }
    $pointer = $candidateRoot . DIRECTORY_SEPARATOR . 'active.json';
    if (is_link($pointer)) throw new RuntimeException('GTFS-Kandidatenzeiger ist ein Symlink.');
    $pointerTemp = $candidateRoot . DIRECTORY_SEPARATOR . '.active-' . bin2hex(random_bytes(8));
    if (file_put_contents($pointerTemp, json_encode(['candidate_id' => $id], JSON_THROW_ON_ERROR), LOCK_EX) === false
        || !rename($pointerTemp, $pointer)) {
        @unlink($pointerTemp);
        throw new RuntimeException('GTFS-Kandidatenzeiger konnte nicht gesetzt werden.');
    }
    return $ready;
}

function lehrfahrer_gtfs_candidate_adopt(string $candidateDir, string $currentZip, string $currentIndex,
    string $companyId, int $minimumBytes = 1048576, ?string $comparisonDate = null): array {
    $lockPath = dirname($currentIndex) . DIRECTORY_SEPARATOR . 'candidate-adopt.lock';
    $lock = fopen($lockPath, 'c+');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('GTFS-Uebernahme ist bereits aktiv.');
    try {
        $ready = lehrfahrer_gtfs_candidate_preflight($candidateDir, $currentZip, $currentIndex,
            $minimumBytes, true, $comparisonDate);
        if (!$ready['manualAdoptionReady']) {
            throw new RuntimeException('Keine gemeinsame Fahrplanperiode; manuelle Uebernahme bleibt gesperrt.');
        }
        $candidateZip = $candidateDir . DIRECTORY_SEPARATOR . 'candidate.zip';
        $candidateIndex = $candidateDir . DIRECTORY_SEPARATOR . 'variants.sqlite';
        $previousZip = dirname($currentZip) . DIRECTORY_SEPARATOR . 'previous.zip';
        $previousIndex = dirname($currentIndex) . DIRECTORY_SEPARATOR . 'variants.sqlite.previous';
        $workingPath = dirname($currentIndex) . DIRECTORY_SEPARATOR . 'working-set.json';
        $inventoryPath = lehrfahrer_gtfs_work_inventory_path($companyId);
        $targets = [$currentZip, $currentIndex, $previousZip, $previousIndex, $workingPath, $inventoryPath];
        $backups = [];
        $mutating = false;
        $suffix = '.adopt-backup-' . bin2hex(random_bytes(8));
        try {
            foreach ($targets as $target) {
                if (is_link($target)) throw new RuntimeException('Symlink im GTFS-Uebernahmeziel.');
                if (is_file($target)) {
                    $backup = $target . $suffix;
                    if (!copy($target, $backup)) throw new RuntimeException('GTFS-Uebernahmebackup fehlgeschlagen.');
                    $backups[$target] = $backup;
                }
            }
            $mutating = true;
            foreach ([[$currentZip, $previousZip], [$currentIndex, $previousIndex],
                [$candidateZip, $currentZip], [$candidateIndex, $currentIndex]] as [$source, $target]) {
                $temp = $target . '.adopt-' . bin2hex(random_bytes(8));
                if (!copy($source, $temp) || !rename($temp, $target)) {
                    @unlink($temp);
                    throw new RuntimeException('GTFS-Datei konnte nicht kontrolliert aktiviert werden.');
                }
            }
            lehrfahrer_gtfs_write_working_set($workingPath, $ready['workingSet']);
            $inventory = lehrfahrer_gtfs_work_reconcile($companyId, $currentIndex, [$ready['agencyId']]);
            if (!($inventory['completeness']['complete'] ?? false)) {
                throw new RuntimeException('GTFS-Arbeitsvorrat ist nach Uebernahme unvollstaendig.');
            }
            $check = lehrfahrer_gtfs_candidate_sha($currentZip);
            $indexCheck = lehrfahrer_gtfs_candidate_sha($currentIndex);
            if (!hash_equals($ready['manifest']['checkedSourceSha256'], $check)
                || !hash_equals($ready['manifest']['checkedIndexSha256'], $indexCheck)
                || !hash_equals($ready['manifest']['checkedAgainstSha256'], lehrfahrer_gtfs_candidate_sha($previousZip))) {
                throw new RuntimeException('GTFS-Postcheck nach Uebernahme fehlgeschlagen.');
            }
        } catch (Throwable $error) {
            if ($mutating) foreach ($targets as $target) {
                if (isset($backups[$target])) @copy($backups[$target], $target);
                elseif (is_file($target)) @unlink($target);
            }
            throw $error;
        } finally {
            foreach ($backups as $backup) @unlink($backup);
        }
        return $ready;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
