<?php

require_once __DIR__ . '/_private_storage.php';
require_once __DIR__ . '/_runtime_info.php';

/** Staging-only, temporary metadata about use of the legacy credential. */
function lehrfahrer_legacy_observation_endpoint(): string {
    $script = realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? ''));
    $apiRoot = realpath(__DIR__);
    if ($script === false || $apiRoot === false) return '/api/unknown';
    $scriptPath = str_replace('\\', '/', $script);
    $rootPath = rtrim(str_replace('\\', '/', $apiRoot), '/') . '/';
    $inside = DIRECTORY_SEPARATOR === '\\'
        ? strncasecmp($scriptPath, $rootPath, strlen($rootPath)) === 0
        : str_starts_with($scriptPath, $rootPath);
    if (!$inside) return '/api/unknown';
    $relative = substr($scriptPath, strlen($rootPath));
    if (preg_match('~\A(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.php\z~D', $relative) !== 1) {
        return '/api/unknown';
    }
    return '/api/' . $relative;
}

function lehrfahrer_legacy_observation_directory(): string {
    $directory = lehrfahrer_private_storage_root() . DIRECTORY_SEPARATOR . 'legacy-auth-observation';
    if (is_link($directory)) throw new RuntimeException('Ungueltiger Beobachtungspfad.');
    if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) {
        throw new RuntimeException('Beobachtungsverzeichnis nicht verfuegbar.');
    }
    if (is_link($directory) || realpath($directory) === false) {
        throw new RuntimeException('Ungueltiger Beobachtungspfad.');
    }
    if (!@chmod($directory, 0700)) {
        throw new RuntimeException('Beobachtungsverzeichnis nicht geschuetzt.');
    }
    return $directory;
}

function lehrfahrer_legacy_observation_prune(string $directory, string $today): void {
    $marker = $directory . DIRECTORY_SEPARATOR . '.pruned-day';
    if (is_link($marker)) throw new RuntimeException('Ungueltiger Bereinigungsmarker.');
    if (is_file($marker) && trim((string)@file_get_contents($marker)) === $today) return;

    // Retain the current UTC day and the 29 preceding UTC days.
    $cutoffDay = gmdate('Y-m-d', strtotime($today . ' UTC') - 29 * 86400);
    $names = @scandir($directory);
    if ($names === false) throw new RuntimeException('Beobachtungsverzeichnis nicht lesbar.');
    foreach ($names as $name) {
        if (preg_match('/\Aevents-(\d{4}-\d{2}-\d{2})\.jsonl\z/D', $name, $match) !== 1
            || $match[1] >= $cutoffDay) continue;
        $path = $directory . DIRECTORY_SEPARATOR . $name;
        if (is_link($path) || !is_file($path) || !@unlink($path)) {
            throw new RuntimeException('Altes Beobachtungslog konnte nicht bereinigt werden.');
        }
    }
    if (@file_put_contents($marker, $today, LOCK_EX) === false) {
        throw new RuntimeException('Bereinigungsmarker konnte nicht gespeichert werden.');
    }
    if (!@chmod($marker, 0600)) throw new RuntimeException('Bereinigungsmarker nicht geschuetzt.');
}

function lehrfahrer_observe_legacy_auth(string $transport, bool $accepted): void {
    try {
        if (lehrfahrer_environment() !== 'staging') return;
        if (!in_array($transport, ['HEADER', 'REQUEST_PARAMETER'], true)) return;

        $now = time();
        $today = gmdate('Y-m-d', $now);
        $directory = lehrfahrer_legacy_observation_directory();
        $lockPath = $directory . DIRECTORY_SEPARATOR . '.lock';
        if (is_link($lockPath)) return;
        $lock = @fopen($lockPath, 'c+b');
        if ($lock === false) return;
        try {
            if (!@chmod($lockPath, 0600)) return;
            if (!@flock($lock, LOCK_EX)) return;
            try {
                // Once per UTC day; no per-request rewrite of the event files.
                try { lehrfahrer_legacy_observation_prune($directory, $today); }
                catch (Throwable $_error) { /* A cleanup failure must not affect auth or append. */ }

                $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? ''));
                if (!in_array($method, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], true)) {
                    $method = 'OTHER';
                }
                $line = json_encode([
                    'at' => gmdate('Y-m-d\TH:i:s\Z', $now),
                    'method' => $method,
                    'endpoint' => lehrfahrer_legacy_observation_endpoint(),
                    'transport' => $transport,
                    'result' => $accepted ? 'ACCEPTED' : 'REJECTED',
                ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "\n";
                $path = $directory . DIRECTORY_SEPARATOR . 'events-' . $today . '.jsonl';
                if (is_link($path)) return;
                $file = @fopen($path, 'ab');
                if ($file === false) return;
                try {
                    if (!@chmod($path, 0600)) return;
                    @fseek($file, 0, SEEK_END);
                    $start = @ftell($file);
                    $offset = 0;
                    $length = strlen($line);
                    while ($offset < $length) {
                        $written = @fwrite($file, substr($line, $offset));
                        if ($written === false || $written === 0) break;
                        $offset += $written;
                    }
                    if ($offset !== $length || !@fflush($file)) {
                        if (is_int($start)) @ftruncate($file, $start);
                        @fflush($file);
                    }
                } finally {
                    @fclose($file);
                }
            } finally {
                @flock($lock, LOCK_UN);
            }
        } finally {
            @fclose($lock);
        }
    } catch (Throwable $_error) {
        // Neither log failures nor their details may change auth or enter error_log.
    }
}
