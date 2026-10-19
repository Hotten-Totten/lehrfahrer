<?php
require_once __DIR__ . '/_gtfs_timetable_change.php';

function lehrfahrer_gtfs_version_info(string $zipPath, ?string $indexPath = null, ?string $operatorName = null): array {
    if (!is_file($zipPath) || is_link($zipPath) || !is_readable($zipPath)) {
        throw new RuntimeException('Server-GTFS-ZIP fehlt oder ist nicht lesbar.');
    }
    $size = filesize($zipPath);
    $mtime = filemtime($zipPath);
    $sha256 = hash_file('sha256', $zipPath);
    if ($size === false || $mtime === false || $sha256 === false) {
        throw new RuntimeException('Server-GTFS-Metadaten sind nicht lesbar.');
    }
    $feed = [];
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) throw new RuntimeException('Server-GTFS-ZIP kann nicht geöffnet werden.');
    try {
        $zipAgencyId = $operatorName !== null ? lehrfahrer_gtfs_operator_id_from_zip($zip, $operatorName) : null;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            if (!is_array($stat) || strtolower(basename(str_replace('\\', '/', (string)$stat['name']))) !== 'feed_info.txt') continue;
            if (($stat['size'] ?? 0) > 65536) break;
            $stream = $zip->getStream((string)$stat['name']);
            if (!$stream) break;
            try {
                $headers = fgetcsv($stream);
                $values = fgetcsv($stream);
                if (is_array($headers) && is_array($values)) {
                    foreach ($headers as $key => $header) {
                        $header = trim(preg_replace('/^\xEF\xBB\xBF/', '', (string)$header));
                        if (in_array($header, ['feed_version', 'feed_start_date', 'feed_end_date', 'feed_publisher_name', 'feed_publisher_url'], true)) {
                            $feed[$header] = trim((string)($values[$key] ?? ''));
                        }
                    }
                }
            } finally {
                fclose($stream);
            }
            break;
        }
    } finally {
        $zip->close();
    }
    $indexedAt = null;
    $indexedSha256 = null;
    $lineCount = null;
    $variantCount = null;
    $agencyId = null;
    if ($indexPath !== null && is_file($indexPath) && !is_link($indexPath) && is_readable($indexPath)) {
        if ($operatorName !== null) {
            $agencyId = lehrfahrer_gtfs_operator_id_from_index($indexPath);
            if ($agencyId !== $zipAgencyId) throw new RuntimeException('GTFS-ZIP und Index nennen unterschiedliche Cottbusverkehr-IDs.');
        }
        $pdo = new PDO('sqlite:file:' . $indexPath . '?mode=ro', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $metadata = $pdo->query('SELECT key, value FROM meta')->fetchAll(PDO::FETCH_KEY_PAIR);
        $indexedAt = $metadata['created_at'] ?? null;
        $indexedSha256 = $metadata['source_sha256'] ?? null;
        $lineCount = (int)$pdo->query('SELECT COUNT(*) FROM routes')->fetchColumn();
        $variantCount = (int)$pdo->query('SELECT COUNT(*) FROM variants')->fetchColumn();
    }
    return [
        'filename' => basename($zipPath),
        'sizeBytes' => $size,
        'modifiedAt' => gmdate('c', $mtime),
        'sha256' => $sha256,
        'feedInfo' => $feed,
        'stand' => gmdate('c', $mtime),
        'standBasis' => 'Dateizeitstempel des Staging-Auszugs; feed_version ist kein datierter Fahrplanstand',
        'importedAt' => null,
        'importDateNote' => 'nicht separat protokolliert; Dateizeitstempel ' . gmdate('c', $mtime),
        'source' => !empty($feed['feed_publisher_name']) ? $feed['feed_publisher_name'] : 'Staging-GTFS-Bestand; Herausgeber im ZIP nicht ausgewiesen',
        'sourceUrl' => !empty($feed['feed_publisher_url']) ? $feed['feed_publisher_url'] : null,
        'indexedAt' => $indexedAt,
        'indexSourceSha256' => $indexedSha256,
        'indexMatchesZip' => $indexedSha256 !== null && hash_equals($sha256, $indexedSha256),
        'lineCount' => $lineCount,
        'variantCount' => $variantCount,
        'agencyId' => $zipAgencyId,
        'agencyIdBasis' => 'nur fuer diesen GTFS-Feed',
    ];
}
