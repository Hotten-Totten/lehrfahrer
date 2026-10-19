<?php
declare(strict_types=1);

const STAMP_COMPANY_ID = 'cmp_2ff1b82166c99988ed6f7eb51cca7b56';

function stamp_fail(string $message): never {
    throw new RuntimeException($message);
}

function stamp_regular(string $path): void {
    if (!is_file($path) || is_link($path) || !is_readable($path)) stamp_fail('Staging-GTFS-Datei fehlt oder ist unsicher.');
}

function stamp_db(string $path, bool $readonly): PDO {
    $dsn = $readonly ? 'sqlite:file:' . $path . '?mode=ro' : 'sqlite:' . $path;
    $pdo = new PDO($dsn, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA busy_timeout=5000;');
    if ($readonly) $pdo->exec('PRAGMA query_only=ON;');
    return $pdo;
}

function stamp_equal_tables(PDO $existing, PDO $rebuilt): void {
    foreach (['agencies' => 'agency_id', 'routes' => 'route_id', 'variants' => 'route_id, variant_id'] as $table => $order) {
        $query = "SELECT * FROM $table ORDER BY $order";
        $old = $existing->query($query);
        $new = $rebuilt->query($query);
        while (true) {
            $oldRow = $old->fetch(PDO::FETCH_NUM);
            $newRow = $new->fetch(PDO::FETCH_NUM);
            if ($oldRow !== $newRow) stamp_fail('Indexdaten weichen vom aktuellen GTFS-ZIP ab: ' . $table);
            if ($oldRow === false) break;
        }
    }
}

function stamp_inventory_matches(PDO $index, array $inventory): void {
    $entries = $inventory['entries'] ?? null;
    if (!is_array($entries)) stamp_fail('GTFS-Arbeitsvorrat fehlt.');
    $variants = [];
    foreach ($index->query('SELECT route_id, variant_id, signature FROM variants') as $row) {
        $key = hash('sha256', strval($row['route_id']) . "\0" . strval($row['variant_id']));
        $variants[$key] = strval($row['signature']);
    }
    if (count($entries) !== count($variants)) stamp_fail('GTFS-Arbeitsvorrat ist nicht vollstaendig.');
    foreach ($entries as $entry) {
        if (!is_array($entry)) stamp_fail('GTFS-Arbeitsvorrat ist ungueltig.');
        $key = hash('sha256', strval($entry['routeId'] ?? '') . "\0" . strval($entry['variantId'] ?? ''));
        if (!isset($variants[$key]) || !hash_equals($variants[$key], strval($entry['signature'] ?? ''))
            || !in_array(($entry['status'] ?? ''), ['UNGEPRUEFT', 'IN_BEARBEITUNG', 'GEPRUEFT', 'FREIGEGEBEN'], true)) {
            stamp_fail('GTFS-Arbeitsvorrat weicht vom Index ab.');
        }
        unset($variants[$key]);
    }
    if ($variants !== []) stamp_fail('GTFS-Arbeitsvorrat enthaelt nicht alle Varianten.');
}

try {
    if (PHP_SAPI !== 'cli' || getenv('LEHRFAHRER_ENV') !== 'staging') stamp_fail('Nur Staging-CLI erlaubt.');
    $appRoot = strval(getenv('LEHRFAHRER_APP_ROOT'));
    if ($appRoot === '' || !is_dir($appRoot)) stamp_fail('Staging-App-Root fehlt.');
    require_once $appRoot . '/api/_tenant_storage.php';
    require_once $appRoot . '/api/_gtfs_variant_index.php';
    require_once $appRoot . '/api/_gtfs_timetable_change.php';
    require_once $appRoot . '/api/_gtfs_version.php';

    $zipPath = lehrfahrer_tenant_path(STAMP_COMPANY_ID, 'imports', 'gtfs/latest.zip');
    $indexPath = lehrfahrer_tenant_path(STAMP_COMPANY_ID, 'imports', 'gtfs/index/variants.sqlite');
    $inventoryPath = lehrfahrer_tenant_path(STAMP_COMPANY_ID, 'imports', 'gtfs/index/work-inventory.json');
    $lockPath = lehrfahrer_tenant_path(STAMP_COMPANY_ID, 'imports', 'gtfs/index/index_job.lock');
    foreach ([$zipPath, $indexPath, $inventoryPath] as $path) stamp_regular($path);
    if (is_link($lockPath)) stamp_fail('GTFS-Index-Lock ist ein Symlink.');
    $lock = fopen($lockPath, 'c+');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) stamp_fail('GTFS-Index wird anderweitig bearbeitet.');
    $directory = dirname($indexPath);
    if (is_file($directory . '/variants.building.sqlite')) stamp_fail('GTFS-Indexjob ist noch aktiv.');
    if (is_file($indexPath . '-wal') || is_file($indexPath . '-journal')) stamp_fail('GTFS-Index besitzt offene SQLite-Nebendateien.');

    $zipSha = hash_file('sha256', $zipPath);
    if (!is_string($zipSha) || preg_match('/^[a-f0-9]{64}$/D', $zipSha) !== 1) stamp_fail('GTFS-ZIP-SHA fehlt.');
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) stamp_fail('GTFS-ZIP ist nicht lesbar.');
    try {
        $agencyId = lehrfahrer_gtfs_operator_id_from_zip($zip);
        if ($agencyId !== lehrfahrer_gtfs_operator_id_from_index($indexPath)) stamp_fail('ZIP/Index-Betreiber weichen ab.');
        $files = [];
        foreach (['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'] as $name) {
            $value = $zip->getFromName($name);
            if (!is_string($value)) stamp_fail('GTFS-Tabelle fehlt: ' . $name);
            $files[$name] = $value;
        }
    } finally {
        $zip->close();
    }
    $old = stamp_db($indexPath, true);
    $meta = $old->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
    if ((int)($meta['feed_size'] ?? -1) !== filesize($zipPath)
        || (int)($meta['feed_mtime'] ?? -1) !== filemtime($zipPath)) {
        stamp_fail('Index-ZIP-Metadaten stimmen nicht ueberein.');
    }
    $oldSource = strval($meta['source_sha256'] ?? '');
    if ($oldSource !== '' && !hash_equals($oldSource, $zipSha)) stamp_fail('Index enthaelt einen anderen Quell-SHA.');
    $validation = lehrfahrer_gtfs_validate_variant_index($indexPath, [$agencyId]);
    if ($validation['routes'] !== 75 || $validation['variants'] !== 678) stamp_fail('Index ist nicht der erwartete Cottbus-Stand.');
    $inventory = json_decode((string)file_get_contents($inventoryPath), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($inventory)) stamp_fail('GTFS-Arbeitsvorrat ist ungueltig.');
    stamp_inventory_matches($old, $inventory);

    $suffix = bin2hex(random_bytes(8));
    $rebuiltPath = $directory . '/.source-verify-' . $suffix . '.sqlite';
    $stampedPath = $directory . '/.source-stamped-' . $suffix . '.sqlite';
    $inventoryTemp = $directory . '/.inventory-stamped-' . $suffix . '.json';
    $indexBackup = $directory . '/.source-original-' . $suffix . '.sqlite';
    $inventoryBackup = $directory . '/.inventory-original-' . $suffix . '.json';
    try {
        lehrfahrer_gtfs_build_variant_index($files, $rebuiltPath, [$agencyId],
            ['source_sha256' => $zipSha, 'created_at' => strval($meta['created_at'] ?? '')]);
        $rebuilt = stamp_db($rebuiltPath, true);
        stamp_equal_tables($old, $rebuilt);
        $rebuilt = null;
        $old = null;
        if (!hash_equals($zipSha, strval(hash_file('sha256', $zipPath)))) stamp_fail('GTFS-ZIP wurde waehrend der Pruefung geaendert.');
        if (!copy($indexPath, $stampedPath)) stamp_fail('Index-Kopie konnte nicht erstellt werden.');
        $stamped = stamp_db($stampedPath, false);
        $statement = $stamped->prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
        $statement->execute(['source_sha256', $zipSha]);
        $stamped = null;
        $inventory['sourceIndexSha256'] = hash_file('sha256', $stampedPath);
        $json = json_encode($inventory, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (file_put_contents($inventoryTemp, $json, LOCK_EX) === false) stamp_fail('Arbeitsvorrat-Metadaten konnten nicht vorbereitet werden.');
        chmod($stampedPath, 0600);
        chmod($inventoryTemp, 0600);
        if (!rename($indexPath, $indexBackup)) stamp_fail('Index-Backup konnte nicht erstellt werden.');
        if (!rename($stampedPath, $indexPath)) {
            rename($indexBackup, $indexPath);
            stamp_fail('Index-Metadaten konnten nicht aktiviert werden.');
        }
        if (!rename($inventoryPath, $inventoryBackup) || !rename($inventoryTemp, $inventoryPath)) {
            if (is_file($inventoryBackup)) rename($inventoryBackup, $inventoryPath);
            rename($indexPath, $stampedPath);
            rename($indexBackup, $indexPath);
            stamp_fail('Arbeitsvorrat-Metadaten konnten nicht aktiviert werden.');
        }
        try {
            $version = lehrfahrer_gtfs_version_info($zipPath, $indexPath, LEHRFAHRER_GTFS_COTTBUS_NAME);
            if ($version['indexMatchesZip'] !== true) stamp_fail('ZIP/Index-Postcheck ist fehlgeschlagen.');
        } catch (Throwable $error) {
            rename($inventoryPath, $inventoryTemp);
            rename($inventoryBackup, $inventoryPath);
            rename($indexPath, $stampedPath);
            rename($indexBackup, $indexPath);
            throw $error;
        }
        unlink($indexBackup);
        unlink($inventoryBackup);
        echo "GTFS_SOURCE_SHA=OK\nGTFS_ZIP_INDEX=OK\n";
    } finally {
        foreach ([$rebuiltPath, $stampedPath, $inventoryTemp] as $temp) {
            if (is_file($temp) && !is_link($temp)) unlink($temp);
        }
    }
    flock($lock, LOCK_UN);
    fclose($lock);
} catch (Throwable $error) {
    file_put_contents('php://stderr', 'GTFS-SHA-Korrektur blockiert: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
