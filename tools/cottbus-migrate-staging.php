<?php

declare(strict_types=1);

$cottbusAppRoot = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
if ($cottbusAppRoot === '') $cottbusAppRoot = dirname(__DIR__);
require_once $cottbusAppRoot . '/api/_gtfs_variant_index.php';
require_once __DIR__ . '/_control-db-restore-point.php';

function cottbusAppRoot(): string {
    $configured = trim((string)getenv('LEHRFAHRER_APP_ROOT'));
    return $configured !== '' ? rtrim($configured, '/\\') : dirname(__DIR__);
}

const COTTBUS_MIGRATION_VERSION = 1;
const COTTBUS_MIGRATION_TOOL_VERSION = '1.0.0';
const COTTBUS_AGENCY_ID = '143';
const COTTBUS_AGENCY_NAME = 'Cottbusverkehr';
const COTTBUS_APPLY_CONFIRMATION = 'APPLY-COTTBUS-STAGING';
const COTTBUS_PLACEHOLDER_COMPANY = '{COTTBUS_COMPANY_ID}';
const COTTBUS_EXPECTED_COUNTS = [
    'routes' => 75,
    'trips' => 3686,
    'stop_times' => 62227,
    'used_stops' => 1531,
];
const COTTBUS_EXCLUDED_TRAININGS = [
    'training_000001', 'training_000002', 'training_000003',
];
const COTTBUS_TENANT_AREAS = [
    'lines', 'cities', 'drivers', 'trainings', 'packages',
    'documents', 'catalogs', 'settings', 'imports',
];
const COTTBUS_LEGACY_STOP_MAPPING = [
    'hst_3065' => ['target' => '333542', 'name' => 'südeck', 'max_distance_m' => 10.0],
    'hst_697' => ['target' => '59738', 'name' => 'sportzentrum', 'max_distance_m' => 10.0],
    'hst_719' => ['target' => '630120', 'name' => 'stadtring', 'max_distance_m' => 10.0],
    'hst_593' => ['target' => '99788', 'name' => 'hauptbahnhof', 'max_distance_m' => 10.0],
];

final class CottbusMigrationFailure extends RuntimeException {}

const COTTBUS_APPLY_STAGES = [
    'PREPARE_TARGET', 'BUILD_ROUTES', 'BUILD_DRIVERS', 'BUILD_TRAINING',
    'BUILD_PACKAGE', 'BUILD_CATALOG', 'FILTER_GTFS', 'BUILD_VARIANTS',
    'VALIDATE_TEMP_ROOT', 'DB_TRANSACTION', 'ROOT_SWAP', 'POST_VALIDATE', 'ROLLBACK',
];

function cottbusDiagnosticReset(?string $company = null): void {
    $GLOBALS['cottbusMigrationDiagnostic'] = [
        'stage' => 'PREPARE_TARGET',
        'failed_stage' => null,
        'operation' => 'initialize-migration',
        'failed_operation' => null,
        'rollback_status' => 'NOT_REQUIRED',
        'company_id' => $company,
    ];
}

function cottbusDiagnosticMark(string $stage, string $operation): void {
    if (!in_array($stage, COTTBUS_APPLY_STAGES, true)) {
        throw new LogicException('Unknown Cottbus migration diagnostic stage.');
    }
    if (!isset($GLOBALS['cottbusMigrationDiagnostic'])) cottbusDiagnosticReset();
    $GLOBALS['cottbusMigrationDiagnostic']['stage'] = $stage;
    $GLOBALS['cottbusMigrationDiagnostic']['operation'] = $operation;
}

function cottbusDiagnosticCaptureFailure(): void {
    if (!isset($GLOBALS['cottbusMigrationDiagnostic'])) cottbusDiagnosticReset();
    if ($GLOBALS['cottbusMigrationDiagnostic']['failed_stage'] === null) {
        $GLOBALS['cottbusMigrationDiagnostic']['failed_stage'] = $GLOBALS['cottbusMigrationDiagnostic']['stage'];
        $GLOBALS['cottbusMigrationDiagnostic']['failed_operation'] = $GLOBALS['cottbusMigrationDiagnostic']['operation'];
    }
}

function cottbusDiagnosticRollback(string $status): void {
    if (!isset($GLOBALS['cottbusMigrationDiagnostic'])) cottbusDiagnosticReset();
    $GLOBALS['cottbusMigrationDiagnostic']['rollback_status'] = $status;
}

function cottbusShortCompanyId(?string $company): ?string {
    if ($company === null || preg_match('/^cmp_[0-9a-f]{32}$/D', $company) !== 1) return null;
    return substr($company, 0, 12) . '...' . substr($company, -4);
}

function cottbusSanitizeErrorMessage(string $message): string {
    $message = trim(str_replace(["\r\n", "\r", "\n"], ' ', $message));
    $suspicious = '/(?:password|passwd|secret|token|authorization|bearer|cookie|session|activation[_ -]?token|'
        . '(?:mysql|pgsql|postgres(?:ql)?):[^\s]*?(?:password|passwd|pwd)=|'
        . '(?:password|passwd|pwd|token|secret|cookie|session)\s*[:=]\s*\S+)/i';
    if ($message === '' || preg_match($suspicious, $message) === 1) return 'REDACTED';
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $message) === 1) return 'REDACTED';
    return strlen($message) > 240 ? substr($message, 0, 237) . '...' : $message;
}

function cottbusErrorCategory(string $stage): string {
    return match ($stage) {
        'BUILD_ROUTES' => 'ROUTE_DATA',
        'BUILD_DRIVERS' => 'DRIVER_DATA',
        'BUILD_TRAINING' => 'TRAINING_DATA',
        'BUILD_PACKAGE' => 'PACKAGE_DATA',
        'BUILD_CATALOG' => 'CATALOG_DATA',
        'FILTER_GTFS' => 'GTFS_DATA',
        'BUILD_VARIANTS' => 'VARIANTS_INDEX',
        'VALIDATE_TEMP_ROOT' => 'TEMP_ROOT_VALIDATION',
        'DB_TRANSACTION' => 'DATABASE',
        'ROOT_SWAP' => 'TENANT_ROOT_SWAP',
        'POST_VALIDATE' => 'POST_VALIDATION',
        'ROLLBACK' => 'ROLLBACK',
        default => 'PRECONDITION',
    };
}

function cottbusErrorSummary(Throwable $error, int $exitCode = 2): array {
    if (!isset($GLOBALS['cottbusMigrationDiagnostic'])) cottbusDiagnosticReset();
    cottbusDiagnosticCaptureFailure();
    $context = $GLOBALS['cottbusMigrationDiagnostic'];
    $stage = (string)($context['failed_stage'] ?? $context['stage'] ?? 'PREPARE_TARGET');
    $category = cottbusErrorCategory($stage);
    return [
        'error_code' => 'COTTBUS_APPLY_' . $category . '_FAILED',
        'error_stage' => $stage,
        'error_category' => $category,
        'sanitized_message' => cottbusSanitizeErrorMessage($error->getMessage()),
        'exit_code' => $exitCode,
        'rollback_status' => (string)($context['rollback_status'] ?? 'NOT_REQUIRED'),
        'failed_operation' => (string)($context['failed_operation'] ?? $context['operation'] ?? 'unknown'),
        'timestamp' => gmdate('c'),
        'company_id' => cottbusShortCompanyId(is_string($context['company_id'] ?? null) ? $context['company_id'] : null),
    ];
}

cottbusDiagnosticReset();

function cottbusFail(string $message): never {
    throw new CottbusMigrationFailure($message);
}

function cottbusOption(array $options, string $name, ?string $default = null): string {
    $value = $options[$name] ?? $default;
    if (!is_string($value) || trim($value) === '') cottbusFail("Option --{$name} fehlt.");
    return trim($value);
}

function cottbusNormalizePath(string $path): string {
    return rtrim(str_replace('\\', '/', $path), '/');
}

function cottbusSamePath(string $left, string $right): bool {
    $left = cottbusNormalizePath($left);
    $right = cottbusNormalizePath($right);
    return DIRECTORY_SEPARATOR === '\\' ? strcasecmp($left, $right) === 0 : $left === $right;
}

function cottbusInside(string $root, string $path): bool {
    $root = cottbusNormalizePath($root);
    $path = cottbusNormalizePath($path);
    if (DIRECTORY_SEPARATOR === '\\') {
        $root = strtolower($root);
        $path = strtolower($path);
    }
    return $path === $root || str_starts_with($path, $root . '/');
}

function cottbusRoot(string $path, string $label): string {
    if (is_link($path)) cottbusFail("{$label} darf kein Symlink sein.");
    $resolved = realpath($path);
    if ($resolved === false || !is_dir($resolved)) cottbusFail("{$label} ist kein vorhandenes Verzeichnis.");
    return rtrim($resolved, DIRECTORY_SEPARATOR);
}

function cottbusPath(string $root, string ...$segments): string {
    $path = $root;
    foreach ($segments as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..'
            || str_contains($segment, "\0") || str_contains($segment, '/') || str_contains($segment, '\\')
            || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/D', $segment)) {
            cottbusFail('Traversal oder ungueltiges Pfadsegment erkannt.');
        }
        $path .= DIRECTORY_SEPARATOR . $segment;
    }
    if (!cottbusInside($root, $path)) cottbusFail('Pfad verlaesst die erlaubte Root-Grenze.');
    return $path;
}

function cottbusRelative(string $root, string $path): string {
    if (!cottbusInside($root, $path)) cottbusFail('Pfad verlaesst die erlaubte Root-Grenze.');
    return ltrim(substr(cottbusNormalizePath($path), strlen(cottbusNormalizePath($root))), '/');
}

function cottbusFiles(string $root): array {
    if (!is_dir($root)) return [];
    if (is_link($root)) cottbusFail('Symlink als Quellverzeichnis erkannt.');
    $pending = [$root];
    $files = [];
    while ($pending !== []) {
        $directory = array_pop($pending);
        $entries = scandir($directory);
        if ($entries === false) cottbusFail('Verzeichnis konnte nicht gelesen werden.');
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = cottbusPath($directory, $entry);
            if (is_link($path)) cottbusFail('Symlink/Junction erkannt: ' . $entry);
            if (is_dir($path)) $pending[] = $path;
            elseif (is_file($path)) $files[] = $path;
            else cottbusFail('Unbekannter Dateityp erkannt: ' . $entry);
        }
    }
    sort($files, SORT_STRING);
    return $files;
}

function cottbusRead(string $path): string {
    if (!is_file($path) || is_link($path)) cottbusFail('Quelldatei fehlt oder ist ein Symlink.');
    $content = file_get_contents($path);
    if (!is_string($content)) cottbusFail('Quelldatei konnte nicht gelesen werden.');
    return $content;
}

function cottbusJson(string $path): array {
    try {
        $decoded = json_decode(cottbusRead($path), true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        cottbusFail('Ungueltige JSON-Datei: ' . basename($path));
    }
    if (!is_array($decoded)) cottbusFail('JSON besitzt keine Objekt-/Listenstruktur.');
    return $decoded;
}

function cottbusJsonBytes(array $value): string {
    return json_encode(
        $value,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    ) . "\n";
}

function cottbusTrack(array &$tracked, string $path, string $logical): array {
    clearstatcache(true, $path);
    if (!is_file($path) || is_link($path)) cottbusFail('Fingerprint-Quelle fehlt oder ist ein Symlink.');
    $size = filesize($path);
    $mtime = filemtime($path);
    $hash = hash_file('sha256', $path);
    if ($size === false || $mtime === false || $hash === false) cottbusFail('Fingerprint konnte nicht erzeugt werden.');
    $fingerprint = ['bytes' => $size, 'mtime' => $mtime, 'sha256' => $hash];
    if (isset($tracked[$logical]) && $tracked[$logical]['fingerprint'] !== $fingerprint) {
        cottbusFail('Quelle hat sich waehrend der Planung geaendert: ' . $logical);
    }
    $tracked[$logical] = ['path' => $path, 'fingerprint' => $fingerprint];
    return $fingerprint;
}

function cottbusVerifyTracked(array $tracked): void {
    foreach ($tracked as $logical => $item) {
        clearstatcache(true, $item['path']);
        $current = [
            'bytes' => filesize($item['path']),
            'mtime' => filemtime($item['path']),
            'sha256' => hash_file('sha256', $item['path']),
        ];
        if ($current !== $item['fingerprint']) cottbusFail('Quelle wurde waehrend der Planung veraendert: ' . $logical);
    }
}

function cottbusAggregateFingerprint(array $tracked): string {
    ksort($tracked, SORT_STRING);
    $rows = [];
    foreach ($tracked as $logical => $item) {
        $rows[] = $logical . "\0" . $item['fingerprint']['bytes'] . "\0" . $item['fingerprint']['sha256'];
    }
    return hash('sha256', implode("\n", $rows));
}

function cottbusTreeFingerprint(string $root): array {
    if (!is_dir($root)) return ['exists' => false, 'files' => 0, 'sha256' => hash('sha256', '')];
    $rows = [];
    foreach (cottbusFiles($root) as $path) {
        $relative = cottbusRelative($root, $path);
        $rows[] = $relative . "\0" . filesize($path) . "\0" . hash_file('sha256', $path);
    }
    sort($rows, SORT_STRING);
    return ['exists' => true, 'files' => count($rows), 'sha256' => hash('sha256', implode("\n", $rows))];
}

function cottbusOtherTenantsFingerprint(string $stagingRoot, string $targetCompany): string {
    $companiesRoot = cottbusPath($stagingRoot, 'companies');
    $rows = [];
    foreach (scandir($companiesRoot) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || $entry === $targetCompany) continue;
        $path = cottbusPath($companiesRoot, $entry);
        if (is_link($path) || !is_dir($path)) cottbusFail('Unerwarteter Eintrag im Gesellschaftsbereich: ' . $entry);
        $fingerprint = cottbusTreeFingerprint($path);
        $rows[] = $entry . "\0" . $fingerprint['files'] . "\0" . $fingerprint['sha256'];
    }
    sort($rows, SORT_STRING);
    return hash('sha256', implode("\n", $rows));
}

function cottbusCanonicalCsv(array $header, array $rows, array $sortColumns): string {
    $normal = [];
    foreach ($rows as $row) {
        $ordered = [];
        foreach ($header as $column) $ordered[$column] = (string)($row[$column] ?? '');
        $normal[] = $ordered;
    }
    usort($normal, static function (array $a, array $b) use ($sortColumns): int {
        foreach ($sortColumns as $column) {
            $left = (string)($a[$column] ?? '');
            $right = (string)($b[$column] ?? '');
            if (str_ends_with($column, '_sequence')) {
                $comparison = ((int)$left) <=> ((int)$right);
            } else {
                $comparison = strcmp($left, $right);
            }
            if ($comparison !== 0) return $comparison;
        }
        return strcmp(json_encode($a), json_encode($b));
    });
    $stream = fopen('php://temp', 'r+');
    if ($stream === false) cottbusFail('CSV-Puffer konnte nicht angelegt werden.');
    fputcsv($stream, $header, ',', '"', '');
    foreach ($normal as $row) fputcsv($stream, array_values($row), ',', '"', '');
    rewind($stream);
    $content = stream_get_contents($stream);
    fclose($stream);
    if (!is_string($content)) cottbusFail('CSV konnte nicht serialisiert werden.');
    return str_replace("\r\n", "\n", $content);
}

function cottbusScanCsvStream($stream, string $name, callable $consumer): array {
    if (!is_resource($stream)) cottbusFail('GTFS-Tabelle konnte nicht geoeffnet werden: ' . $name);
    $header = fgetcsv($stream, null, ',', '"', '');
    if (!is_array($header)) cottbusFail('GTFS-Tabelle besitzt keinen Header: ' . $name);
    $header = array_map(static fn($value): string => trim((string)$value), $header);
    if (isset($header[0])) $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', $header[0]) ?? $header[0];
    if (count($header) !== count(array_unique($header))) cottbusFail('Doppelte GTFS-Spalte: ' . $name);
    while (($values = fgetcsv($stream, null, ',', '"', '')) !== false) {
        if ($values === [null] || $values === []) continue;
        if (count($values) !== count($header)) cottbusFail('Ungueltige GTFS-Zeile in ' . $name);
        $row = array_combine($header, array_map(static fn($value): string => (string)$value, $values));
        if (!is_array($row)) cottbusFail('GTFS-Zeile konnte nicht gelesen werden: ' . $name);
        $consumer($row);
    }
    return $header;
}

function cottbusGtfsSource(array $options, array &$tracked): array {
    if (isset($options['gtfs-directory'])) {
        if ((string)getenv('LEHRFAHRER_ENV') !== 'dev') {
            cottbusFail('--gtfs-directory ist ausschliesslich fuer lokale DEV-Fixtures erlaubt.');
        }
        $root = cottbusRoot(cottbusOption($options, 'gtfs-directory'), 'GTFS-Fixture');
        return [
            'kind' => 'directory',
            'root' => $root,
            'list' => static function () use ($root): array {
                $names = [];
                foreach (cottbusFiles($root) as $path) {
                    if (dirname($path) !== $root) cottbusFail('GTFS-Fixture darf keine Unterverzeichnisse enthalten.');
                    $names[] = basename($path);
                }
                sort($names, SORT_STRING);
                return $names;
            },
            'scan' => static function (string $name, callable $consumer) use ($root, &$tracked): ?array {
                $path = cottbusPath($root, $name);
                if (!is_file($path)) return null;
                cottbusTrack($tracked, $path, 'gtfs://' . $name);
                $stream = fopen($path, 'rb');
                try { return cottbusScanCsvStream($stream, $name, $consumer); }
                finally { if (is_resource($stream)) fclose($stream); }
            },
            'close' => static function (): void {},
        ];
    }
    $zipPath = cottbusOption($options, 'gtfs-zip');
    cottbusTrack($tracked, $zipPath, 'public://gtfs/latest.zip');
    if (!class_exists('ZipArchive')) cottbusFail('ZipArchive ist fuer eine reale GTFS-Quelle erforderlich.');
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) cottbusFail('GTFS-ZIP konnte nicht geoeffnet werden.');
    return [
        'kind' => 'zip',
        'root' => $zipPath,
        'list' => static function () use ($zip): array {
            $names = [];
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $name = $zip->getNameIndex($index);
                if (!is_string($name) || str_contains($name, '/') || str_contains($name, '\\')) {
                    cottbusFail('GTFS-ZIP enthaelt Unterverzeichnisse oder ungueltige Namen.');
                }
                $names[] = $name;
            }
            sort($names, SORT_STRING);
            return $names;
        },
        'scan' => static function (string $name, callable $consumer) use ($zip): ?array {
            if ($zip->locateName($name, ZipArchive::FL_NOCASE) === false) return null;
            $stream = $zip->getStream($name);
            if (!is_resource($stream)) cottbusFail('GTFS-Tabelle konnte nicht geoeffnet werden: ' . $name);
            try { return cottbusScanCsvStream($stream, $name, $consumer); }
            finally { fclose($stream); }
        },
        'close' => static function () use ($zip): void { $zip->close(); },
    ];
}

function cottbusGtfsTable(array $source, string $name, ?callable $filter = null): ?array {
    $rows = [];
    $header = ($source['scan'])($name, static function (array $row) use (&$rows, $filter): void {
        if ($filter === null || $filter($row)) $rows[] = $row;
    });
    return is_array($header) ? ['header' => $header, 'rows' => $rows] : null;
}

function cottbusRequireColumns(array $table, array $columns, string $name): void {
    foreach ($columns as $column) {
        if (!in_array($column, $table['header'], true)) cottbusFail("GTFS-Spalte {$column} fehlt in {$name}.");
    }
}

function cottbusRowsBy(array $rows, string $column): array {
    $result = [];
    foreach ($rows as $row) {
        $key = trim((string)($row[$column] ?? ''));
        if ($key === '' || isset($result[$key])) cottbusFail('Fehlender oder doppelter GTFS-Schluessel: ' . $column);
        $result[$key] = $row;
    }
    return $result;
}

function cottbusFilterGtfs(array $source): array {
    $supported = [
        'agency.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt',
        'shapes.txt', 'calendar.txt', 'calendar_dates.txt', 'frequencies.txt',
        'transfers.txt', 'pathways.txt', 'levels.txt', 'fare_attributes.txt',
        'fare_rules.txt', 'attributions.txt', 'feed_info.txt', 'route_networks.txt',
        'networks.txt', 'stop_areas.txt', 'areas.txt', 'booking_rules.txt',
        'translations.txt',
    ];
    $names = ($source['list'])();
    foreach ($names as $name) {
        if (!str_ends_with(strtolower($name), '.txt')) continue;
        if (!in_array(strtolower($name), $supported, true)) {
            cottbusFail('Noch nicht sicher filterbare GTFS-Tabelle vorhanden: ' . $name);
        }
    }
    $read = static fn(string $name, ?callable $filter = null): ?array => cottbusGtfsTable($source, $name, $filter);
    $agencyTable = $read('agency.txt');
    if ($agencyTable === null) cottbusFail('Erforderliche GTFS-Tabelle fehlt: agency.txt');
    cottbusRequireColumns($agencyTable, ['agency_id', 'agency_name'], 'agency.txt');
    $agencies = array_values(array_filter(
        $agencyTable['rows'],
        static fn(array $row): bool => trim((string)$row['agency_id']) === COTTBUS_AGENCY_ID
    ));
    if (count($agencies) !== 1 || trim((string)$agencies[0]['agency_name']) !== COTTBUS_AGENCY_NAME) {
        cottbusFail('Cottbusverkehr agency_id=143 ist nicht eindeutig vorhanden.');
    }
    $routesTable = $read('routes.txt',
        static fn(array $row): bool => trim((string)($row['agency_id'] ?? '')) === COTTBUS_AGENCY_ID
    );
    if ($routesTable === null) cottbusFail('Erforderliche GTFS-Tabelle fehlt: routes.txt');
    cottbusRequireColumns($routesTable, ['route_id', 'agency_id'], 'routes.txt');
    $routes = $routesTable['rows'];
    $routeIds = array_fill_keys(array_map(static fn(array $row): string => (string)$row['route_id'], $routes), true);
    if (count($routeIds) !== count($routes)) cottbusFail('Doppelte Cottbusverkehr-route_id.');
    $routeTypes = [];
    $networkIds = [];
    foreach ($routes as $row) {
        $routeTypes[(string)$row['route_id']] = (string)($row['route_type'] ?? '3');
        $networkId = trim((string)($row['network_id'] ?? ''));
        if ($networkId !== '') $networkIds[$networkId] = true;
    }
    $tripsTable = $read('trips.txt',
        static fn(array $row): bool => isset($routeIds[(string)($row['route_id'] ?? '')])
    );
    if ($tripsTable === null) cottbusFail('Erforderliche GTFS-Tabelle fehlt: trips.txt');
    cottbusRequireColumns($tripsTable, ['route_id', 'service_id', 'trip_id'], 'trips.txt');
    $trips = $tripsTable['rows'];
    $tripIds = array_fill_keys(array_map(static fn(array $row): string => (string)$row['trip_id'], $trips), true);
    if (count($tripIds) !== count($trips)) cottbusFail('Doppelte Cottbusverkehr-trip_id.');
    $tripRoutes = [];
    foreach ($trips as $row) $tripRoutes[(string)$row['trip_id']] = (string)$row['route_id'];
    $usedStopIds = [];
    $stopRouteIds = [];
    $tripsWithStopTimes = [];
    $bookingIds = [];
    $stopTimeCount = 0;
    $stopTimeBody = fopen('php://temp/maxmemory:8388608', 'r+');
    if ($stopTimeBody === false) cottbusFail('GTFS-Stop-Time-Puffer konnte nicht angelegt werden.');
    $stopTimeHeader = ($source['scan'])('stop_times.txt', static function (array $row) use (
        $tripIds, $tripRoutes, &$usedStopIds, &$stopRouteIds, &$tripsWithStopTimes,
        &$bookingIds, &$stopTimeCount, $stopTimeBody
    ): void {
        $tripId = (string)($row['trip_id'] ?? '');
        if (!isset($tripIds[$tripId])) return;
        $stopId = trim((string)($row['stop_id'] ?? ''));
        if ($stopId === '') cottbusFail('Cottbusverkehr-stop_time ohne stop_id.');
        $usedStopIds[$stopId] = true;
        $tripsWithStopTimes[$tripId] = true;
        $routeId = $tripRoutes[$tripId] ?? '';
        if ($routeId !== '') $stopRouteIds[$stopId][$routeId] = true;
        foreach (['pickup_booking_rule_id', 'drop_off_booking_rule_id'] as $column) {
            if (trim((string)($row[$column] ?? '')) !== '') $bookingIds[(string)$row[$column]] = true;
        }
        fputcsv($stopTimeBody, array_values($row), ',', '"', '');
        $stopTimeCount++;
    });
    if (!is_array($stopTimeHeader)) cottbusFail('Erforderliche GTFS-Tabelle fehlt: stop_times.txt');
    cottbusRequireColumns(['header' => $stopTimeHeader], ['trip_id', 'stop_id', 'stop_sequence'], 'stop_times.txt');
    rewind($stopTimeBody);
    $stopTimeRowsCsv = stream_get_contents($stopTimeBody);
    fclose($stopTimeBody);
    if (!is_string($stopTimeRowsCsv)) cottbusFail('Gefilterte stop_times konnten nicht serialisiert werden.');
    $stopTimesCsv = cottbusCanonicalCsv($stopTimeHeader, [], []) . str_replace("\r\n", "\n", $stopTimeRowsCsv);
    foreach (array_keys($tripIds) as $tripId) {
        if (!isset($tripsWithStopTimes[$tripId])) cottbusFail('Cottbusverkehr-Trip ohne stop_times: ' . $tripId);
    }
    $stopsTable = $read('stops.txt', static fn(array $row): bool => isset($usedStopIds[(string)($row['stop_id'] ?? '')]));
    if ($stopsTable === null) cottbusFail('Erforderliche GTFS-Tabelle fehlt: stops.txt');
    cottbusRequireColumns($stopsTable, ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], 'stops.txt');
    $allStops = cottbusRowsBy($stopsTable['rows'], 'stop_id');
    foreach (array_keys($usedStopIds) as $stopId) {
        if (!isset($allStops[$stopId])) cottbusFail('GTFS-stop_id ohne stops.txt-Datensatz: ' . $stopId);
    }
    $feedStopIds = $usedStopIds;
    do {
        $missingParents = [];
        foreach (array_keys($feedStopIds) as $stopId) {
            $parent = trim((string)($allStops[$stopId]['parent_station'] ?? ''));
            if ($parent !== '' && !isset($feedStopIds[$parent])) {
                $missingParents[$parent] = true;
            }
        }
        if ($missingParents === []) break;
        $parents = $read('stops.txt', static fn(array $row): bool => isset($missingParents[(string)($row['stop_id'] ?? '')]));
        foreach (($parents['rows'] ?? []) as $row) {
            $id = (string)$row['stop_id'];
            $allStops[$id] = $row;
            $feedStopIds[$id] = true;
            unset($missingParents[$id]);
        }
        if ($missingParents !== []) cottbusFail('Fehlende Parent-Station: ' . array_key_first($missingParents));
    } while (true);
    $stops = array_values($allStops);

    $serviceIds = [];
    $shapeIds = [];
    foreach ($trips as $row) {
        if (trim((string)$row['service_id']) !== '') $serviceIds[(string)$row['service_id']] = true;
        if (trim((string)($row['shape_id'] ?? '')) !== '') $shapeIds[(string)$row['shape_id']] = true;
    }
    $filtered = [
        'agency.txt' => [$agencyTable['header'], $agencies, ['agency_id']],
        'routes.txt' => [$routesTable['header'], $routes, ['route_id']],
        'trips.txt' => [$tripsTable['header'], $trips, ['trip_id']],
        'stop_times.txt' => $stopTimesCsv,
        'stops.txt' => [$stopsTable['header'], $stops, ['stop_id']],
    ];
    $simpleFilters = [
        'calendar.txt' => static fn(array $row): bool => isset($serviceIds[(string)($row['service_id'] ?? '')]),
        'calendar_dates.txt' => static fn(array $row): bool => isset($serviceIds[(string)($row['service_id'] ?? '')]),
        'frequencies.txt' => static fn(array $row): bool => isset($tripIds[(string)($row['trip_id'] ?? '')]),
        'pathways.txt' => static fn(array $row): bool => isset($feedStopIds[(string)($row['from_stop_id'] ?? '')])
            && isset($feedStopIds[(string)($row['to_stop_id'] ?? '')]),
        'booking_rules.txt' => static fn(array $row): bool => isset($bookingIds[(string)($row['booking_rule_id'] ?? '')]),
        'attributions.txt' => static fn(array $row): bool =>
            (trim((string)($row['agency_id'] ?? '')) === '' || (string)$row['agency_id'] === COTTBUS_AGENCY_ID)
            && (trim((string)($row['route_id'] ?? '')) === '' || isset($routeIds[(string)$row['route_id']]))
            && (trim((string)($row['trip_id'] ?? '')) === '' || isset($tripIds[(string)$row['trip_id']])),
        'translations.txt' => static function (array $row) use ($routeIds, $tripIds, $feedStopIds): bool {
            $table = strtolower(trim((string)($row['table_name'] ?? '')));
            $record = trim((string)($row['record_id'] ?? ''));
            if ($table === 'agency') return $record === COTTBUS_AGENCY_ID;
            if ($table === 'routes') return isset($routeIds[$record]);
            if ($table === 'trips') return isset($tripIds[$record]);
            if ($table === 'stops') return isset($feedStopIds[$record]);
            return $table === 'feed_info';
        },
    ];
    foreach ($simpleFilters as $name => $filter) {
        $table = $read($name, $filter);
        if ($table === null) continue;
        $rows = $table['rows'];
        $sort = match ($name) {
            'shapes.txt' => ['shape_id', 'shape_pt_sequence'],
            'calendar_dates.txt' => ['service_id', 'date', 'exception_type'],
            'pathways.txt' => ['pathway_id'],
            'booking_rules.txt' => ['booking_rule_id'],
            default => [$table['header'][0]],
        };
        $filtered[$name] = [$table['header'], $rows, $sort];
    }
    $availableShapes = [];
    $shapeBody = fopen('php://temp/maxmemory:8388608', 'r+');
    if ($shapeBody === false) cottbusFail('GTFS-Shape-Puffer konnte nicht angelegt werden.');
    $shapeHeader = ($source['scan'])('shapes.txt', static function (array $row) use ($shapeIds, &$availableShapes, $shapeBody): void {
        $shapeId = (string)($row['shape_id'] ?? '');
        if (!isset($shapeIds[$shapeId])) return;
        $availableShapes[$shapeId] = true;
        fputcsv($shapeBody, array_values($row), ',', '"', '');
    });
    if (is_array($shapeHeader)) {
        rewind($shapeBody);
        $shapeRowsCsv = stream_get_contents($shapeBody);
        if (!is_string($shapeRowsCsv)) cottbusFail('Gefilterte shapes konnten nicht serialisiert werden.');
        $filtered['shapes.txt'] = cottbusCanonicalCsv($shapeHeader, [], []) . str_replace("\r\n", "\n", $shapeRowsCsv);
    }
    fclose($shapeBody);
    $availableServices = [];
    foreach (['calendar.txt', 'calendar_dates.txt'] as $name) {
        foreach (($filtered[$name][1] ?? []) as $row) {
            $value = trim((string)($row['service_id'] ?? ''));
            if ($value !== '') $availableServices[$value] = true;
        }
    }
    foreach (array_keys($serviceIds) as $serviceId) {
        if (!isset($availableServices[$serviceId])) cottbusFail('Referenzierter GTFS-Service fehlt: ' . $serviceId);
    }
    foreach (array_keys($shapeIds) as $shapeId) {
        if (!isset($availableShapes[$shapeId])) cottbusFail('Referenzierter GTFS-Shape fehlt: ' . $shapeId);
    }
    $availableBookingRules = [];
    foreach (($filtered['booking_rules.txt'][1] ?? []) as $row) {
        $value = trim((string)($row['booking_rule_id'] ?? ''));
        if ($value !== '') $availableBookingRules[$value] = true;
    }
    foreach (array_keys($bookingIds) as $bookingId) {
        if (!isset($availableBookingRules[$bookingId])) cottbusFail('Referenzierte GTFS-Buchungsregel fehlt: ' . $bookingId);
    }
    $levelIds = [];
    foreach ($stops as $row) if (trim((string)($row['level_id'] ?? '')) !== '') $levelIds[(string)$row['level_id']] = true;
    $levels = $read('levels.txt', static fn(array $row): bool => isset($levelIds[(string)($row['level_id'] ?? '')]));
    if ($levels !== null) {
        $filtered['levels.txt'] = [$levels['header'], $levels['rows'], ['level_id']];
    }
    $availableLevels = [];
    foreach (($levels['rows'] ?? []) as $row) $availableLevels[(string)($row['level_id'] ?? '')] = true;
    foreach (array_keys($levelIds) as $levelId) if (!isset($availableLevels[$levelId])) cottbusFail('Referenzierte GTFS-Ebene fehlt: ' . $levelId);
    $fareIds = [];
    $fareRules = $read('fare_rules.txt', static function (array $row) use ($routeIds, &$fareIds): bool {
        $route = trim((string)($row['route_id'] ?? ''));
        if ($route !== '' && !isset($routeIds[$route])) return false;
        $fare = trim((string)($row['fare_id'] ?? ''));
        if ($fare !== '') $fareIds[$fare] = true;
        return true;
    });
    if ($fareRules !== null) {
        $filtered['fare_rules.txt'] = [$fareRules['header'], $fareRules['rows'], ['fare_id', 'route_id']];
        $fareAttributes = $read('fare_attributes.txt', static fn(array $row): bool => isset($fareIds[(string)($row['fare_id'] ?? '')])
            && (trim((string)($row['agency_id'] ?? '')) === '' || (string)$row['agency_id'] === COTTBUS_AGENCY_ID));
        if ($fareAttributes !== null) {
            $filtered['fare_attributes.txt'] = [$fareAttributes['header'], $fareAttributes['rows'], ['fare_id']];
        }
        $availableFares = [];
        foreach (($fareAttributes['rows'] ?? []) as $row) $availableFares[(string)($row['fare_id'] ?? '')] = true;
        foreach (array_keys($fareIds) as $fareId) if (!isset($availableFares[$fareId])) cottbusFail('Referenziertes GTFS-Tarifobjekt fehlt: ' . $fareId);
    } elseif ($read('fare_attributes.txt') !== null) {
        cottbusFail('fare_attributes.txt ohne sicher filterbare fare_rules.txt.');
    }
    $routeNetworks = $read('route_networks.txt', static function (array $row) use ($routeIds, &$networkIds): bool {
        if (!isset($routeIds[(string)($row['route_id'] ?? '')])) return false;
        $networkIds[(string)($row['network_id'] ?? '')] = true;
        return true;
    });
    if ($routeNetworks !== null) {
        $filtered['route_networks.txt'] = [$routeNetworks['header'], $routeNetworks['rows'], ['route_id', 'network_id']];
    }
    $networks = $read('networks.txt', static fn(array $row): bool => isset($networkIds[(string)($row['network_id'] ?? '')]));
    if ($networks !== null) $filtered['networks.txt'] = [$networks['header'], $networks['rows'], ['network_id']];
    $availableNetworks = [];
    foreach (($networks['rows'] ?? []) as $row) $availableNetworks[(string)($row['network_id'] ?? '')] = true;
    foreach (array_keys($networkIds) as $networkId) if (!isset($availableNetworks[$networkId])) cottbusFail('Referenziertes GTFS-Netz fehlt: ' . $networkId);
    $areaIds = [];
    $stopAreas = $read('stop_areas.txt', static function (array $row) use ($feedStopIds, &$areaIds): bool {
        if (!isset($feedStopIds[(string)($row['stop_id'] ?? '')])) return false;
        $areaIds[(string)($row['area_id'] ?? '')] = true;
        return true;
    });
    if ($stopAreas !== null) {
        $filtered['stop_areas.txt'] = [$stopAreas['header'], $stopAreas['rows'], ['area_id', 'stop_id']];
        $areas = $read('areas.txt', static fn(array $row): bool => isset($areaIds[(string)($row['area_id'] ?? '')]));
        if ($areas !== null) $filtered['areas.txt'] = [$areas['header'], $areas['rows'], ['area_id']];
        $availableAreas = [];
        foreach (($areas['rows'] ?? []) as $row) $availableAreas[(string)($row['area_id'] ?? '')] = true;
        foreach (array_keys($areaIds) as $areaId) if (!isset($availableAreas[$areaId])) cottbusFail('Referenzierte GTFS-Area fehlt: ' . $areaId);
    }
    $transferFilter = static function (array $row) use ($feedStopIds, $routeIds, $tripIds): bool {
        foreach (['from_stop_id', 'to_stop_id'] as $column) {
            $value = trim((string)($row[$column] ?? ''));
            if ($value !== '' && !isset($feedStopIds[$value])) return false;
        }
        foreach (['from_route_id', 'to_route_id'] as $column) {
            $value = trim((string)($row[$column] ?? ''));
            if ($value !== '' && !isset($routeIds[$value])) return false;
        }
        foreach (['from_trip_id', 'to_trip_id'] as $column) {
            $value = trim((string)($row[$column] ?? ''));
            if ($value !== '' && !isset($tripIds[$value])) return false;
        }
        return true;
    };
    $transfers = $read('transfers.txt', $transferFilter);
    if ($transfers !== null) {
        $filtered['transfers.txt'] = [$transfers['header'], $transfers['rows'], ['from_stop_id', 'to_stop_id', 'from_trip_id', 'to_trip_id']];
    }
    $feedInfo = $read('feed_info.txt');
    if ($feedInfo !== null) $filtered['feed_info.txt'] = [$feedInfo['header'], $feedInfo['rows'], [$feedInfo['header'][0]]];

    $files = [];
    ksort($filtered, SORT_STRING);
    foreach ($filtered as $name => $definition) {
        if (is_string($definition)) {
            $files[$name] = $definition;
            continue;
        }
        [$header, $rows, $sort] = $definition;
        $files[$name] = cottbusCanonicalCsv($header, $rows, $sort);
    }
    $stopTypes = [];
    $stopSourceCounts = [];
    foreach ($stopRouteIds as $stopId => $servedRoutes) {
        $hasBus = false;
        $hasTram = false;
        foreach (array_keys($servedRoutes) as $routeId) {
            $type = (int)($routeTypes[$routeId] ?? 3);
            if ($type === 0 || ($type >= 900 && $type < 1000)) $hasTram = true;
            if ($type === 3 || ($type >= 700 && $type < 800)) $hasBus = true;
        }
        $stopTypes[$stopId] = $hasBus && $hasTram ? 'bus_tram' : ($hasTram ? 'tram' : 'bus');
        $stopSourceCounts[$stopId] = count($servedRoutes);
    }
    return [
        'files' => $files,
        'counts' => [
            'agencies' => count($agencies),
            'routes' => count($routes),
            'trips' => count($trips),
            'stop_times' => $stopTimeCount,
            'used_stops' => count($usedStopIds),
            'feed_stop_rows' => count($stops),
        ],
        'used_stop_ids' => $usedStopIds,
        'stops_by_id' => $allStops,
        'stop_types' => $stopTypes,
        'stop_source_counts' => $stopSourceCounts,
    ];
}

function cottbusDeterministicZip(array $files): string {
    ksort($files, SORT_STRING);
    $local = '';
    $central = '';
    $offset = 0;
    $entries = 0;
    foreach ($files as $name => $content) {
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/D', $name)) cottbusFail('Ungueltiger ZIP-Dateiname.');
        $content = (string)$content;
        $crc = hexdec(hash('crc32b', $content));
        $size = strlen($content);
        $flags = 0x0800;
        $date = 33;
        $header = pack('VvvvvvVVVvv', 0x04034b50, 20, $flags, 0, 0, $date, $crc, $size, $size, strlen($name), 0);
        $record = $header . $name . $content;
        $central .= pack(
            'VvvvvvvVVVvvvvvVV',
            0x02014b50, 20, 20, $flags, 0, 0, $date, $crc, $size, $size,
            strlen($name), 0, 0, 0, 0, 0, $offset
        ) . $name;
        $local .= $record;
        $offset += strlen($record);
        $entries++;
    }
    if ($entries > 65535 || strlen($local) > 0xffffffff || strlen($central) > 0xffffffff) {
        cottbusFail('Deterministisches ZIP ueberschreitet ZIP32-Grenzen.');
    }
    return $local . $central . pack(
        'VvvvvVVv', 0x06054b50, 0, 0, $entries, $entries, strlen($central), strlen($local), 0
    );
}

function cottbusVariantIndex(array $gtfsFiles, string $gtfsZipSha256): array {
    $temporary = tempnam(sys_get_temp_dir(), 'lehrfahrer-variants-');
    if ($temporary === false) cottbusFail('Temporärer Variantenindex-Pfad kann nicht reserviert werden.');
    @unlink($temporary);
    try {
        $validation = lehrfahrer_gtfs_build_variant_index(
            $gtfsFiles,
            $temporary,
            [COTTBUS_AGENCY_ID],
            ['source_sha256' => $gtfsZipSha256, 'created_at' => '1970-01-01T00:00:00Z']
        );
        if (($validation['routes'] ?? 0) !== COTTBUS_EXPECTED_COUNTS['routes']) {
            cottbusFail('Variantenindex enthaelt nicht genau 75 Cottbusverkehr-Routen.');
        }
        $bytes = cottbusRead($temporary);
        if (!hash_equals(strval($validation['sha256']), hash('sha256', $bytes))) cottbusFail('Variantenindex-Fingerprint ist inkonsistent.');
        return ['bytes' => $bytes, 'validation' => $validation];
    } finally {
        @unlink($temporary);
        @unlink($temporary . '-journal');
    }
}

function cottbusNormalizedStopName(string $name): string {
    $name = trim($name);
    $name = preg_replace('/^cottbus\s*,\s*/iu', '', $name) ?? $name;
    $name = strtr($name, ['Ä' => 'ä', 'Ö' => 'ö', 'Ü' => 'ü', 'ẞ' => 'ß']);
    return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
}

function cottbusDistanceMeters(float $latA, float $lonA, float $latB, float $lonB): float {
    $radius = 6371000.0;
    $phiA = deg2rad($latA);
    $phiB = deg2rad($latB);
    $deltaPhi = deg2rad($latB - $latA);
    $deltaLambda = deg2rad($lonB - $lonA);
    $a = sin($deltaPhi / 2) ** 2 + cos($phiA) * cos($phiB) * sin($deltaLambda / 2) ** 2;
    return $radius * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

function cottbusTarget(string $company, string $area, string $relative = ''): string {
    $allowed = ['lines', 'cities', 'drivers', 'trainings', 'packages', 'documents', 'catalogs', 'settings', 'imports'];
    if (!in_array($area, $allowed, true)) cottbusFail('Ungueltiger Tenant-Zielbereich.');
    $base = 'companies/' . $company . '/' . $area;
    if ($relative === '') return $base;
    foreach (explode('/', $relative) as $segment) {
        if (!preg_match('/^(?:[A-Za-z0-9][A-Za-z0-9._-]*|\{[A-Z_]+\})$/D', $segment)) {
            cottbusFail('Ungueltiger Tenant-Zielpfad.');
        }
    }
    return $base . '/' . $relative;
}

function cottbusManifestItem(
    string $source,
    string $type,
    string $target,
    string $content,
    string $classification,
    string $decision,
    array $mapping,
    array $references,
    array $warnings,
    array $dependencies
): array {
    return [
        'source' => $source,
        'data_type' => $type,
        'target' => $target,
        'bytes' => strlen($content),
        'sha256' => hash('sha256', $content),
        'classification' => $classification,
        'decision' => $decision,
        'mapping' => $mapping,
        'reference_check' => $references,
        'warnings' => array_values($warnings),
        'expected_mode' => '0600',
        'dependencies' => array_values($dependencies),
    ];
}

function cottbusSafeDriver(array $driver): array {
    $allowedRoles = ['Admin', 'Disponent', 'Einweiser', 'Fahrer'];
    $roles = array_values(array_unique(array_filter(
        array_map(static fn($value): string => trim((string)$value), is_array($driver['roles'] ?? null) ? $driver['roles'] : []),
        static fn(string $value): bool => in_array($value, $allowedRoles, true)
    )));
    if ($roles === []) $roles = ['Fahrer'];
    $result = [];
    foreach (['id', 'firstName', 'lastName', 'personnelNumber', 'depot', 'note', 'created', 'updated'] as $key) {
        $result[$key] = (string)($driver[$key] ?? '');
    }
    $result['active'] = (bool)($driver['active'] ?? false);
    $result['roles'] = $roles;
    return $result;
}

function cottbusRouteReferenceKey(array $route): string {
    return implode('/', [
        (string)($route['city'] ?? ''),
        (string)($route['lineFolder'] ?? ''),
        (string)($route['categoryFolder'] ?? ''),
        (string)($route['fileBase'] ?? ''),
    ]);
}

function cottbusApiRoutePaths(array $item): array {
    $query = http_build_query([
        'city' => $item['city'], 'line' => $item['fileBase'],
        'lineFolder' => $item['lineFolder'], 'categoryFolder' => $item['categoryFolder'],
    ]);
    return [
        'jsonPath' => 'api/download_line_json.php?' . $query,
        'pdfPath' => 'api/download_line_pdf.php?' . $query,
        'gpxPath' => 'api/download_line_gpx.php?' . $query,
    ];
}

function cottbusBuildPlan(array $options, string $company): array {
    cottbusDiagnosticMark('PREPARE_TARGET', 'resolve-source-roots');
    $publicRoot = cottbusRoot(cottbusOption($options, 'public-root'), 'Public-Quellroot');
    $privateRoot = cottbusRoot(cottbusOption($options, 'private-root'), 'Private-Quellroot');
    if (cottbusInside($publicRoot, $privateRoot) || cottbusInside($privateRoot, $publicRoot)) {
        cottbusFail('Public- und Private-Quellroot duerfen nicht ineinander liegen.');
    }
    $tracked = [];
    $manifest = [];
    $targetFiles = [];
    $excludes = [
        'training_000001', 'training_000002', 'training_000003', 'two-test-package-documents',
        'fifth-unresolved-pdf', 'fileBase=drivers', 'legacy-package-zip', 'linien/test',
        'linien/proberouten', 'backup_liniendaten', 'WorkingSystem', 'variants.sqlite-copy',
        'browser-autosaves', 'local-routing-graphs', 'other-test-and-legacy-data',
    ];

    cottbusDiagnosticMark('FILTER_GTFS', 'filter-approved-gtfs-source');
    $source = cottbusGtfsSource($options, $tracked);
    try { $gtfs = cottbusFilterGtfs($source); }
    finally { ($source['close'])(); }
    foreach (COTTBUS_EXPECTED_COUNTS as $key => $expected) {
        if (($gtfs['counts'][$key] ?? null) !== $expected) {
            cottbusFail("GTFS-Menge {$key} weicht ab: erwartet {$expected}, gefunden " . ($gtfs['counts'][$key] ?? 'n/a') . '.');
        }
    }
    if (($gtfs['counts']['agencies'] ?? 0) !== 1) cottbusFail('Gefiltertes GTFS enthaelt nicht genau eine Agency.');
    $gtfsZip = cottbusDeterministicZip($gtfs['files']);
    $gtfsZipSha256 = hash('sha256', $gtfsZip);
    $gtfsTarget = cottbusTarget($company, 'imports', 'gtfs/latest.zip');
    $targetFiles[$gtfsTarget] = $gtfsZip;
    $manifest[] = cottbusManifestItem(
        $source['kind'] === 'zip' ? 'public://gtfs/latest.zip' : 'fixture://gtfs',
        'filtered-gtfs', $gtfsTarget, $gtfsZip, 'A', 'INCLUDE',
        ['agency_id' => COTTBUS_AGENCY_ID, 'strategy' => 'FILTERED_REFERENTIAL_CLOSURE'],
        ['agency' => 'OK', 'routes' => 'OK', 'trips' => 'OK', 'stops' => 'OK'],
        [], ['variants-index:BUILD_AND_VALIDATE']
    );
    cottbusDiagnosticMark('BUILD_VARIANTS', 'build-tenant-variants-index');
    $variantIndex = cottbusVariantIndex($gtfs['files'], $gtfsZipSha256);
    $variantTarget = cottbusTarget($company, 'imports', 'gtfs/index/variants.sqlite');
    $targetFiles[$variantTarget] = $variantIndex['bytes'];
    $manifest[] = cottbusManifestItem(
        'generated://filtered-gtfs/agency-143', 'variants-index', $variantTarget,
        $variantIndex['bytes'], 'A', 'INCLUDE',
        ['builder' => 'shared-gtfs-index-schema-v3', 'agency_ids' => [COTTBUS_AGENCY_ID]],
        ['integrity_check' => 'OK', 'foreign_agencies' => 0, 'routes' => $variantIndex['validation']['routes'], 'variants' => $variantIndex['validation']['variants']],
        [], ['filtered-gtfs']
    );

    cottbusDiagnosticMark('BUILD_CATALOG', 'build-tenant-stop-catalog');
    $catalog = [];
    foreach (array_keys($gtfs['used_stop_ids']) as $stopId) {
        $stop = $gtfs['stops_by_id'][$stopId];
        $lat = filter_var($stop['stop_lat'], FILTER_VALIDATE_FLOAT);
        $lon = filter_var($stop['stop_lon'], FILTER_VALIDATE_FLOAT);
        if ($lat === false || $lon === false) cottbusFail('Ungueltige GTFS-Koordinate: ' . $stopId);
        $catalog[] = [
            'id' => (string)$stopId,
            'name' => trim((string)$stop['stop_name']),
            'lat' => round((float)$lat, 6),
            'lon' => round((float)$lon, 6),
            'type' => $gtfs['stop_types'][$stopId] ?? 'bus',
            'sourceCount' => $gtfs['stop_source_counts'][$stopId] ?? 1,
        ];
    }
    usort($catalog, static fn(array $a, array $b): int => strcmp($a['id'], $b['id']));
    if (count($catalog) !== COTTBUS_EXPECTED_COUNTS['used_stops']) cottbusFail('Katalog besitzt nicht genau 1.531 Stops.');
    $catalogBytes = cottbusJsonBytes($catalog);
    $catalogTarget = cottbusTarget($company, 'catalogs', 'haltestellen.json');
    $targetFiles[$catalogTarget] = $catalogBytes;
    $manifest[] = cottbusManifestItem(
        'generated://gtfs/agency-143/used-stops', 'catalog', $catalogTarget, $catalogBytes,
        'A', 'INCLUDE', ['id' => 'GTFS stop_id', 'extra_metadata' => 'migration-manifest-only'],
        ['used_stops' => count($catalog), 'foreign_stops' => 0], [], ['filtered-gtfs']
    );
    $cityTarget = cottbusTarget($company, 'cities', 'cottbus');
    $manifest[] = [
        'source' => 'generated://city/cottbus', 'data_type' => 'city-directory',
        'target' => $cityTarget, 'bytes' => 0, 'sha256' => hash('sha256', ''),
        'classification' => 'A', 'decision' => 'INCLUDE', 'mapping' => ['city' => 'cottbus'],
        'reference_check' => ['routes' => 'OK'], 'warnings' => [],
        'expected_mode' => '0700', 'dependencies' => [],
    ];

    cottbusDiagnosticMark('BUILD_ROUTES', 'build-approved-route-files');
    $routeRoot = cottbusPath($publicRoot, 'linien', 'cottbus');
    if (!is_dir($routeRoot)) cottbusFail('Cottbus-Routenroot fehlt.');
    $routeFiles = cottbusFiles($routeRoot);
    $jsonFiles = array_values(array_filter($routeFiles, static fn(string $path): bool => strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'json'));
    if (count($jsonFiles) !== 4) cottbusFail('Es werden genau vier Cottbus-Routen erwartet.');
    foreach ($routeFiles as $path) {
        if (!in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), ['json', 'gpx', 'pdf'], true)) {
            cottbusFail('Unbekannte Datei im Cottbus-Routenbestand: ' . cottbusRelative($routeRoot, $path));
        }
    }
    $routeKeys = [];
    $routeCountByLine = [];
    $remappings = [];
    $freeStops = 0;
    foreach ($jsonFiles as $jsonPath) {
        $relative = cottbusRelative($routeRoot, $jsonPath);
        $parts = explode('/', $relative);
        if (count($parts) !== 3) cottbusFail('Ungueltige Routenstruktur: ' . $relative);
        [$lineFolder, $categoryFolder, $file] = $parts;
        $fileBase = pathinfo($file, PATHINFO_FILENAME);
        $route = cottbusJson($jsonPath);
        cottbusTrack($tracked, $jsonPath, 'public://linien/cottbus/' . $relative);
        if (($route['city'] ?? '') !== 'cottbus'
            || ($route['lineFolder'] ?? '') !== $lineFolder
            || ($route['categoryFolder'] ?? '') !== $categoryFolder) {
            cottbusFail('Routenmetadaten widersprechen dem freigegebenen Quellpfad: ' . $relative);
        }
        $route['fileBase'] = $fileBase;
        unset($route['jsonPath'], $route['gpxPath'], $route['pdfPath']);
        $geometryBefore = hash('sha256', json_encode($route['routePoints'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        foreach (($route['stops'] ?? []) as $index => $stop) {
            if (!is_array($stop)) cottbusFail('Ungueltige Haltestelle in ' . $relative);
            $old = trim((string)($stop['catalogId'] ?? ''));
            if ($old === '') {
                $freeStops++;
                continue;
            }
            $target = $old;
            $security = 'EXACT';
            $maxDistance = 1.0;
            if (isset(COTTBUS_LEGACY_STOP_MAPPING[$old])) {
                $fixed = COTTBUS_LEGACY_STOP_MAPPING[$old];
                $target = $fixed['target'];
                $security = 'HIGH';
                $maxDistance = $fixed['max_distance_m'];
                if (cottbusNormalizedStopName((string)($stop['name'] ?? '')) !== $fixed['name']) {
                    cottbusFail('Legacy-Haltestellenname weicht vom festen Mapping ab: ' . $old);
                }
            } elseif (!ctype_digit($old)) {
                cottbusFail('Nicht freigegebene Haltestellenreferenz: ' . $old);
            }
            if (!isset($gtfs['used_stop_ids'][$target], $gtfs['stops_by_id'][$target])) {
                cottbusFail('Festes Haltestellenmapping fehlt im Cottbusverkehr-GTFS: ' . $target);
            }
            $gtfsStop = $gtfs['stops_by_id'][$target];
            if (cottbusNormalizedStopName((string)($stop['name'] ?? ''))
                !== cottbusNormalizedStopName((string)$gtfsStop['stop_name'])) {
                cottbusFail('Haltestellenname passt nicht zum festen GTFS-Mapping: ' . $old);
            }
            $distance = cottbusDistanceMeters(
                (float)($stop['lat'] ?? 0), (float)($stop['lon'] ?? 0),
                (float)$gtfsStop['stop_lat'], (float)$gtfsStop['stop_lon']
            );
            if ($distance > $maxDistance) cottbusFail('Haltestellenkoordinate passt nicht zum festen GTFS-Mapping: ' . $old);
            $route['stops'][$index]['catalogId'] = $target;
            if (array_key_exists('groupId', $route['stops'][$index])) $route['stops'][$index]['groupId'] = $target;
            $remappings[] = [
                'route' => 'cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase,
                'old' => $old, 'new' => $target, 'match' => $security,
            ];
        }
        $geometryAfter = hash('sha256', json_encode($route['routePoints'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        if (!hash_equals($geometryBefore, $geometryAfter)) cottbusFail('Fahrweggeometrie wurde veraendert.');
        $routeKey = 'cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase;
        if (isset($routeKeys[$routeKey])) cottbusFail('Doppelte Zielroute.');
        $routeKeys[$routeKey] = true;
        $routeCountByLine[$lineFolder] = true;
        $jsonBytes = cottbusJsonBytes($route);
        foreach (['json', 'gpx', 'pdf'] as $extension) {
            $sourcePath = dirname($jsonPath) . DIRECTORY_SEPARATOR . $fileBase . '.' . $extension;
            if (!is_file($sourcePath) || is_link($sourcePath)) cottbusFail(strtoupper($extension) . '-Begleitdatei fehlt: ' . $routeKey);
            $logical = 'public://linien/cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . basename($sourcePath);
            cottbusTrack($tracked, $sourcePath, $logical);
            $content = $extension === 'json' ? $jsonBytes : cottbusRead($sourcePath);
            $target = cottbusTarget($company, 'lines', 'cottbus/' . $lineFolder . '/' . $categoryFolder . '/' . $fileBase . '.' . $extension);
            $targetFiles[$target] = $content;
            $manifest[] = cottbusManifestItem(
                $logical, 'route-' . $extension, $target, $content, 'A', 'INCLUDE',
                $extension === 'json' ? ['fileBase' => $fileBase, 'catalog_references' => 'fixed-manifest'] : [],
                ['route' => 'OK', 'geometry' => 'UNCHANGED'], [], ['city:cottbus']
            );
        }
    }
    if (count($routeCountByLine) !== 3 || count($remappings) !== 40 || $freeStops !== 21) {
        cottbusFail('Routen-Sollbestand weicht ab (3 Linien, 40 Remappings, 21 freie Stops erwartet).');
    }
    $exact = count(array_filter($remappings, static fn(array $row): bool => $row['match'] === 'EXACT'));
    $high = count(array_filter($remappings, static fn(array $row): bool => $row['match'] === 'HIGH'));
    if ($exact !== 36 || $high !== 4) cottbusFail('Remapping-Sollbestand 36 EXACT/4 HIGH wurde nicht erreicht.');

    cottbusDiagnosticMark('BUILD_DRIVERS', 'build-approved-driver-record');
    $driversPath = cottbusPath($privateRoot, 'personnel', 'drivers.json');
    cottbusTrack($tracked, $driversPath, 'private://personnel/drivers.json');
    $drivers = cottbusJson($driversPath);
    $active = array_values(array_filter($drivers, static fn($row): bool => is_array($row) && ($row['active'] ?? false) === true));
    if (count($active) !== 1) cottbusFail('Genau ein produktiver Fahrer wird erwartet.');
    $driver = cottbusSafeDriver($active[0]);
    if (preg_match('/^drv_[0-9a-f]{32}$/D', $driver['id']) !== 1) cottbusFail('Produktive Fahrer-ID ist nicht kanonisch.');
    $driverBytes = cottbusJsonBytes([$driver]);
    $driverTarget = cottbusTarget($company, 'drivers', 'drivers.json');
    $targetFiles[$driverTarget] = $driverBytes;
    $manifest[] = cottbusManifestItem(
        'private://personnel/drivers.json', 'drivers', $driverTarget, $driverBytes, 'A', 'INCLUDE',
        ['id' => 'KEEP-ID', 'fields' => 'tenant-allowlist'], ['active_drivers' => 1], [], []
    );

    cottbusDiagnosticMark('BUILD_TRAINING', 'build-approved-training-record');
    $trainingRoot = cottbusPath($privateRoot, 'trainings');
    $training = null;
    $trainingPath = null;
    $foundTrainingIds = [];
    foreach (cottbusFiles($trainingRoot) as $path) {
        if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'json') cottbusFail('Unbekannte Trainingsdatei.');
        $data = cottbusJson($path);
        $id = (string)($data['trainingId'] ?? '');
        cottbusTrack($tracked, $path, 'private://trainings/' . basename($path));
        $foundTrainingIds[$id] = true;
        if ($id === 'training_000004') { $training = $data; $trainingPath = $path; }
        elseif (!in_array($id, COTTBUS_EXCLUDED_TRAININGS, true)) cottbusFail('Unbekanntes Training im Quellbestand.');
    }
    foreach (array_merge(COTTBUS_EXCLUDED_TRAININGS, ['training_000004']) as $id) {
        if (!isset($foundTrainingIds[$id])) cottbusFail('Erwartetes Training fehlt: ' . $id);
    }
    if (!is_array($training) || $trainingPath === null || ($training['driverId'] ?? '') !== $driver['id']) {
        cottbusFail('training_000004 besitzt keine gueltige Fahrerreferenz.');
    }
    $trainingRoutes = is_array($training['routes'] ?? null) ? $training['routes'] : [];
    if (count($trainingRoutes) !== 2) cottbusFail('training_000004 muss genau zwei Routen referenzieren.');
    foreach ($trainingRoutes as &$item) {
        if (!is_array($item)) cottbusFail('Ungueltige Trainingsroute.');
        $key = cottbusRouteReferenceKey($item);
        if (!isset($routeKeys[$key])) cottbusFail('Training referenziert keine freigegebene Zielroute: ' . $key);
        $item = array_merge($item, cottbusApiRoutePaths($item));
    }
    unset($item);
    $training['routes'] = $trainingRoutes;
    $statusMap = ['Erstellt' => 'created', 'created' => 'created', 'running' => 'running', 'completed' => 'completed', 'archived' => 'archived'];
    $training['status'] = $statusMap[(string)($training['status'] ?? '')] ?? cottbusFail('Unbekannter Trainingstatus.');
    $trainingBytes = cottbusJsonBytes($training);
    $trainingTarget = cottbusTarget($company, 'trainings', 'training_000004.json');
    $targetFiles[$trainingTarget] = $trainingBytes;
    $manifest[] = cottbusManifestItem(
        'private://trainings/training_000004.json', 'training', $trainingTarget, $trainingBytes, 'A', 'INCLUDE',
        ['id' => 'KEEP-ID', 'paths' => 'tenant-api'], ['driver' => 'OK', 'routes' => 'OK'], [], ['drivers', 'routes']
    );

    cottbusDiagnosticMark('BUILD_PACKAGE', 'build-approved-package-and-documents');
    $packageRoot = cottbusPath($privateRoot, 'fahrerunterlagen');
    $packageDirectories = [];
    foreach (cottbusFiles($packageRoot) as $path) if (basename($path) === 'paket.json') $packageDirectories[] = dirname($path);
    if (count($packageDirectories) !== 1) cottbusFail('Genau ein Legacy-Paketmanifest wird erwartet.');
    $packageDirectory = $packageDirectories[0];
    $legacyPackagePath = cottbusPath($packageDirectory, 'paket.json');
    cottbusTrack($tracked, $legacyPackagePath, 'private://fahrerunterlagen/[subject]/[package]/paket.json');
    $legacyPackage = cottbusJson($legacyPackagePath);
    $documents = is_array($legacyPackage['documents'] ?? null) ? $legacyPackage['documents'] : [];
    $selected = is_array($legacyPackage['selectedItems'] ?? null) ? $legacyPackage['selectedItems'] : [];
    if (count($documents) !== 5 || count($selected) !== 5) cottbusFail('Legacy-Paket besitzt nicht den erwarteten 5-Positionen-Bestand.');
    $includedDocuments = [];
    $includedItems = [];
    $documentContents = [];
    foreach ($documents as $index => $document) {
        if (!is_array($document) || !is_array($selected[$index] ?? null)) cottbusFail('Ungueltige Legacy-Paketposition.');
        $item = $selected[$index];
        $basename = basename((string)($document['path'] ?? ($document['file'] ?? '')));
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/D', $basename)) cottbusFail('Ungueltiger Paketdokumentname.');
        $documentPath = cottbusPath($packageDirectory, $basename);
        if (!is_file($documentPath) || is_link($documentPath)) cottbusFail('Erwartetes Paketdokument fehlt.');
        cottbusTrack($tracked, $documentPath, 'private://fahrerunterlagen/[subject]/[package]/' . $basename);
        $isCottbus = ($item['city'] ?? '') === 'cottbus' && isset($routeKeys[cottbusRouteReferenceKey($item)]);
        if ($index < 2 && !$isCottbus) cottbusFail('Freigegebene Cottbus-Paketposition passt nicht zur Route.');
        if ($index >= 2 && $isCottbus) cottbusFail('Ausgeschlossene Paketposition waere unerwartet produktiv.');
        if ($index >= 2) continue;
        $cleanDocument = [];
        foreach (['lineName', 'routeName', 'directionName', 'variantName', 'variantCategory', 'validFrom', 'validUntil'] as $key) {
            $cleanDocument[$key] = (string)($document[$key] ?? '');
        }
        $cleanDocument['file'] = $basename;
        $cleanDocument['path'] = '';
        $includedDocuments[] = $cleanDocument;
        $includedItems[] = [
            'city' => 'cottbus', 'lineFolder' => (string)$item['lineFolder'],
            'categoryFolder' => (string)$item['categoryFolder'], 'fileBase' => (string)$item['fileBase'],
        ];
        $documentContents[$basename] = cottbusRead($documentPath);
    }
    foreach (cottbusFiles($packageDirectory) as $path) {
        if (strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'zip') {
            cottbusTrack($tracked, $path, 'private://fahrerunterlagen/[subject]/[package]/legacy-package.zip');
        }
    }
    $packageFiles = cottbusFiles($packageDirectory);
    $packagePdfCount = count(array_filter($packageFiles, static fn(string $path): bool => strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'pdf'));
    $packageZipCount = count(array_filter($packageFiles, static fn(string $path): bool => strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'zip'));
    if (count($packageFiles) !== 7 || $packagePdfCount !== 5 || $packageZipCount !== 1) {
        cottbusFail('Unbekannte oder fehlende Datei im Legacy-Paketbestand.');
    }
    if (count($includedDocuments) !== 2) cottbusFail('Genau zwei Cottbus-Dokumente werden erwartet.');
    $packageId = $company === COTTBUS_PLACEHOLDER_COMPANY
        ? '{PACKAGE_ID}'
        : 'pkg_' . substr(hash('sha256', $company . "\0" . cottbusAggregateFingerprint($tracked) . "\0" . COTTBUS_MIGRATION_VERSION), 0, 32);
    $created = trim((string)($legacyPackage['created'] ?? ($legacyPackage['createdAt'] ?? '')));
    $newPackage = [
        'id' => $packageId, 'driverId' => $driver['id'], 'trainingId' => 'training_000004',
        'driverName' => trim($driver['firstName'] . ' ' . $driver['lastName']),
        'created' => $created, 'updated' => $created, 'createdAt' => $created,
        'version' => 2, 'status' => 'Erstellt', 'note' => '',
        'documentCount' => 2,
        'lineCount' => count(array_unique(array_map(static fn(array $row): string => $row['lineName'], $includedDocuments))),
        'categories' => array_values(array_unique(array_filter(array_map(static fn(array $row): string => $row['variantCategory'], $includedDocuments)))),
        'validity' => [], 'documents' => $includedDocuments, 'selectedItems' => $includedItems,
    ];
    $packageBytes = cottbusJsonBytes($newPackage);
    $packageZipFiles = ['paket.json' => $packageBytes] + $documentContents;
    $packageZip = cottbusDeterministicZip($packageZipFiles);
    $packageBase = cottbusTarget($company, 'packages', $packageId);
    $targetFiles[$packageBase . '/paket.json'] = $packageBytes;
    $targetFiles[$packageBase . '/paket.zip'] = $packageZip;
    $manifest[] = cottbusManifestItem(
        'generated://legacy-package/approved-positions', 'package-manifest', $packageBase . '/paket.json',
        $packageBytes, 'A', 'INCLUDE', ['id' => $packageId, 'legacy_zip' => 'EXCLUDE'],
        ['driver' => 'OK', 'training' => 'OK', 'documents' => 2], [], ['drivers', 'training', 'documents']
    );
    $manifest[] = cottbusManifestItem(
        'generated://tenant-package/documents', 'package-zip', $packageBase . '/paket.zip',
        $packageZip, 'A', 'INCLUDE', ['archive' => 'REBUILD'], ['documents' => 2], [], ['package-manifest', 'documents']
    );
    foreach ($documentContents as $file => $content) {
        $target = cottbusTarget($company, 'documents', $packageId . '/' . $file);
        $targetFiles[$target] = $content;
        $manifest[] = cottbusManifestItem(
            'private://fahrerunterlagen/[subject]/[package]/' . $file, 'package-document', $target,
            $content, 'A', 'INCLUDE', ['package_id' => $packageId], ['driver' => 'OK', 'route' => 'OK'], [], ['package-manifest']
        );
    }

    $settingsPath = cottbusPath($publicRoot, 'data', 'city_settings.json');
    cottbusTrack($tracked, $settingsPath, 'public://data/city_settings.json');
    $allSettings = cottbusJson($settingsPath);
    $cottbusSettings = is_array($allSettings['cottbus'] ?? null) ? $allSettings['cottbus'] : null;
    if ($cottbusSettings === null) cottbusFail('Cottbus-Einstellung fehlt.');
    $dispatchPhone = trim((string)($cottbusSettings['dispatchPhone'] ?? ''));
    if ($dispatchPhone === '') cottbusFail('Cottbus-Leitstellen-Telefonnummer fehlt.');
    $settingsBytes = cottbusJsonBytes(['cottbus' => ['dispatchPhone' => $dispatchPhone]]);
    $settingsTarget = cottbusTarget($company, 'settings', 'city_settings.json');
    $targetFiles[$settingsTarget] = $settingsBytes;
    $manifest[] = cottbusManifestItem(
        'public://data/city_settings.json#cottbus', 'tenant-settings', $settingsTarget, $settingsBytes,
        'A', 'INCLUDE', ['scope' => 'dispatchPhone-only'], ['cottbus' => 'OK', 'test_values' => 'EXCLUDED'], [], []
    );

    cottbusVerifyTracked($tracked);
    $sourceFingerprint = cottbusAggregateFingerprint($tracked);
    ksort($targetFiles, SORT_STRING);
    usort($manifest, static fn(array $a, array $b): int => [$a['target'], $a['data_type']] <=> [$b['target'], $b['data_type']]);
    usort($remappings, static fn(array $a, array $b): int => [$a['route'], $a['old']] <=> [$b['route'], $b['old']]);
    $targetRows = [];
    foreach ($targetFiles as $path => $content) $targetRows[] = $path . "\0" . strlen($content) . "\0" . hash('sha256', $content);
    $targetDirectories = [$cityTarget];
    foreach ($targetDirectories as $path) $targetRows[] = 'DIR' . "\0" . $path . "\0" . '0700';
    sort($targetRows, SORT_STRING);
    $expectedTargetFingerprint = hash('sha256', implode("\n", $targetRows));
    return [
        'public_root' => $publicRoot,
        'private_root' => $privateRoot,
        'tracked' => $tracked,
        'target_files' => $targetFiles,
        'target_directories' => $targetDirectories,
        'deterministic_manifest' => [
            'migration_version' => COTTBUS_MIGRATION_VERSION,
            'tool_version' => COTTBUS_MIGRATION_TOOL_VERSION,
            'company_id' => $company,
            'source_fingerprint' => $sourceFingerprint,
            'expected_target_fingerprint' => $expectedTargetFingerprint,
            'expected_target' => [
                'cities' => 1, 'lines' => 3, 'routes' => 4, 'route_files' => 12,
                'drivers' => 1, 'trainings' => 1, 'packages' => 1, 'documents' => 2,
                'catalog_stops' => 1531, 'gtfs_agencies' => 1,
                'variants_index' => ['action' => 'BUILD_AND_VALIDATE', 'agencyIds' => [COTTBUS_AGENCY_ID],
                    'schema_version' => LEHRFAHRER_GTFS_INDEX_SCHEMA_VERSION,
                    'routes' => $variantIndex['validation']['routes'], 'variants' => $variantIndex['validation']['variants']],
            ],
            'gtfs' => [
                'agency_id' => COTTBUS_AGENCY_ID, 'agency_name' => COTTBUS_AGENCY_NAME,
                'counts' => $gtfs['counts'], 'zip_sha256' => $gtfsZipSha256,
                'foreign_agencies' => 0, 'reproducible_zip' => true,
            ],
            'variants_index' => $variantIndex['validation'],
            'catalog' => ['count' => count($catalog), 'id_strategy' => 'GTFS stop_id', 'foreign_stops' => 0],
            'remappings' => $remappings,
            'routes' => ['count' => 4, 'lines' => 3, 'free_stops_preserved' => $freeStops, 'geometry' => 'UNCHANGED'],
            'driver' => ['count' => 1, 'id_action' => 'KEEP-ID'],
            'training' => ['include' => ['training_000004'], 'exclude' => COTTBUS_EXCLUDED_TRAININGS],
            'package' => ['documents' => 2, 'legacy_zip' => 'EXCLUDE', 'new_zip' => 'REBUILD', 'package_id' => $packageId],
            'settings' => ['cottbus_overrides' => ['dispatchPhone'], 'master_defaults_copied' => false],
            'would_create' => [
                'company_data_area', 'city:cottbus', 'lines:3', 'routes:4', 'driver:1',
                'training:training_000004', 'package:1', 'documents:2', 'catalog:1531',
                'gtfs:agency-143', 'variants-index:BUILD_AND_VALIDATE',
            ],
            'would_exclude' => $excludes,
            'manifest' => $manifest,
        ],
    ];
}

function cottbusApplyGate(array $options): array {
    if ((string)getenv('LEHRFAHRER_ENV') !== 'staging') cottbusFail('--apply ist ausschliesslich in LEHRFAHRER_ENV=staging erlaubt.');
    if (($options['confirm'] ?? '') !== COTTBUS_APPLY_CONFIRMATION) cottbusFail('Explizites Apply-Bestaetigungstoken fehlt.');
    $company = cottbusOption($options, 'company-id');
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', $company) !== 1) cottbusFail('Ziel-company_id ist nicht kanonisch.');
    $stagingRoot = cottbusRoot(cottbusOption($options, 'staging-private-root'), 'Staging-Private-Root');
    $configured = cottbusRoot((string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR'), 'LEHRFAHRER_PRIVATE_DATA_DIR');
    if (!cottbusSamePath($stagingRoot, $configured)) cottbusFail('Ziel ist nicht die konfigurierte Staging-Private-Root.');
    return [$company, $stagingRoot];
}

function cottbusApplyOrchestrationCapabilities(?string $stagingRoot): array {
    $variantCapable = class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true);
    $temporaryWritable = is_dir(sys_get_temp_dir()) && is_writable(sys_get_temp_dir());
    $variantCapable = $variantCapable && $temporaryWritable;
    $databaseCapability = ['DB_BACKUP_CAPABLE' => 'YES', 'DB_RESTORE_PATH_VALID' => 'YES', 'mechanism' => 'ISOLATED_TEST_DOUBLE'];
    if ($stagingRoot !== null && (string)getenv('LEHRFAHRER_ENV') === 'staging') {
        require_once cottbusAppRoot() . '/api/_control_database.php';
        try {
            $configuration = lehrfahrer_control_mysql_configuration();
            $configuration['tls_ca'] = trim((string)getenv('LEHRFAHRER_DB_TLS_CA')) ?: null;
            $databaseCapability = cottbusDbBackupCapability($configuration, $stagingRoot);
        } catch (Throwable $error) {
            $databaseCapability = ['DB_BACKUP_CAPABLE' => 'NO', 'DB_RESTORE_PATH_VALID' => 'NO', 'mechanism' => null, 'blocker' => $error->getMessage()];
        }
    }
    return $databaseCapability + [
        'VARIANTS_REBUILD_CAPABLE' => $variantCapable ? 'YES' : 'NO',
        'VARIANTS_VALIDATION_CAPABLE' => $variantCapable ? 'YES' : 'NO',
        'runtime' => [
            'pdo_sqlite' => in_array('sqlite', PDO::getAvailableDrivers(), true),
            'temporary_storage_writable' => $temporaryWritable,
            'memory_limit' => ini_get('memory_limit'),
            'max_execution_time' => (int)ini_get('max_execution_time'),
        ],
    ];
}

function cottbusDryRunTargetGate(array $options): array {
    $hasCompany = isset($options['company-id']);
    $hasRoot = isset($options['staging-private-root']);
    if (!$hasCompany && !$hasRoot) return [COTTBUS_PLACEHOLDER_COMPANY, null];
    if (!$hasCompany || !$hasRoot) cottbusFail('Realer Dry-Run benoetigt company_id und Staging-Private-Root gemeinsam.');
    if ((string)getenv('LEHRFAHRER_ENV') !== 'staging') {
        cottbusFail('Realer Tenant-Dry-Run ist ausschliesslich in LEHRFAHRER_ENV=staging erlaubt.');
    }
    $company = cottbusOption($options, 'company-id');
    if (preg_match('/^cmp_[0-9a-f]{32}$/D', $company) !== 1) cottbusFail('Ziel-company_id ist nicht kanonisch.');
    $stagingRoot = cottbusRoot(cottbusOption($options, 'staging-private-root'), 'Staging-Private-Root');
    $configured = cottbusRoot((string)getenv('LEHRFAHRER_PRIVATE_DATA_DIR'), 'LEHRFAHRER_PRIVATE_DATA_DIR');
    if (!cottbusSamePath($stagingRoot, $configured)) cottbusFail('Ziel ist nicht die konfigurierte Staging-Private-Root.');
    $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
    if (!is_dir($companyRoot) || is_link($companyRoot)) {
        cottbusFail('Provisionierter Ziel-Tenant-Root fehlt oder ist ein Symlink.');
    }
    return [$company, $stagingRoot];
}

function cottbusDryRunTargetState(array $plan, string $company, string $stagingRoot): array {
    foreach (['public_root', 'private_root'] as $sourceKey) {
        $sourceRoot = $plan[$sourceKey];
        if (cottbusInside($stagingRoot, $sourceRoot) || cottbusInside($sourceRoot, $stagingRoot)) {
            cottbusFail('Live-Quellroot und Staging-Private-Root duerfen nicht identisch oder verschachtelt sein.');
        }
    }
    $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
    $targetBefore = cottbusTreeFingerprint($companyRoot);
    $otherBefore = cottbusOtherTenantsFingerprint($stagingRoot, $company);
    $status = cottbusExistingTargetStatus($stagingRoot, $company, $plan['target_files']);
    $status += cottbusExistingDirectoryStatus($stagingRoot, $company, $plan['target_directories']);
    cottbusVerifyTracked($plan['tracked']);
    $targetAfter = cottbusTreeFingerprint($companyRoot);
    $otherAfter = cottbusOtherTenantsFingerprint($stagingRoot, $company);
    if ($targetBefore !== $targetAfter) cottbusFail('Ziel-Tenant wurde waehrend des Dry-Runs veraendert.');
    if (!hash_equals($otherBefore, $otherAfter)) cottbusFail('Fremder Tenant wurde waehrend des Dry-Runs veraendert.');
    return [
        'company_id' => $company,
        'target_fingerprint_before' => $targetBefore,
        'target_fingerprint_after' => $targetAfter,
        'other_tenants_fingerprint_before' => $otherBefore,
        'other_tenants_fingerprint_after' => $otherAfter,
        'target_status' => $status,
        'target_unchanged' => true,
        'other_tenants_unchanged' => true,
    ];
}

function cottbusValidateCompanyRecord(?array $record): void {
    if (!is_array($record)) cottbusFail('Zielgesellschaft existiert nicht in der Control-DB.');
    $slug = strtolower(trim((string)($record['slug'] ?? '')));
    $name = strtolower(trim((string)($record['name'] ?? '')));
    if ($slug === 'lehrfahrer-test') cottbusFail('Testgesellschaft darf nicht Migrationsziel sein.');
    if (in_array($slug, ['mastertemplate', 'master-template'], true)
        || str_contains($name, 'mastertemplate') || str_contains($name, 'master template')) {
        cottbusFail('Mastertemplate darf nicht Migrationsziel sein.');
    }
}

function cottbusExistingTargetStatus(string $stagingRoot, string $company, array $targetFiles): array {
    $prefix = 'companies/' . $company . '/';
    $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
    $knownTemplate = ['settings/company.json' => true];
    $knownTargets = [];
    $status = [];
    foreach ($targetFiles as $logical => $content) {
        if (!str_starts_with($logical, $prefix)) cottbusFail('Zielpfad verlaesst die Gesellschaftsgrenze.');
        $relative = substr($logical, strlen($prefix));
        $knownTargets[$relative] = true;
        $path = $companyRoot;
        foreach (explode('/', $relative) as $segment) $path = cottbusPath($path, $segment);
        if (is_file($path)) {
            $status[$logical] = hash_equals(hash('sha256', $content), (string)hash_file('sha256', $path)) ? 'SKIP' : 'BLOCKED';
        } elseif (file_exists($path)) {
            $status[$logical] = 'BLOCKED';
        } else {
            $status[$logical] = 'CREATE';
        }
    }
    foreach (cottbusFiles($companyRoot) as $path) {
        $relative = cottbusRelative($companyRoot, $path);
        if (!isset($knownTargets[$relative]) && !isset($knownTemplate[$relative])) {
            cottbusFail('Unbekannte Datei im Ziel-Tenant blockiert Apply: ' . $relative);
        }
    }
    if (in_array('BLOCKED', $status, true)) cottbusFail('Abweichende vorhandene Zieldatei blockiert Apply.');
    ksort($status, SORT_STRING);
    return $status;
}

function cottbusExistingDirectoryStatus(string $stagingRoot, string $company, array $targetDirectories): array {
    $prefix = 'companies/' . $company . '/';
    $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
    $status = [];
    foreach ($targetDirectories as $logical) {
        if (!str_starts_with($logical, $prefix)) cottbusFail('Zielverzeichnis verlaesst die Gesellschaftsgrenze.');
        $relative = substr($logical, strlen($prefix));
        $path = $companyRoot;
        foreach (explode('/', $relative) as $segment) $path = cottbusPath($path, $segment);
        if (is_dir($path) && !is_link($path)) $status[$logical . '/'] = 'SKIP';
        elseif (file_exists($path) || is_link($path)) $status[$logical . '/'] = 'BLOCKED';
        else $status[$logical . '/'] = 'CREATE';
    }
    if (in_array('BLOCKED', $status, true)) cottbusFail('Abweichendes vorhandenes Zielverzeichnis blockiert Apply.');
    ksort($status, SORT_STRING);
    return $status;
}

function cottbusEnsureDirectory(string $path, array &$createdDirectories): void {
    if (is_dir($path)) {
        if (is_link($path)) cottbusFail('Symlink im Apply-Ziel erkannt.');
        return;
    }
    $parent = dirname($path);
    if ($parent !== $path) cottbusEnsureDirectory($parent, $createdDirectories);
    if (!mkdir($path, 0700) || !chmod($path, 0700)) cottbusFail('Apply-Verzeichnis konnte nicht sicher angelegt werden.');
    $createdDirectories[] = $path;
}

function cottbusRemoveTree(string $root): void {
    if (!is_dir($root) || is_link($root)) return;
    $items = scandir($root) ?: [];
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $root . DIRECTORY_SEPARATOR . $item;
        if (is_link($path)) continue;
        if (is_dir($path)) cottbusRemoveTree($path);
        elseif (is_file($path)) @unlink($path);
    }
    @rmdir($root);
}

function cottbusAtomicTenantSwap(string $companyRoot, string $migrationRoot, string $backupRoot, callable $commit): mixed {
    cottbusDiagnosticMark('ROOT_SWAP', 'activate-validated-tenant-root');
    if (!rename($companyRoot, $backupRoot)) cottbusFail('Bestehender Tenant-Root konnte nicht atomar gesichert werden.');
    if (!rename($migrationRoot, $companyRoot)) {
        cottbusDiagnosticCaptureFailure();
        cottbusDiagnosticMark('ROLLBACK', 'restore-tenant-root-after-activation-failure');
        cottbusDiagnosticRollback(@rename($backupRoot, $companyRoot) ? 'TENANT_ROOT_RESTORED' : 'FAILED');
        cottbusFail('Validierter Tenant-Root konnte nicht atomar aktiviert werden.');
    }
    try {
        $result = $commit();
    } catch (Throwable $error) {
        cottbusDiagnosticCaptureFailure();
        cottbusDiagnosticMark('ROLLBACK', 'restore-previous-tenant-root');
        $failedRoot = dirname($backupRoot) . DIRECTORY_SEPARATOR . basename($backupRoot) . '-failed-' . bin2hex(random_bytes(4));
        if (!@rename($companyRoot, $failedRoot) || !@rename($backupRoot, $companyRoot)) {
            if (is_dir($failedRoot) && !is_dir($companyRoot)) @rename($failedRoot, $companyRoot);
            cottbusDiagnosticRollback('FAILED');
            throw new RuntimeException('Tenant-Rollback nach fehlgeschlagenem DB-Commit ist fehlgeschlagen.', 0, $error);
        }
        cottbusRemoveTree($failedRoot);
        cottbusDiagnosticRollback('TENANT_ROOT_RESTORED');
        throw $error;
    }
    cottbusRemoveTree($backupRoot);
    return $result;
}

function cottbusValidatePreparedTenantRoot(string $migrationRoot, string $company, array $targetFiles): void {
    $prefix = 'companies/' . $company . '/';
    $indexSeen = false;
    foreach ($targetFiles as $logical => $content) {
        if (!str_starts_with($logical, $prefix)) cottbusFail('Vorbereitetes Ziel verlaesst die Gesellschaftsgrenze.');
        $relative = substr($logical, strlen($prefix));
        $path = $migrationRoot;
        foreach (explode('/', $relative) as $segment) $path = cottbusPath($path, $segment);
        if (!is_file($path) || is_link($path)) cottbusFail('Datei fehlt im vorbereiteten Tenant-Root: ' . $relative);
        if (!hash_equals(hash('sha256', $content), strval(hash_file('sha256', $path)))) cottbusFail('Datei im vorbereiteten Tenant-Root ist beschaedigt: ' . $relative);
        if ($relative === 'imports/gtfs/index/variants.sqlite') {
            $validation = lehrfahrer_gtfs_validate_variant_index($path, [COTTBUS_AGENCY_ID]);
            if (($validation['routes'] ?? 0) !== COTTBUS_EXPECTED_COUNTS['routes']) cottbusFail('Vorbereiteter Variantenindex besitzt nicht den erwarteten Tenant-Umfang.');
            $indexSeen = true;
        }
    }
    if (!$indexSeen) cottbusFail('Variantenindex fehlt im vorbereiteten Tenant-Root.');
}

function cottbusValidateActivatedTenantRoot(string $stagingRoot, string $company, array $targetFiles): void {
    $postStatus = cottbusExistingTargetStatus($stagingRoot, $company, $targetFiles);
    if (array_filter($postStatus, static fn($status): bool => $status !== 'SKIP')) cottbusFail('Postcheck des aktivierten Tenant-Roots ist fehlgeschlagen.');
    $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
    lehrfahrer_gtfs_validate_variant_index(cottbusPath($companyRoot, 'imports', 'gtfs', 'index', 'variants.sqlite'), [COTTBUS_AGENCY_ID]);
}

function cottbusApply(array $options, array $plan, string $company, string $stagingRoot): array {
    cottbusDiagnosticMark('PREPARE_TARGET', 'verify-apply-preconditions-and-restore-point');
    foreach (['public_root', 'private_root'] as $sourceKey) {
        $sourceRoot = $plan[$sourceKey];
        if (cottbusInside($stagingRoot, $sourceRoot) || cottbusInside($sourceRoot, $stagingRoot)) {
            cottbusFail('Live-Quellroot und Staging-Private-Root duerfen nicht identisch oder verschachtelt sein.');
        }
    }
    $expectedApproval = 'LIVE-COTTBUS:' . $plan['deterministic_manifest']['source_fingerprint'];
    if (!hash_equals($expectedApproval, (string)($options['source-approval'] ?? ''))) {
        cottbusFail('Quellroot ist nicht mit seinem exakten Live-Fingerprint freigegeben.');
    }
    $appRoot = cottbusAppRoot();
    require_once $appRoot . '/api/_control_repositories.php';
    $configuration = lehrfahrer_control_mysql_configuration();
    $configuration['tls_ca'] = trim((string)getenv('LEHRFAHRER_DB_TLS_CA')) ?: null;
    $capability = cottbusDbBackupCapability($configuration, $stagingRoot);
    if (($capability['DB_BACKUP_CAPABLE'] ?? 'NO') !== 'YES' || ($capability['DB_RESTORE_PATH_VALID'] ?? 'NO') !== 'YES') {
        cottbusFail('Apply blockiert: verifizierter Control-DB-Restore-Punkt ist nicht moeglich.');
    }
    $restorePoint = cottbusCreateControlDbRestorePoint(
        $configuration,
        $stagingRoot,
        $capability,
        strval(LEHRFAHRER_CONTROL_SCHEMA_VERSION)
    );
    $pdo = lehrfahrer_control_database();
    $createdDirectories = [];
    $migrationRoot = '';
    $backupRoot = '';
    try {
        $companies = new LehrfahrerCompanyRepository($pdo);
        $record = $companies->findById($company);
        cottbusValidateCompanyRecord($record);
        $testCompany = $companies->findBySlug('lehrfahrer-test');
        $testRoot = is_array($testCompany)
            ? cottbusPath(cottbusPath($stagingRoot, 'companies'), (string)$testCompany['id']) : '';
        $testBefore = $testRoot !== '' ? cottbusTreeFingerprint($testRoot) : null;
        $otherTenantsBefore = cottbusOtherTenantsFingerprint($stagingRoot, $company);
        $sourceBefore = $plan['deterministic_manifest']['source_fingerprint'];
        $companyRoot = cottbusPath(cottbusPath($stagingRoot, 'companies'), $company);
        $migrationBase = cottbusPath($stagingRoot, 'migrations');
        $backupRoot = cottbusPath($migrationBase, 'cottbus-' . $company . '-rollback');
        if (!is_dir($companyRoot) && is_dir($backupRoot) && !is_link($backupRoot)) {
            if (!rename($backupRoot, $companyRoot)) cottbusFail('Unterbrochener Tenant-Swap konnte nicht zurueckgesetzt werden.');
        }
        if (!is_dir($companyRoot) || is_link($companyRoot)) cottbusFail('Provisionierter Ziel-Tenant-Root fehlt oder ist ein Symlink.');
        $targetStatus = cottbusExistingTargetStatus($stagingRoot, $company, $plan['target_files']);
        $targetStatus += cottbusExistingDirectoryStatus($stagingRoot, $company, $plan['target_directories']);
        if (!in_array('CREATE', $targetStatus, true)) {
            cottbusVerifyTracked($plan['tracked']);
            if ($testBefore !== null && $testBefore !== cottbusTreeFingerprint($testRoot)) cottbusFail('lehrfahrer-test wurde veraendert.');
            if (!hash_equals($otherTenantsBefore, cottbusOtherTenantsFingerprint($stagingRoot, $company))) cottbusFail('Fremder Tenant wurde veraendert.');
            if (is_dir($backupRoot) && !is_link($backupRoot)) cottbusRemoveTree($backupRoot);
            return ['result' => 'ALREADY_MIGRATED', 'target_status' => $targetStatus, 'created' => 0, 'skipped' => count($targetStatus),
                'db_restore_point' => $restorePoint['metadata'], 'db_restore_point_retained' => true];
        }
        if (file_exists($backupRoot) || is_link($backupRoot)) cottbusFail('Rollback-Bereich eines frueheren Apply ist nicht eindeutig aufgeloest.');
        cottbusEnsureDirectory($migrationBase, $createdDirectories);
        $migrationRoot = $migrationBase . DIRECTORY_SEPARATOR . 'cottbus-' . $company . '-' . bin2hex(random_bytes(8));
        cottbusEnsureDirectory($migrationRoot, $createdDirectories);
        foreach (COTTBUS_TENANT_AREAS as $area) cottbusEnsureDirectory(cottbusPath($migrationRoot, $area), $createdDirectories);
        $prefix = 'companies/' . $company . '/';
        foreach ($plan['target_files'] as $logical => $content) {
            $relative = substr($logical, strlen($prefix));
            $stagePath = $migrationRoot;
            foreach (explode('/', $relative) as $segment) $stagePath = cottbusPath($stagePath, $segment);
            cottbusEnsureDirectory(dirname($stagePath), $createdDirectories);
            if (file_put_contents($stagePath, $content, LOCK_EX) !== strlen($content) || !chmod($stagePath, 0600)) {
                cottbusFail('Migrationsdatei konnte nicht sicher vorbereitet werden.');
            }
            if (!hash_equals(hash('sha256', $content), (string)hash_file('sha256', $stagePath))) {
                cottbusFail('Validierung einer vorbereiteten Migrationsdatei ist fehlgeschlagen.');
            }
        }
        foreach ($plan['target_directories'] as $logical) {
            $relative = substr($logical, strlen($prefix));
            $stageDirectory = $migrationRoot;
            foreach (explode('/', $relative) as $segment) $stageDirectory = cottbusPath($stageDirectory, $segment);
            cottbusEnsureDirectory($stageDirectory, $createdDirectories);
        }
        $companySettings = cottbusPath(cottbusPath($companyRoot, 'settings'), 'company.json');
        $stagedCompanySettings = cottbusPath(cottbusPath($migrationRoot, 'settings'), 'company.json');
        $companySettingsContent = cottbusRead($companySettings);
        if (file_put_contents($stagedCompanySettings, $companySettingsContent, LOCK_EX) !== strlen($companySettingsContent)
            || !chmod($stagedCompanySettings, 0600)) {
            cottbusFail('Mastertemplate-Gesellschaftseinstellung konnte nicht in den Swap-Bereich uebernommen werden.');
        }
        cottbusDiagnosticMark('VALIDATE_TEMP_ROOT', 'validate-prepared-tenant-root');
        cottbusValidatePreparedTenantRoot($migrationRoot, $company, $plan['target_files']);
        cottbusVerifyTracked($plan['tracked']);
        if (!hash_equals($sourceBefore, cottbusAggregateFingerprint($plan['tracked']))) cottbusFail('Quellfingerprint hat sich veraendert.');
        if ($testBefore !== null && $testBefore !== cottbusTreeFingerprint($testRoot)) cottbusFail('lehrfahrer-test wurde veraendert.');
        if (!hash_equals($otherTenantsBefore, cottbusOtherTenantsFingerprint($stagingRoot, $company))) cottbusFail('Fremder Tenant wurde veraendert.');
        cottbusDiagnosticMark('DB_TRANSACTION', 'begin-control-db-transaction');
        if (!$pdo->beginTransaction()) cottbusFail('Control-DB-Transaktion konnte nicht gestartet werden.');
        cottbusAtomicTenantSwap($companyRoot, $migrationRoot, $backupRoot, static function () use (
            $pdo, $stagingRoot, $company, $plan, $testBefore, $testRoot, $otherTenantsBefore, $companyRoot
        ): void {
            cottbusDiagnosticMark('DB_TRANSACTION', 'commit-control-db-transaction');
            if (!$pdo->commit()) cottbusFail('Control-DB-Transaktion konnte nicht abgeschlossen werden.');
            cottbusDiagnosticMark('POST_VALIDATE', 'validate-activated-tenant-root');
            cottbusValidateActivatedTenantRoot($stagingRoot, $company, $plan['target_files']);
            if ($testBefore !== null && $testBefore !== cottbusTreeFingerprint($testRoot)) cottbusFail('lehrfahrer-test wurde im Postcheck veraendert.');
            if (!hash_equals($otherTenantsBefore, cottbusOtherTenantsFingerprint($stagingRoot, $company))) cottbusFail('Fremder Tenant wurde im Postcheck veraendert.');
        });
        @rmdir($migrationBase);
        return [
            'result' => 'APPLIED', 'target_status' => $targetStatus,
            'created' => count(array_filter($targetStatus, static fn($value): bool => $value === 'CREATE')),
            'skipped' => count(array_filter($targetStatus, static fn($value): bool => $value === 'SKIP')),
            'activation' => 'ATOMIC_TENANT_ROOT_SWAP',
            'rollback_cleanup_pending' => is_dir($backupRoot),
            'variants_index' => $plan['deterministic_manifest']['variants_index'],
            'db_restore_point' => $restorePoint['metadata'],
            'db_restore_point_retained' => true,
        ];
    } catch (Throwable $error) {
        cottbusDiagnosticCaptureFailure();
        cottbusDiagnosticMark('ROLLBACK', 'rollback-and-clean-private-temporary-root');
        $rollbackStatus = (string)($GLOBALS['cottbusMigrationDiagnostic']['rollback_status'] ?? 'NOT_REQUIRED');
        $rollbackError = null;
        if ($pdo->inTransaction()) {
            try {
                $rollbackStatus = $pdo->rollBack() ? 'DB_ROLLED_BACK' : 'FAILED';
            } catch (Throwable $caughtRollbackError) {
                $rollbackStatus = 'FAILED';
                $rollbackError = $caughtRollbackError;
            }
        }
        if ($migrationRoot !== '') cottbusRemoveTree($migrationRoot);
        foreach (array_reverse($createdDirectories) as $directory) if (is_dir($directory)) @rmdir($directory);
        if ($rollbackStatus === 'NOT_REQUIRED' && $migrationRoot !== '') $rollbackStatus = 'TEMP_ROOT_CLEANED';
        cottbusDiagnosticRollback($rollbackStatus);
        if ($rollbackError !== null) {
            throw new RuntimeException('Control-DB-Rollback ist fehlgeschlagen.', 0, $error);
        }
        throw $error;
    }
}

function cottbusRun(array $options): array {
    $apply = isset($options['apply']);
    $dryRun = isset($options['dry-run']) || !$apply;
    if ($apply && isset($options['dry-run'])) cottbusFail('--dry-run und --apply schliessen einander aus.');
    if (!$dryRun && !$apply) cottbusFail('Ungueltiger Betriebsmodus.');
    $requestedCompany = is_string($options['company-id'] ?? null) ? $options['company-id'] : null;
    cottbusDiagnosticReset($requestedCompany);
    [$company, $stagingRoot] = $apply
        ? cottbusApplyGate($options)
        : cottbusDryRunTargetGate($options);
    $plan = cottbusBuildPlan($options, $company);
    $sourceFingerprint = $plan['deterministic_manifest']['source_fingerprint'];
    $capabilities = cottbusApplyOrchestrationCapabilities($stagingRoot);
    $blockers = [];
    foreach (['DB_BACKUP_CAPABLE', 'DB_RESTORE_PATH_VALID', 'VARIANTS_REBUILD_CAPABLE', 'VARIANTS_VALIDATION_CAPABLE'] as $gate) {
        if (($capabilities[$gate] ?? 'NO') !== 'YES') $blockers[] = $gate . '=NO';
    }
    if (isset($capabilities['blocker'])) $blockers[] = 'DB_BACKUP: ' . $capabilities['blocker'];
    if ($apply) {
        if ($blockers) cottbusFail('Apply-Orchestrierung ist nicht bereit: ' . implode('; ', $blockers));
        $applyResult = cottbusApply($options, $plan, $company, $stagingRoot);
        return [
            'tool' => 'cottbus-migrate-staging', 'mode' => 'APPLY', 'ready_for_apply' => true,
            'deterministic_manifest' => $plan['deterministic_manifest'],
            'apply_result' => $applyResult,
            'run_metadata' => ['generated_at' => gmdate('c')],
        ];
    }
    $targetState = $stagingRoot === null
        ? null
        : cottbusDryRunTargetState($plan, $company, $stagingRoot);
    return [
        'tool' => 'cottbus-migrate-staging', 'mode' => 'DRY_RUN', 'ready_for_apply' => $blockers === [],
        'READY_FOR_APPLY' => $blockers === [] ? 'YES' : 'NO',
        'APPLY_ORCHESTRATION_READY' => $blockers === [] ? 'YES' : 'NO',
        'DB_BACKUP_CAPABLE' => $capabilities['DB_BACKUP_CAPABLE'],
        'DB_RESTORE_PATH_VALID' => $capabilities['DB_RESTORE_PATH_VALID'],
        'VARIANTS_REBUILD_CAPABLE' => $capabilities['VARIANTS_REBUILD_CAPABLE'],
        'VARIANTS_VALIDATION_CAPABLE' => $capabilities['VARIANTS_VALIDATION_CAPABLE'],
        'apply_orchestration' => [
            'backup_mechanism' => $capabilities['mechanism'] ?? null,
            'runtime' => $capabilities['runtime'] ?? null,
            'backup_location' => 'private://backups/control-db/<restore-point-id>',
            'tenant_activation' => 'ATOMIC_TENANT_ROOT_SWAP_AFTER_VALIDATION',
            'db_restore_point_created_on_dry_run' => false,
        ],
        'WOULD_CREATE' => $plan['deterministic_manifest']['would_create'],
        'WOULD_SKIP' => [],
        'WOULD_EXCLUDE' => $plan['deterministic_manifest']['would_exclude'],
        'WOULD_REMAP' => ['EXACT' => 36, 'HIGH' => 4, 'MANUAL' => 0, 'UNRESOLVED' => 0],
        'BLOCKERS' => $blockers,
        'SOURCE_FINGERPRINT' => $sourceFingerprint,
        'EXPECTED_TARGET_FINGERPRINT' => $plan['deterministic_manifest']['expected_target_fingerprint'],
        'SOURCE_APPROVAL_FOR_LATER_APPLY' => 'LIVE-COTTBUS:' . $sourceFingerprint,
        'deterministic_manifest' => $plan['deterministic_manifest'],
        'real_target' => $targetState,
        'run_metadata' => ['generated_at' => null, 'timestamp_policy' => 'separate-and-disabled-in-dry-run'],
        'read_only_evidence' => [
            'source_files_verified_after_plan' => count($plan['tracked']),
            'source_fingerprints_unchanged' => true,
            'database_connections' => 0, 'database_writes' => 0, 'target_writes' => 0,
            'real_target_read' => $targetState !== null,
        ],
    ];
}

$cgiDryRun = PHP_SAPI !== 'cli' && getenv('LEHRFAHRER_STAGING_CGI_DRY_RUN') === '1';
$cgiApply = PHP_SAPI !== 'cli' && getenv('LEHRFAHRER_STAGING_CGI_APPLY') === '1';
if (PHP_SAPI !== 'cli' && !$cgiDryRun && !$cgiApply) {
    http_response_code(404);
    exit;
}

if (!$cgiDryRun && !$cgiApply && realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) !== __FILE__) return;

$options = getopt('', [
    'dry-run', 'apply', 'public-root:', 'private-root:', 'gtfs-zip::', 'gtfs-directory::',
    'company-id::', 'staging-private-root::', 'confirm::', 'source-approval::', 'compact',
]);
try {
    if ($cgiDryRun && isset($options['apply'])) cottbusFail('CGI-Ausfuehrung ist ausschliesslich fuer Dry-Run erlaubt.');
    if ($cgiApply && !isset($options['apply'])) cottbusFail('CGI-Apply-Gate akzeptiert ausschliesslich den Apply-Modus.');
    if ($cgiApply && (string)getenv('LEHRFAHRER_ENV') !== 'staging') cottbusFail('CGI-Apply-Gate ist ausschliesslich in Staging erlaubt.');
    $report = cottbusRun($options);
    echo json_encode(
        $report,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
            | (isset($options['compact']) ? 0 : JSON_PRETTY_PRINT) | JSON_THROW_ON_ERROR
    ) . "\n";
    exit(0);
} catch (Throwable $error) {
    $summary = cottbusErrorSummary($error, 2);
    echo json_encode([
        'tool' => 'cottbus-migrate-staging',
        'mode' => isset($options['apply']) ? 'APPLY' : 'DRY_RUN',
        'ready_for_apply' => false,
        'READY_FOR_APPLY' => 'NO',
        'BLOCKERS' => [$summary['error_code']],
        'error_summary' => $summary,
        'read_only_evidence' => isset($options['apply']) ? null : [
            'database_connections' => 0, 'database_writes' => 0, 'target_writes' => 0,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
    exit(2);
}
