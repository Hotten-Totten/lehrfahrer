<?php
declare(strict_types=1);

// Manual decisions live beside, never inside, the immutable candidate package.
function lehrfahrer_gtfs_route_selection_path(string $directory, string $candidateSha): string {
    if (preg_match('/^[a-f0-9]{64}$/D', $candidateSha) !== 1) {
        throw new InvalidArgumentException('Ungueltiger Kandidaten-SHA.');
    }
    if (is_link($directory)) throw new RuntimeException('Auswahlablage ist ein Symlink.');
    return $directory . DIRECTORY_SEPARATOR . $candidateSha . '.json';
}

function lehrfahrer_gtfs_route_selection_id(string $line, string $variantKey): string {
    if (preg_match('/^[a-f0-9]{64}$/D', $variantKey) !== 1) {
        throw new InvalidArgumentException('Ungueltiger Variantenschluessel.');
    }
    $line = trim(preg_replace('/\s+/u', ' ', $line));
    $line = function_exists('mb_strtolower') ? mb_strtolower($line, 'UTF-8') : strtolower($line);
    return hash('sha256', json_encode([$line, $variantKey], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
}

function lehrfahrer_gtfs_route_selection_read(string $directory, string $candidateSha): array {
    $path = lehrfahrer_gtfs_route_selection_path($directory, $candidateSha);
    if (!is_dir($directory)) return [];
    if (is_link($path)) throw new RuntimeException('Auswahldatei ist ein Symlink.');
    if (!is_file($path)) return [];
    $data = json_decode(strval(file_get_contents($path)), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data) || ($data['candidate_sha256'] ?? '') !== $candidateSha
        || !is_array($data['selected'] ?? null)) {
        throw new RuntimeException('Kandidaten-Auswahl ist beschaedigt.');
    }
    foreach ($data['selected'] as $id => $selected) {
        if (preg_match('/^[a-f0-9]{64}$/D', strval($id)) !== 1 || $selected !== true) {
            throw new RuntimeException('Kandidaten-Auswahl enthaelt ungueltige Eintraege.');
        }
    }
    return $data['selected'];
}

function lehrfahrer_gtfs_route_selection_valid(array $analysis, array $selected): array {
    $valid = [];
    foreach ($analysis['lines'] ?? [] as $line) foreach ($line['variants'] ?? [] as $variant) {
        if (($variant['candidatePresent'] ?? false) !== true) continue;
        $key = strval($variant['selectionKey'] ?? '');
        if ($key === '') continue;
        $id = lehrfahrer_gtfs_route_selection_id(strval($line['line']), $key);
        if (isset($selected[$id])) $valid[$id] = true;
    }
    return $valid;
}

function lehrfahrer_gtfs_route_selection_apply(array $analysis, array $selected): array {
    $selected = lehrfahrer_gtfs_route_selection_valid($analysis, $selected);
    foreach ($analysis['lines'] ?? [] as $lineIndex => $line) {
        $count = 0;
        foreach ($line['variants'] ?? [] as $variantIndex => $variant) {
            $key = strval($variant['selectionKey'] ?? '');
            $marked = $key !== '' && isset($selected[lehrfahrer_gtfs_route_selection_id(strval($line['line']), $key)]);
            $analysis['lines'][$lineIndex]['variants'][$variantIndex]['currentRouteSelected'] = $marked;
            if ($marked) $count++;
        }
        $analysis['lines'][$lineIndex]['selectedVariantCount'] = $count;
    }
    return $analysis;
}

function lehrfahrer_gtfs_route_selection_set(string $directory, string $candidateSha, array $analysis,
    string $line, string $variantKey, bool $selected): array {
    $valid = false;
    foreach ($analysis['lines'] ?? [] as $entry) {
        if (($entry['line'] ?? null) !== $line) continue;
        foreach ($entry['variants'] ?? [] as $variant) {
            if (($variant['selectionKey'] ?? null) === $variantKey
                && ($variant['candidatePresent'] ?? false) === true) { $valid = true; break 2; }
        }
    }
    if (!$valid) throw new InvalidArgumentException('Variante gehoert nicht zum geprueften Kandidatenvergleich.');
    $path = lehrfahrer_gtfs_route_selection_path($directory, $candidateSha);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) {
        throw new RuntimeException('Auswahlablage kann nicht angelegt werden.');
    }
    if (is_link($directory)) throw new RuntimeException('Auswahlablage ist ein Symlink.');
    $lockPath = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($lockPath)) throw new RuntimeException('Auswahlsperre ist ein Symlink.');
    $lock = fopen($lockPath, 'c');
    if ($lock === false) throw new RuntimeException('Auswahlsperre kann nicht geoeffnet werden.');
    $temp = null;
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Auswahl kann nicht gesperrt werden.');
        $values = lehrfahrer_gtfs_route_selection_valid($analysis,
            lehrfahrer_gtfs_route_selection_read($directory, $candidateSha));
        $id = lehrfahrer_gtfs_route_selection_id($line, $variantKey);
        if ($selected) $values[$id] = true;
        else unset($values[$id]);
        $payload = json_encode(['candidate_sha256' => $candidateSha, 'selected' => $values],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $temp = $directory . DIRECTORY_SEPARATOR . '.selection-' . bin2hex(random_bytes(8));
        if (file_put_contents($temp, $payload, LOCK_EX) !== strlen($payload)
            || !chmod($temp, 0600) || !rename($temp, $path)) {
            throw new RuntimeException('Kandidaten-Auswahl kann nicht gespeichert werden.');
        }
        return $values;
    } finally {
        if ($temp !== null && is_file($temp)) unlink($temp);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
