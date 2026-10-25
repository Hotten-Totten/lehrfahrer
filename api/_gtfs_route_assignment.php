<?php
declare(strict_types=1);

require_once __DIR__ . '/_gtfs_route_selection.php';

function lehrfahrer_gtfs_assignment_file(string $directory, string $sha): string {
    lehrfahrer_gtfs_route_selection_path($directory, $sha);
    if (is_link($directory)) throw new RuntimeException('Zuordnungsablage ist ein Symlink.');
    return $directory . DIRECTORY_SEPARATOR . $sha . '.json';
}

function lehrfahrer_gtfs_assignment_read(string $directory, string $sha): array {
    $path = lehrfahrer_gtfs_assignment_file($directory, $sha);
    if (!is_file($path)) return [];
    if (is_link($path)) throw new RuntimeException('Zuordnungsdatei ist ein Symlink.');
    $data = json_decode(strval(file_get_contents($path)), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data) || ($data['candidate_sha256'] ?? null) !== $sha || !is_array($data['assignments'] ?? null)) {
        throw new RuntimeException('Kandidaten-Zuordnungen sind beschaedigt.');
    }
    return $data['assignments'];
}

function lehrfahrer_gtfs_assignment_set(string $directory, string $sha, string $id, array $assignment): array {
    if (preg_match('/^[a-f0-9]{64}$/D', $id) !== 1) throw new InvalidArgumentException('Ungueltige Variantenkennung.');
    $path = lehrfahrer_gtfs_assignment_file($directory, $sha);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Zuordnungsablage nicht anlegbar.');
    if (is_link($directory)) throw new RuntimeException('Zuordnungsablage ist ein Symlink.');
    $lockPath = $directory . DIRECTORY_SEPARATOR . '.lock';
    if (is_link($lockPath)) throw new RuntimeException('Zuordnungssperre ist ein Symlink.');
    $lock = fopen($lockPath, 'c');
    if ($lock === false) throw new RuntimeException('Zuordnungssperre nicht verfuegbar.');
    $temp = null;
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Zuordnungssperre fehlgeschlagen.');
        $all = lehrfahrer_gtfs_assignment_read($directory, $sha);
        $all[$id] = $assignment;
        $payload = json_encode(['candidate_sha256' => $sha, 'assignments' => $all], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $temp = $directory . DIRECTORY_SEPARATOR . '.assignment-' . bin2hex(random_bytes(8));
        if (file_put_contents($temp, $payload, LOCK_EX) !== strlen($payload) || !chmod($temp, 0600) || !rename($temp, $path)) {
            throw new RuntimeException('Zuordnung nicht speicherbar.');
        }
        return $all;
    } finally {
        if ($temp !== null && is_file($temp)) unlink($temp);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function lehrfahrer_gtfs_assignment_validate(array $assignment, array $routes, array $categories): array {
    $action = strval($assignment['action'] ?? 'new');
    $number = trim(strval($assignment['routeNumber'] ?? ''));
    $target = strval($assignment['targetRoute'] ?? '');
    $category = trim(strval($assignment['category'] ?? ''));
    if (!in_array($action, ['new', 'replace'], true)) throw new InvalidArgumentException('Ungueltige Routenaktion.');
    if ($number !== '' && preg_match('/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,31}$/uD', $number) !== 1) {
        throw new InvalidArgumentException('Ungueltige Routennummer.');
    }
    if ($category !== '' && !in_array($category, $categories, true)) throw new InvalidArgumentException('Kategorie nicht vorhanden.');
    $duplicate = false; $targetValid = false;
    foreach ($routes as $route) {
        if ($number !== '' && strcasecmp(strval($route['routeNumber'] ?? ''), $number) === 0) $duplicate = true;
        if ($target !== '' && hash_equals(strval($route['id']), $target)) $targetValid = true;
    }
    if ($action === 'replace' && $target !== '' && !$targetValid) throw new InvalidArgumentException('Zielroute gehoert nicht zu dieser Linie.');
    return ['action' => $action, 'routeNumber' => $number, 'targetRoute' => $action === 'replace' ? $target : '',
        'category' => $category, 'duplicate' => $action === 'new' && $duplicate,
        'ready' => $category !== '' && ($action === 'new' ? $number !== '' && !$duplicate : $targetValid)];
}
