<?php
declare(strict_types=1);

// Shared by the normal editor and the GTFS pilot. Existing route categories remain valid.
function lehrfahrer_route_category_defaults(): array {
    return ['Standard', 'Baustellen', 'Aktuelle Umleitungen', 'Schülerfahrten',
        'Ein- u. Aussetzfahrten', 'Sonderfahrten', 'SEV', 'Archiv'];
}

function lehrfahrer_route_categories_read(string $path, array $routes = []): array {
    if (is_link($path)) throw new RuntimeException('Kategorien-Datei ist ein Symlink.');
    $categories = lehrfahrer_route_category_defaults();
    if (is_file($path)) {
        $data = json_decode(strval(file_get_contents($path)), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($data) || !is_array($data['categories'] ?? null)) throw new RuntimeException('Kategorien-Datei ist beschaedigt.');
        foreach ($data['categories'] as $name) if (is_string($name) && $name !== '') $categories[] = $name;
    }
    foreach ($routes as $route) if (trim(strval($route['category'] ?? '')) !== '') $categories[] = trim(strval($route['category']));
    return array_values(array_unique($categories));
}

function lehrfahrer_route_categories_add(string $path, string $name): array {
    $name = trim(preg_replace('/\s+/u', ' ', $name));
    if ($name === '' || mb_strlen($name, 'UTF-8') > 80 || preg_match('/[\x00-\x1f<>\\\/]/u', $name)) {
        throw new InvalidArgumentException('Ungueltiger Kategoriename.');
    }
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Kategorienablage nicht anlegbar.');
    if (is_link($directory) || is_link($path)) throw new RuntimeException('Kategorienablage ist ein Symlink.');
    $lock = fopen($directory . DIRECTORY_SEPARATOR . '.route-categories.lock', 'c');
    if ($lock === false) throw new RuntimeException('Kategoriensperre nicht verfuegbar.');
    $temp = null;
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Kategoriensperre fehlgeschlagen.');
        $categories = lehrfahrer_route_categories_read($path);
        foreach ($categories as $existing) if (mb_strtolower($existing, 'UTF-8') === mb_strtolower($name, 'UTF-8')) return $categories;
        $categories[] = $name;
        $payload = json_encode(['categories' => $categories], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $temp = $directory . DIRECTORY_SEPARATOR . '.categories-' . bin2hex(random_bytes(8));
        if (file_put_contents($temp, $payload, LOCK_EX) !== strlen($payload) || !chmod($temp, 0600) || !rename($temp, $path)) {
            throw new RuntimeException('Kategorie nicht speicherbar.');
        }
        return $categories;
    } finally {
        if ($temp !== null && is_file($temp)) unlink($temp);
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
