<?php

require_once __DIR__ . '/_private_storage.php';

const LEHRFAHRER_TENANT_AREAS = [
    'lines', 'cities', 'drivers', 'trainings', 'packages',
    'documents', 'catalogs', 'settings', 'imports',
];

/**
 * The company ID must come from authenticated server-side context, never from
 * a request parameter passed through without authorization.
 */
function lehrfahrer_tenant_company_id(string $companyId): string {
    // LehrfahrerCompanyRepository generates cmp_ + 16 random bytes as lowercase hex.
    if (!preg_match('/^cmp_[0-9a-f]{32}$/D', $companyId)) {
        throw new InvalidArgumentException('Ungueltige Gesellschafts-ID.');
    }
    return $companyId;
}

function lehrfahrer_tenant_segments(string $relative): array {
    // Reject encoded input altogether: callers must pass plain server-side names.
    if ($relative === '' || str_contains($relative, "\0")
        || str_contains($relative, '\\') || str_contains($relative, '%')
        || str_starts_with($relative, '/')
        || preg_match('/^[a-zA-Z]:/', $relative)) {
        throw new InvalidArgumentException('Ungueltiger Tenant-Unterpfad.');
    }
    $segments = explode('/', $relative);
    foreach ($segments as $segment) {
        if ($segment === '.' || $segment === '..'
            || !preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/D', $segment)) {
            throw new InvalidArgumentException('Ungueltiger Tenant-Unterpfad.');
        }
    }
    return $segments;
}

function lehrfahrer_tenant_same_path(string $actual, string $expected): bool {
    $actual = lehrfahrer_private_normalize_path($actual);
    $expected = lehrfahrer_private_normalize_path($expected);
    return DIRECTORY_SEPARATOR === '\\'
        ? strcasecmp($actual, $expected) === 0
        : $actual === $expected;
}

function lehrfahrer_tenant_check_existing_path(string $path, bool $directory): void {
    clearstatcache(true, $path);
    if (is_link($path)) {
        throw new RuntimeException('Symbolischer Link im Tenant-Pfad nicht erlaubt.');
    }
    if (!file_exists($path)) return;
    if ($directory && !is_dir($path)) {
        throw new RuntimeException('Tenant-Pfad ist kein Verzeichnis.');
    }
    $resolved = realpath($path);
    if ($resolved === false || !lehrfahrer_tenant_same_path($resolved, $path)) {
        throw new RuntimeException('Tenant-Pfad verlaesst die erwartete Root-Grenze.');
    }
}

function lehrfahrer_tenant_walk_directory(string $base, array $segments, bool $create): string {
    $current = $base;
    foreach ($segments as $segment) {
        $current .= DIRECTORY_SEPARATOR . $segment;
        lehrfahrer_tenant_check_existing_path($current, true);
        if ($create && !is_dir($current)) {
            if (!@mkdir($current, 0700)) {
                throw new RuntimeException('Tenant-Verzeichnis konnte nicht angelegt werden.');
            }
            lehrfahrer_tenant_check_existing_path($current, true);
            @chmod($current, 0700);
        }
    }
    return $current;
}

function lehrfahrer_tenant_root(string $companyId, bool $create = false): string {
    $id = lehrfahrer_tenant_company_id($companyId);
    return lehrfahrer_tenant_walk_directory(
        lehrfahrer_private_storage_root(),
        ['companies', $id],
        $create
    );
}

function lehrfahrer_tenant_area(string $companyId, string $area, bool $create = false): string {
    if (!in_array($area, LEHRFAHRER_TENANT_AREAS, true)) {
        throw new InvalidArgumentException('Unbekannter Tenant-Bereich.');
    }
    return lehrfahrer_tenant_walk_directory(
        lehrfahrer_private_storage_root(),
        ['companies', lehrfahrer_tenant_company_id($companyId), $area],
        $create
    );
}

function lehrfahrer_tenant_path(
    string $companyId,
    string $area,
    string $relative,
    bool $createParentDirectories = false
): string {
    $segments = lehrfahrer_tenant_segments($relative);
    $base = lehrfahrer_tenant_area($companyId, $area, $createParentDirectories);
    $leaf = array_pop($segments);
    $parent = lehrfahrer_tenant_walk_directory($base, $segments, $createParentDirectories);
    $path = $parent . DIRECTORY_SEPARATOR . $leaf;
    lehrfahrer_tenant_check_existing_path($path, false);
    return $path;
}

function lehrfahrer_tenant_ensure_directory(
    string $companyId,
    string $area,
    string $relative
): string {
    $segments = lehrfahrer_tenant_segments($relative);
    $base = lehrfahrer_tenant_area($companyId, $area, true);
    return lehrfahrer_tenant_walk_directory($base, $segments, true);
}
