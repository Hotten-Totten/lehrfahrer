<?php

require_once __DIR__ . '/_private_storage.php';

const LEHRFAHRER_ACTIVATION_RATE_WINDOW_SECONDS = 900;
const LEHRFAHRER_ACTIVATION_RATE_MAX_ATTEMPTS = 10;

function lehrfahrer_activation_allow_attempt(string $remoteAddress, ?int $now = null): bool {
    $now ??= time();
    $key = hash('sha256', $remoteAddress !== '' ? $remoteAddress : 'unknown');
    $file = lehrfahrer_private_storage_directory('activation-rate')
        . DIRECTORY_SEPARATOR . $key . '.json';
    $handle = fopen($file, 'c+');
    if ($handle === false) throw new RuntimeException('Aktivierungs-Limit konnte nicht geoeffnet werden.');
    @chmod($file, 0600);
    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Aktivierungs-Limit konnte nicht gesperrt werden.');
        }
        rewind($handle);
        $state = json_decode((string)stream_get_contents($handle), true);
        $started = is_array($state) ? (int)($state['started'] ?? 0) : 0;
        $count = is_array($state) ? (int)($state['count'] ?? 0) : 0;
        if ($started <= 0 || $started > $now || $now - $started >= LEHRFAHRER_ACTIVATION_RATE_WINDOW_SECONDS) {
            $started = $now;
            $count = 0;
        }
        if ($count >= LEHRFAHRER_ACTIVATION_RATE_MAX_ATTEMPTS) return false;
        $payload = json_encode(['started' => $started, 'count' => $count + 1], JSON_THROW_ON_ERROR);
        rewind($handle);
        if (!ftruncate($handle, 0) || fwrite($handle, $payload) !== strlen($payload) || !fflush($handle)) {
            throw new RuntimeException('Aktivierungs-Limit konnte nicht gespeichert werden.');
        }
        return true;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
