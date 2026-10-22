<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_timetable_change.php';
require_once __DIR__ . '/_gtfs_variant_index.php';
require_once __DIR__ . '/_gtfs_work_inventory.php';

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
    if ($size === false || $size < $minimumBytes || $size > 262144000) {
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
    int $minimumBytes = 1048576): array {
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
    $analysis = lehrfahrer_gtfs_compare_operator_indexes($candidateIndex, $currentIndex);
    $workingSet = lehrfahrer_gtfs_working_set($analysis, 'all');
    if (!$workingSet['completeness']['complete']) throw new RuntimeException('GTFS-Kandidat ist nicht vollstaendig.');
    return ['manifest' => $manifest, 'agencyId' => $agency, 'index' => $index,
        'analysis' => $analysis, 'workingSet' => $workingSet];
}

function lehrfahrer_gtfs_candidate_adopt(string $candidateDir, string $currentZip, string $currentIndex,
    string $companyId, int $minimumBytes = 1048576): array {
    $lockPath = dirname($currentIndex) . DIRECTORY_SEPARATOR . 'candidate-adopt.lock';
    $lock = fopen($lockPath, 'c+');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('GTFS-Uebernahme ist bereits aktiv.');
    try {
        $ready = lehrfahrer_gtfs_candidate_preflight($candidateDir, $currentZip, $currentIndex, $minimumBytes);
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
