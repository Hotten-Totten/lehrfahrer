<?php

declare(strict_types=1);

const COTTBUS_DRY_RUN_COMPANY = '{COTTBUS_COMPANY_ID}';
const COTTBUS_DRY_RUN_EXCLUDED_TRAININGS = [
    'training_000001', 'training_000002', 'training_000003',
];
const COTTBUS_DRY_RUN_ALLOWED_EXTENSIONS = ['json', 'gpx', 'pdf'];

function dryRunFail(string $message): never {
    throw new RuntimeException($message);
}

function dryRunOption(array $options, string $name, ?string $default = null): string {
    $value = $options[$name] ?? $default;
    if (!is_string($value) || trim($value) === '') dryRunFail("Option --{$name} fehlt.");
    return trim($value);
}

function dryRunRoot(string $path, string $label): string {
    $resolved = realpath($path);
    if ($resolved === false || !is_dir($resolved) || is_link($path)) {
        dryRunFail("{$label} ist kein reales, symlinkfreies Verzeichnis.");
    }
    return rtrim($resolved, DIRECTORY_SEPARATOR);
}

function dryRunNormalize(string $path): string {
    return str_replace('\\', '/', $path);
}

function dryRunInside(string $root, string $path): bool {
    $root = rtrim(dryRunNormalize($root), '/');
    $path = dryRunNormalize($path);
    $caseSensitive = DIRECTORY_SEPARATOR !== '\\';
    if (!$caseSensitive) {
        $root = strtolower($root);
        $path = strtolower($path);
    }
    return $path === $root || str_starts_with($path, $root . '/');
}

function dryRunRelative(string $root, string $path): string {
    if (!dryRunInside($root, $path)) dryRunFail('Quellpfad verlaesst seine erlaubte Root-Grenze.');
    return ltrim(substr(dryRunNormalize($path), strlen(rtrim(dryRunNormalize($root), '/'))), '/');
}

function dryRunPath(string $root, string ...$segments): string {
    $path = $root;
    foreach ($segments as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..'
            || str_contains($segment, "\0") || str_contains($segment, '/')
            || str_contains($segment, '\\')) {
            dryRunFail('Traversal oder ungueltiges Quellpfadsegment erkannt.');
        }
        $path .= DIRECTORY_SEPARATOR . $segment;
    }
    if (!dryRunInside($root, $path)) dryRunFail('Zusammengesetzter Quellpfad verlaesst die Root-Grenze.');
    return $path;
}

function dryRunTarget(string $area, string ...$segments): string {
    $allowed = ['lines', 'cities', 'drivers', 'trainings', 'packages', 'documents', 'catalogs', 'settings', 'imports'];
    if (!in_array($area, $allowed, true)) dryRunFail('Unbekannter Tenant-Zielbereich.');
    foreach ($segments as $segment) {
        if (!preg_match('/^(?:[A-Za-z0-9][A-Za-z0-9._-]*|\{[A-Z_]+\}|\{[A-Z_]+\}\.\{[A-Z_]+\})$/D', $segment)) {
            dryRunFail('Ungueltiges Tenant-Zielpfadsegment.');
        }
    }
    $target = 'companies/' . COTTBUS_DRY_RUN_COMPANY . '/' . $area;
    if ($segments !== []) $target .= '/' . implode('/', $segments);
    if (!str_starts_with($target, 'companies/' . COTTBUS_DRY_RUN_COMPANY . '/')) {
        dryRunFail('Tenant-Zielpfad verlaesst die Gesellschaftsgrenze.');
    }
    return $target;
}

function dryRunFiles(string $root): array {
    if (!is_dir($root)) return [];
    if (is_link($root)) dryRunFail('Symlink als Quellverzeichnis erkannt.');
    $pending = [$root];
    $files = [];
    while ($pending !== []) {
        $directory = array_pop($pending);
        $entries = scandir($directory);
        if ($entries === false) dryRunFail('Quellverzeichnis konnte nicht gelesen werden.');
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = dryRunPath($directory, $entry);
            if (is_link($path)) dryRunFail('Symlink im Quellbestand erkannt: ' . $entry);
            if (is_dir($path)) $pending[] = $path;
            elseif (is_file($path)) $files[] = $path;
            else dryRunFail('Symlink/Junction oder unbekannter Dateityp im Quellbestand erkannt.');
        }
    }
    sort($files, SORT_STRING);
    return $files;
}

function dryRunJson(string $path): array {
    if (!is_file($path) || is_link($path)) dryRunFail('JSON-Quelldatei fehlt oder ist ein Symlink.');
    $raw = file_get_contents($path);
    if (!is_string($raw)) dryRunFail('JSON-Quelldatei konnte nicht gelesen werden.');
    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        dryRunFail('Ungueltige JSON-Quelldatei: ' . basename($path));
    }
    if (!is_array($decoded)) dryRunFail('JSON-Quelldatei besitzt keine Objekt-/Listenstruktur.');
    return $decoded;
}

function dryRunFingerprint(string $path): array {
    clearstatcache(true, $path);
    if (!is_file($path) || is_link($path)) dryRunFail('Quelldatei fehlt oder ist ein Symlink.');
    $size = filesize($path);
    $mtime = filemtime($path);
    $hash = hash_file('sha256', $path);
    if ($size === false || $mtime === false || $hash === false) dryRunFail('Quelldatei konnte nicht fingerprinted werden.');
    return ['bytes' => $size, 'mtime' => $mtime, 'sha256' => $hash];
}

function dryRunTrack(array &$tracked, string $path): array {
    $fingerprint = dryRunFingerprint($path);
    if (isset($tracked[$path]) && $tracked[$path] !== $fingerprint) {
        dryRunFail('Quelldatei hat sich waehrend des Dry-Runs geaendert: ' . basename($path));
    }
    $tracked[$path] = $fingerprint;
    return $fingerprint;
}

function dryRunVerifyTracked(array $tracked): void {
    foreach ($tracked as $path => $before) {
        if (dryRunFingerprint($path) !== $before) {
            dryRunFail('Quelldatei hat sich waehrend des Dry-Runs geaendert: ' . basename($path));
        }
    }
}

function dryRunSource(string $kind, string $relative): string {
    return $kind . '://' . str_replace('\\', '/', $relative);
}

function dryRunPrivateSource(string $relative): string {
    $parts = explode('/', str_replace('\\', '/', $relative));
    if (($parts[0] ?? '') === 'fahrerunterlagen') {
        if (isset($parts[1])) $parts[1] = '[subject]';
        if (isset($parts[2])) $parts[2] = '[package]';
    }
    return dryRunSource('private', implode('/', $parts));
}

function dryRunManifestItem(
    string $source,
    string $type,
    string $classification,
    string $decision,
    ?string $target,
    ?array $fingerprint,
    bool $referencesValid,
    bool $mappingRequired,
    array $warnings = []
): array {
    return [
        'source' => $source,
        'data_type' => $type,
        'classification' => $classification,
        'decision' => $decision,
        'target' => $target,
        'source_exists' => $fingerprint !== null,
        'bytes' => $fingerprint['bytes'] ?? null,
        'sha256' => $fingerprint['sha256'] ?? null,
        'references_valid' => $referencesValid,
        'mapping_required' => $mappingRequired,
        'warnings' => array_values($warnings),
    ];
}

function dryRunCsvRows(string $content): array {
    $stream = fopen('php://memory', 'r+');
    if ($stream === false) return [];
    fputs($stream, preg_replace('/^\xEF\xBB\xBF/', '', $content) ?? $content);
    rewind($stream);
    $headers = fgetcsv($stream);
    if (!is_array($headers)) return [];
    $rows = [];
    while (($values = fgetcsv($stream)) !== false) {
        if (count($values) !== count($headers)) continue;
        $rows[] = array_combine($headers, $values);
    }
    return $rows;
}

function dryRunGtfs(string $zipPath, string $variantsPath, array &$tracked): array {
    $result = [
        'zip_present' => is_file($zipPath) && !is_link($zipPath),
        'bytes' => null,
        'sha256' => null,
        'agency_count' => null,
        'recognized_agencies' => [],
        'routes' => null,
        'variants' => null,
        'target' => dryRunTarget('imports', 'gtfs', 'latest.zip'),
        'decision' => 'MANUAL',
        'variants_action' => 'REBUILD',
        'message' => 'Index wird im echten Migrationslauf neu erzeugt.',
        'warnings' => [],
    ];
    if (!$result['zip_present']) {
        $result['warnings'][] = 'GTFS-ZIP fehlt.';
        return $result;
    }
    $fingerprint = dryRunTrack($tracked, $zipPath);
    $result['bytes'] = $fingerprint['bytes'];
    $result['sha256'] = $fingerprint['sha256'];
    if (class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) === true) {
            $agency = $zip->getFromName('agency.txt');
            if (is_string($agency)) {
                $allAgencies = [];
                foreach (dryRunCsvRows($agency) as $row) {
                    $name = trim((string)($row['agency_name'] ?? ''));
                    if ($name !== '') $allAgencies[$name] = true;
                }
                $result['agency_count'] = count($allAgencies);
                $result['recognized_agencies'] = array_values(array_filter(
                    array_keys($allAgencies),
                    static fn(string $name): bool => stripos($name, 'cottbus') !== false
                ));
                sort($result['recognized_agencies'], SORT_STRING);
            }
            $routes = $zip->getFromName('routes.txt');
            if (is_string($routes)) {
                $ids = [];
                foreach (dryRunCsvRows($routes) as $row) {
                    $id = trim((string)($row['route_id'] ?? ''));
                    if ($id !== '') $ids[$id] = true;
                }
                $result['routes'] = count($ids);
            }
            $zip->close();
        } else {
            $result['warnings'][] = 'GTFS-ZIP konnte nicht strukturell geoeffnet werden.';
        }
    } else {
        $result['warnings'][] = 'ZipArchive fehlt; Agency und Routenzahl nicht lesbar.';
    }
    if (is_file($variantsPath) && !is_link($variantsPath)) {
        dryRunTrack($tracked, $variantsPath);
        if (class_exists('SQLite3')) {
            try {
                $database = new SQLite3($variantsPath, SQLITE3_OPEN_READONLY);
                $count = $database->querySingle('SELECT COUNT(*) FROM variants');
                if (is_int($count) || is_float($count) || is_string($count)) $result['variants'] = (int)$count;
                $database->close();
            } catch (Throwable $error) {
                $result['warnings'][] = 'Variantenindex konnte nicht read-only ausgewertet werden.';
            }
        } else {
            $result['warnings'][] = 'SQLite3-Reader fehlt; Variantenanzahl nicht lesbar.';
        }
    } else {
        $result['warnings'][] = 'variants.sqlite fehlt; der Zielindex bleibt dennoch REBUILD.';
    }
    return $result;
}

function dryRunCatalogIds(string $path, array &$tracked): array {
    if (!is_file($path) || is_link($path)) return [];
    dryRunTrack($tracked, $path);
    $raw = file_get_contents($path);
    if (!is_string($raw)) return [];
    preg_match_all('/["\']id["\']\s*:\s*["\']([^"\']+)["\']/', $raw, $matches);
    return array_fill_keys(array_values(array_unique($matches[1] ?? [])), true);
}

function dryRunPackageDirectory(string $privateRoot): ?string {
    $root = dryRunPath($privateRoot, 'fahrerunterlagen');
    if (!is_dir($root)) return null;
    $manifests = [];
    foreach (dryRunFiles($root) as $path) {
        if (basename($path) === 'paket.json') $manifests[] = dirname($path);
    }
    if (count($manifests) > 1) dryRunFail('Mehr als ein Legacy-Paket gefunden; keine stillschweigende Auswahl.');
    return $manifests[0] ?? null;
}

function dryRunRouteKey(array $route): string {
    return implode('/', [
        (string)($route['city'] ?? ''),
        (string)($route['lineFolder'] ?? ''),
        (string)($route['categoryFolder'] ?? ''),
        (string)($route['fileBase'] ?? ''),
    ]);
}

function dryRunMain(array $options): array {
    $publicRoot = dryRunRoot(dryRunOption($options, 'public-root'), 'Public-Root');
    $privateRoot = dryRunRoot(dryRunOption($options, 'private-root'), 'Private-Root');
    if (dryRunInside($publicRoot, $privateRoot) || dryRunInside($privateRoot, $publicRoot)) {
        dryRunFail('Public-Root und Private-Root duerfen nicht ineinander liegen.');
    }
    $expectedRoutes = (int)($options['expected-route-count'] ?? 4);
    if ($expectedRoutes !== 4) dryRunFail('Der Cottbus-Dry-Run erwartet explizit vier Produktivrouten.');
    $tracked = [];
    $errors = [];
    $warnings = [];
    $manifest = [];

    $excludedAreas = [
        'linien/proberouten', 'linien/test', 'backup_liniendaten', 'WorkingSystem',
        'browser-autosaves', 'tools/output', 'master-template-nonneutral',
    ];

    $allowedPrivateAreas = ['fahrerunterlagen', 'personnel', 'trainings'];
    foreach (scandir($privateRoot) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = dryRunPath($privateRoot, $entry);
        if (is_link($path)) dryRunFail('Symlink im privaten Quellbestand erkannt.');
        if (!is_dir($path) || !in_array($entry, $allowedPrivateAreas, true)) {
            $errors[] = 'Unbekannter privater Produktivbereich darf nicht stillschweigend aufgenommen werden: ' . $entry;
        }
    }

    $routeRoot = dryRunPath($publicRoot, 'linien', 'cottbus');
    if (!is_dir($routeRoot)) dryRunFail('Freigegebener Cottbus-Routenbereich fehlt.');
    $routeFiles = dryRunFiles($routeRoot);
    $jsonFiles = [];
    foreach ($routeFiles as $path) {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (!in_array($extension, COTTBUS_DRY_RUN_ALLOWED_EXTENSIONS, true)) {
            $errors[] = 'Unbekannte Datei im produktiven Cottbus-Routenbereich: ' . dryRunRelative($routeRoot, $path);
        }
        if ($extension === 'json') $jsonFiles[] = $path;
    }
    if (count($jsonFiles) !== $expectedRoutes) {
        $errors[] = 'Erwartet werden vier eindeutige Cottbus-Routen, gefunden: ' . count($jsonFiles) . '.';
    }

    $routes = [];
    $routeKeys = [];
    $lineFolders = [];
    $catalogReferences = [];
    foreach ($jsonFiles as $jsonPath) {
        $relative = dryRunRelative($routeRoot, $jsonPath);
        $parts = explode('/', $relative);
        if (count($parts) !== 3) {
            $errors[] = 'Cottbus-Route besitzt keine eindeutige Linie/Kategorie/Datei-Struktur: ' . $relative;
            continue;
        }
        [$lineFolder, $categoryFolder, $fileName] = $parts;
        $fileBase = pathinfo($fileName, PATHINFO_FILENAME);
        dryRunTrack($tracked, $jsonPath);
        $data = dryRunJson($jsonPath);
        $key = 'cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase;
        if (isset($routeKeys[$key])) $errors[] = 'Doppelte produktive Route: ' . $key;
        $routeKeys[$key] = true;
        $lineFolders[$lineFolder] = true;
        $routeWarnings = [];
        $coreMetadataValid = ($data['city'] ?? null) === 'cottbus'
            && ($data['lineFolder'] ?? null) === $lineFolder
            && ($data['categoryFolder'] ?? null) === $categoryFolder;
        if (!$coreMetadataValid) {
            $routeWarnings[] = 'Stadt, Linie oder Kategorie widerspricht dem eindeutigen Quellpfad.';
            $errors[] = 'Metadatenkonflikt bei produktiver Route: ' . $key;
        }
        $fileBaseMapping = ($data['fileBase'] ?? null) !== $fileBase;
        if ($fileBaseMapping) {
            $routeWarnings[] = 'Legacy-fileBase weicht vom eindeutigen Dateipfad ab; Pfad-Mapping erforderlich.';
        }
        if ($fileBase === 'drivers' || str_contains(strtolower($relative), '/test/')) {
            $errors[] = 'Legacy-/Testreferenz im produktiven Cottbus-Bereich: ' . $key;
        }
        $siblings = [];
        foreach (COTTBUS_DRY_RUN_ALLOWED_EXTENSIONS as $extension) {
            $candidate = dirname($jsonPath) . DIRECTORY_SEPARATOR . $fileBase . '.' . $extension;
            $siblings[$extension] = is_file($candidate) && !is_link($candidate);
            if (!$siblings[$extension]) {
                $errors[] = strtoupper($extension) . '-Quelldatei fehlt fuer produktive Route: ' . $key;
            } else {
                $fp = dryRunTrack($tracked, $candidate);
                $manifest[] = dryRunManifestItem(
                    dryRunSource('public', 'linien/cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . basename($candidate)),
                    'route-' . $extension,
                    'A',
                    'INCLUDE',
                    dryRunTarget('lines', 'cottbus', $lineFolder, $categoryFolder, basename($candidate)),
                    $fp,
                    $coreMetadataValid,
                    $fileBaseMapping,
                    $routeWarnings
                );
            }
        }
        foreach (($data['stops'] ?? []) as $stop) {
            if (!is_array($stop)) continue;
            $catalogId = trim((string)($stop['catalogId'] ?? ''));
            if ($catalogId !== '') $catalogReferences[] = ['route' => $key, 'id' => $catalogId];
        }
        $routes[] = [
            'source' => dryRunSource('public', 'linien/cottbus/' . $relative),
            'target' => dryRunTarget('lines', 'cottbus', $lineFolder, $categoryFolder, $fileBase . '.json'),
            'city' => 'cottbus',
            'line_folder' => $lineFolder,
            'category_folder' => $categoryFolder,
            'file_base' => $fileBase,
            'json' => $siblings['json'],
            'gpx' => $siblings['gpx'],
            'pdf' => $siblings['pdf'],
            'status' => $coreMetadataValid && !in_array(false, $siblings, true) ? 'INCLUDE' : 'BLOCKED',
            'warnings' => $routeWarnings,
        ];
    }

    $driversPath = dryRunPath($privateRoot, 'personnel', 'drivers.json');
    $driverFp = dryRunTrack($tracked, $driversPath);
    $drivers = dryRunJson($driversPath);
    $personnelFiles = dryRunFiles(dryRunPath($privateRoot, 'personnel'));
    if ($personnelFiles !== [$driversPath]) {
        $errors[] = 'Unbekannte Datei im produktiven Fahrerbereich.';
    }
    $activeDrivers = array_values(array_filter($drivers, static fn($driver): bool => is_array($driver) && ($driver['active'] ?? false) === true));
    $driverIds = array_map(static fn($driver): string => (string)($driver['id'] ?? ''), $activeDrivers);
    if (count($activeDrivers) !== 1) $errors[] = 'Erwartet wird genau ein aktiver Fahrer.';
    if (count($driverIds) !== count(array_unique($driverIds))) $errors[] = 'Fahrer-ID ist doppelt.';
    $driverId = $driverIds[0] ?? '';
    $driverCanonical = preg_match('/^drv_[0-9a-f]{32}$/D', $driverId) === 1;
    if (!$driverCanonical) $errors[] = 'Freigegebene Fahrer-ID ist nicht kanonisch.';
    $driverMapping = [
        'source_id' => $driverCanonical ? $driverId : null,
        'target_id' => $driverCanonical ? $driverId : null,
        'action' => $driverCanonical ? 'KEEP-ID' : 'BLOCKED',
    ];
    $manifest[] = dryRunManifestItem(
        dryRunSource('private', 'personnel/drivers.json'), 'drivers', 'A',
        $driverCanonical ? 'INCLUDE' : 'MANUAL', dryRunTarget('drivers', 'drivers.json'),
        $driverFp, $driverCanonical, false, $driverCanonical ? [] : ['Fahrer-ID ist nicht kanonisch.']
    );

    $trainingRoot = dryRunPath($privateRoot, 'trainings');
    $trainingRows = [];
    $seenTrainingIds = [];
    foreach (dryRunFiles($trainingRoot) as $path) {
        if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'json') {
            $errors[] = 'Unbekannte Datei im Trainingsbereich: ' . basename($path);
            continue;
        }
        $fp = dryRunTrack($tracked, $path);
        $data = dryRunJson($path);
        $id = (string)($data['trainingId'] ?? '');
        if (isset($seenTrainingIds[$id])) $errors[] = 'Doppelte Training-ID: ' . $id;
        $seenTrainingIds[$id] = true;
        $excluded = in_array($id, COTTBUS_DRY_RUN_EXCLUDED_TRAININGS, true);
        if ($id === 'training_000004') {
            $valid = preg_match('/^training_[0-9]{6}$/D', $id) === 1
                && ($data['driverId'] ?? null) === $driverId
                && count($data['routes'] ?? []) === 2;
            foreach (($data['routes'] ?? []) as $route) {
                if (!is_array($route) || !isset($routeKeys[dryRunRouteKey($route)])) $valid = false;
            }
            if (!$valid) $errors[] = 'training_000004 besitzt ungueltige produktive Referenzen.';
            $trainingRows[] = ['id' => $id, 'status' => $valid ? 'INCLUDE' : 'BLOCKED', 'migratable' => $valid, 'reason' => $valid ? 'Fahrer und zwei Cottbus-Routen sind gueltig.' : 'Produktive Referenzpruefung fehlgeschlagen.'];
            $manifest[] = dryRunManifestItem(
                dryRunSource('private', 'trainings/' . basename($path)), 'training', 'A',
                $valid ? 'INCLUDE' : 'MANUAL', dryRunTarget('trainings', basename($path)),
                $fp, $valid, false, $valid ? [] : ['Produktive Referenzpruefung fehlgeschlagen.']
            );
        } elseif ($excluded) {
            $trainingRows[] = ['id' => $id, 'status' => 'EXCLUDE', 'migratable' => false, 'reason' => 'Explizit ausgeschlossener Test-/Legacybestand.'];
            $manifest[] = dryRunManifestItem(
                dryRunSource('private', 'trainings/' . basename($path)), 'training', 'C', 'EXCLUDE', null,
                $fp, false, false, ['Test-/Legacytraining ist fest ausgeschlossen.']
            );
        } else {
            $errors[] = 'Unbekanntes Training darf nicht stillschweigend aufgenommen werden: ' . $id;
            $trainingRows[] = ['id' => $id, 'status' => 'MANUAL', 'migratable' => false, 'reason' => 'Unbekannter Bestand.'];
        }
    }
    foreach (array_merge(COTTBUS_DRY_RUN_EXCLUDED_TRAININGS, ['training_000004']) as $expected) {
        if (!isset($seenTrainingIds[$expected])) $errors[] = 'Erwartete Trainingsquelle fehlt: ' . $expected;
    }

    $package = ['status' => 'ABSENT', 'driver_assignment' => 'MANUELL BESTAETIGEN', 'positions' => [], 'zip' => null];
    $packageDirectory = dryRunPackageDirectory($privateRoot);
    if ($packageDirectory === null) {
        $errors[] = 'Erwartetes Legacy-Paket fehlt.';
    } else {
        $packagePath = dryRunPath($packageDirectory, 'paket.json');
        $packageFp = dryRunTrack($tracked, $packagePath);
        $packageData = dryRunJson($packagePath);
        $packageId = (string)($packageData['id'] ?? '');
        if (preg_match('/^pkg_[0-9a-f]{32}$/D', $packageId) !== 1) $errors[] = 'Legacy-Paket-ID ist nicht kanonisch.';
        $documents = is_array($packageData['documents'] ?? null) ? $packageData['documents'] : [];
        $selected = is_array($packageData['selectedItems'] ?? null) ? $packageData['selectedItems'] : [];
        if (count($documents) !== 5 || count($selected) !== 5) $errors[] = 'Legacy-Paket besitzt nicht exakt fuenf erwartete Positionen.';
        $package['status'] = 'MANUAL';
        $package['id'] = $packageId;
        $package['driver_id_empty'] = trim((string)($packageData['driverId'] ?? '')) === '';
        $package['driver_assignment'] = 'MANUELL BESTAETIGEN';
        $manifest[] = dryRunManifestItem(
            dryRunPrivateSource(dryRunRelative($privateRoot, $packagePath)), 'package-manifest', 'E', 'MANUAL',
            dryRunTarget('packages', $packageId, 'paket.json'), $packageFp, false, true,
            ['Paket ist gemischt und darf nicht unveraendert migriert werden.', 'Fahrer-ID ist leer.']
        );
        $documentBasenames = array_map(
            static fn($document): string => basename(str_replace('\\', '/', (string)($document['path'] ?? ''))),
            $documents
        );
        if (count($documentBasenames) !== count(array_unique($documentBasenames))) {
            $errors[] = 'Paketdokumente wuerden auf denselben Tenant-Zielnamen kollidieren.';
        }
        $limit = max(count($documents), count($selected));
        for ($index = 0; $index < $limit; $index++) {
            $document = is_array($documents[$index] ?? null) ? $documents[$index] : [];
            $item = is_array($selected[$index] ?? null) ? $selected[$index] : [];
            $itemKey = dryRunRouteKey($item);
            $basename = basename(str_replace('\\', '/', (string)($document['path'] ?? '')));
            $documentPath = $basename !== '' ? dryRunPath($packageDirectory, $basename) : '';
            $fp = $documentPath !== '' && is_file($documentPath) && !is_link($documentPath)
                ? dryRunTrack($tracked, $documentPath) : null;
            $isCottbus = ($item['city'] ?? null) === 'cottbus' && isset($routeKeys[$itemKey]);
            $isTest = ($item['city'] ?? null) === 'test' && ($item['fileBase'] ?? null) !== 'drivers';
            $isDrivers = ($item['fileBase'] ?? null) === 'drivers';
            $metadataComplete = trim((string)($document['lineName'] ?? '')) !== ''
                && trim((string)($document['routeName'] ?? '')) !== '';
            if ($isCottbus && $metadataComplete && $fp !== null) {
                $decision = 'INCLUDE'; $classification = 'B';
                $reason = 'Cottbus-Dokument ist vorhanden; Paket-/Fahrer-Mapping bleibt erforderlich.';
                $target = dryRunTarget('documents', $packageId, $basename);
            } elseif ($isTest) {
                $decision = 'EXCLUDE'; $classification = 'C';
                $reason = 'Test-Paketposition ist fest ausgeschlossen.'; $target = null;
            } else {
                $decision = 'MANUAL'; $classification = 'E';
                $reason = 'Dokument besitzt keine belastbare fachliche Zuordnung.'; $target = null;
            }
            if ($fp === null) {
                $errors[] = 'Im Paketmanifest referenziertes Dokument fehlt an Position ' . ($index + 1) . '.';
                $decision = 'MANUAL'; $classification = 'E'; $target = null;
            }
            $package['positions'][] = [
                'position' => $index + 1,
                'status' => $decision,
                'reason' => $reason,
                'target' => $target,
                'references' => [
                    'driver' => 'MANUAL',
                    'route' => $isCottbus ? 'OK' : ($isDrivers ? 'EXCLUDE' : ($isTest ? 'TEST' : 'UNCLEAR')),
                    'training' => 'NOT-MODELED',
                    'document' => $fp !== null ? 'OK' : 'MISSING',
                ],
            ];
            if ($fp !== null) {
                $manifest[] = dryRunManifestItem(
                    dryRunPrivateSource(dryRunRelative($privateRoot, $documentPath)), 'package-document',
                    $classification, $decision, $target, $fp, $isCottbus && $metadataComplete,
                    $decision !== 'EXCLUDE', [$reason]
                );
            }
            if ($isDrivers) {
                $package['drivers_reference'] = ['status' => 'EXCLUDE', 'reason' => 'fileBase=drivers ist eine Legacy-Fehlreferenz.'];
            }
        }
        $zips = array_values(array_filter(dryRunFiles($packageDirectory), static fn($path): bool => strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'zip'));
        if (count($zips) !== 1) $errors[] = 'Erwartet wird genau ein Legacy-Paket-ZIP.';
        if (isset($zips[0])) {
            $zipFp = dryRunTrack($tracked, $zips[0]);
            $package['zip'] = ['status' => 'EXCLUDE', 'reason' => 'Gemischtes Legacy-Paket wird nicht unveraendert uebernommen.'];
            $manifest[] = dryRunManifestItem(
                dryRunPrivateSource(dryRunRelative($privateRoot, $zips[0])), 'package-zip', 'D', 'EXCLUDE', null,
                $zipFp, false, false, ['Gemischtes Legacy-Paket-ZIP ist fest ausgeschlossen.']
            );
        }
    }

    $settingsPath = dryRunPath($publicRoot, 'data', 'city_settings.json');
    $settings = ['status' => 'ABSENT', 'count' => 0, 'target' => dryRunTarget('settings', 'city_settings.json')];
    if (is_file($settingsPath) && !is_link($settingsPath)) {
        $settingsFp = dryRunTrack($tracked, $settingsPath);
        $settingsData = dryRunJson($settingsPath);
        if (isset($settingsData['cottbus']) && is_array($settingsData['cottbus'])) {
            $settings = ['status' => 'INCLUDE', 'count' => 1, 'target' => dryRunTarget('settings', 'city_settings.json')];
            $manifest[] = dryRunManifestItem(
                dryRunSource('public', 'data/city_settings.json#cottbus'), 'settings', 'A', 'INCLUDE',
                dryRunTarget('settings', 'city_settings.json'), $settingsFp, true, true,
                ['Nur der Cottbus-Eintrag darf extrahiert werden.']
            );
        }
    }

    $catalogPath = isset($options['catalog-file'])
        ? dryRunOption($options, 'catalog-file') : dryRunPath($publicRoot, 'data', 'haltestellen.js');
    $catalogIds = dryRunCatalogIds($catalogPath, $tracked);
    $validCatalog = 0;
    $invalidByRoute = [];
    foreach ($catalogReferences as $reference) {
        if (isset($catalogIds[$reference['id']])) $validCatalog++;
        else {
            $invalidByRoute[$reference['route']][] = substr(hash('sha256', $reference['id']), 0, 12);
        }
    }
    ksort($invalidByRoute, SORT_STRING);
    foreach ($invalidByRoute as &$ids) sort($ids, SORT_STRING);
    unset($ids);
    $invalidCatalog = count($catalogReferences) - $validCatalog;
    $catalog = [
        'status' => 'BLOCKED',
        'references' => count($catalogReferences),
        'valid' => $validCatalog,
        'invalid' => $invalidCatalog,
        'affected_routes' => $invalidByRoute,
        'recommendation' => 'Katalog neu erzeugen, Referenzen remappen und fachlich pruefen.',
    ];

    $gtfsPath = isset($options['gtfs-zip']) ? dryRunOption($options, 'gtfs-zip') : dryRunPath($publicRoot, 'gtfs', 'latest.zip');
    $variantsPath = isset($options['variants-sqlite']) ? dryRunOption($options, 'variants-sqlite') : dryRunPath($publicRoot, 'gtfs', 'variants.sqlite');
    $gtfs = dryRunGtfs($gtfsPath, $variantsPath, $tracked);
    if (!$gtfs['zip_present']) $errors[] = 'GTFS-ZIP fuer die freigegebene Analyse fehlt.';
    if ($gtfs['zip_present']) {
        $manifest[] = dryRunManifestItem(
            dryRunSource('public', dryRunRelative($publicRoot, $gtfsPath)), 'gtfs-zip', 'B', 'MANUAL',
            $gtfs['target'], ['bytes' => $gtfs['bytes'], 'sha256' => $gtfs['sha256']], true, true,
            ['GTFS-Freigabe erforderlich; kein Multipart-Transfer im Dry-Run.']
        );
    }

    usort($routes, static fn($a, $b): int => strcmp($a['source'], $b['source']));
    usort($trainingRows, static fn($a, $b): int => strcmp($a['id'], $b['id']));
    usort($manifest, static fn($a, $b): int => [$a['source'], $a['data_type']] <=> [$b['source'], $b['data_type']]);
    sort($errors, SORT_STRING);
    $errors = array_values(array_unique($errors));
    sort($warnings, SORT_STRING);

    dryRunVerifyTracked($tracked);

    $includedDocuments = count(array_filter($package['positions'], static fn($position): bool => $position['status'] === 'INCLUDE'));
    $manualDocuments = count(array_filter($package['positions'], static fn($position): bool => $position['status'] === 'MANUAL'));
    return [
        'tool' => 'cottbus-migration-dry-run',
        'mode' => 'READ_ONLY',
        'company_id' => COTTBUS_DRY_RUN_COMPANY,
        'migration_ready' => false,
        'status' => $errors === [] ? 'MANUAL_REQUIRED' : 'BLOCKED',
        'errors' => $errors,
        'warnings' => $warnings,
        'source_policy' => [
            'approved' => ['linien/cottbus', 'one-active-driver', 'training_000004', 'cottbus-package-positions', 'cottbus-settings', 'catalog-analysis', 'gtfs-analysis'],
            'excluded' => $excludedAreas,
        ],
        'mappings' => [
            'driver' => $driverMapping,
            'training' => ['training_000004' => dryRunTarget('trainings', 'training_000004.json')],
            'route_pattern' => dryRunTarget('lines', 'cottbus', '{LINE_FOLDER}', '{CATEGORY_FOLDER}', '{FILE_BASE}.{EXT}'),
            'package_pattern' => dryRunTarget('packages', '{PACKAGE_ID}', 'paket.json'),
            'document_pattern' => dryRunTarget('documents', '{PACKAGE_ID}', '{DOCUMENT_FILE}'),
            'status' => ['created' => 'created', 'running' => 'running', 'archived' => 'archived', 'Erstellt' => 'created'],
        ],
        'routes' => $routes,
        'drivers' => ['count' => count($activeDrivers), 'mapping' => $driverMapping],
        'trainings' => $trainingRows,
        'package' => $package,
        'settings' => $settings,
        'catalog' => $catalog,
        'gtfs' => $gtfs,
        'target_manifest' => $manifest,
        'summary' => [
            'would_migrate' => [
                'cities' => count($routes) > 0 ? 1 : 0,
                'lines' => count($lineFolders),
                'routes' => count(array_filter($routes, static fn($route): bool => $route['status'] === 'INCLUDE')),
                'drivers' => $driverCanonical ? 1 : 0,
                'trainings' => count(array_filter($trainingRows, static fn($training): bool => $training['status'] === 'INCLUDE')),
                'package_positions' => $includedDocuments,
                'documents' => $includedDocuments,
                'settings' => $settings['count'],
                'gtfs' => 'MANUAL',
            ],
            'would_exclude' => [
                'test_trainings' => count(array_filter($trainingRows, static fn($training): bool => $training['status'] === 'EXCLUDE')),
                'test_package_positions' => count(array_filter($package['positions'], static fn($position): bool => $position['status'] === 'EXCLUDE')),
                'legacy_package_zip' => $package['zip'] !== null ? 1 : 0,
                'drivers_reference' => isset($package['drivers_reference']) ? 1 : 0,
                'fixed_areas' => count($excludedAreas),
                'variants_sqlite_copy' => 1,
            ],
            'manual_required' => [
                'package_driver_assignment' => true,
                'package_documents' => $manualDocuments,
                'catalog_references' => $catalog['status'] === 'BLOCKED',
                'gtfs_approval' => true,
            ],
        ],
        'read_only_evidence' => [
            'tracked_source_files' => count($tracked),
            'all_fingerprints_unchanged' => true,
            'database_writes' => 0,
            'variants_sqlite_open_mode' => class_exists('SQLite3') && is_file($variantsPath) ? 'READONLY' : 'NOT_OPENED',
            'writes_performed' => 0,
        ],
    ];
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$options = getopt('', [
    'public-root:', 'private-root:', 'staging-root::', 'catalog-file::',
    'gtfs-zip::', 'variants-sqlite::', 'expected-route-count::', 'compact',
]);

try {
    $report = dryRunMain($options);
    echo json_encode(
        $report,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            | (isset($options['compact']) ? 0 : JSON_PRETTY_PRINT)
            | JSON_THROW_ON_ERROR
    ) . PHP_EOL;
    exit($report['errors'] === [] ? 0 : 2);
} catch (Throwable $error) {
    echo json_encode([
        'tool' => 'cottbus-migration-dry-run',
        'mode' => 'READ_ONLY',
        'company_id' => COTTBUS_DRY_RUN_COMPANY,
        'migration_ready' => false,
        'status' => 'ERROR',
        'errors' => [$error->getMessage()],
        'read_only_evidence' => ['writes_performed' => 0, 'database_writes' => 0],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;
    exit(2);
}
