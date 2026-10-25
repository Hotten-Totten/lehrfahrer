<?php

// PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.
require_once __DIR__ . '/_api_authorization.php';
require_once __DIR__ . '/_tenant_storage.php';

function lehrfahrer_route_company_id(array $auth): string {
    if (($auth['mode'] ?? '') === 'session') {
        return lehrfahrer_tenant_company_id((string)($auth['session']['company_id'] ?? ''));
    }
    if (($auth['mode'] ?? '') !== 'legacy-token') {
        throw new RuntimeException('Kein autorisierter Gesellschaftskontext.');
    }
    // Explicit server configuration only. No request value or "first company" fallback.
    $id = trim((string)getenv('LEHRFAHRER_LEGACY_COMPANY_ID'));
    try {
        lehrfahrer_tenant_company_id($id);
        $pdo = lehrfahrer_control_database();
        $company = (new LehrfahrerCompanyRepository($pdo))->findById($id);
        if (is_array($company) && ($company['status'] ?? '') === 'active') return $id;
    } catch (Throwable $error) {
        error_log('Legacy-Startgesellschaft ist nicht konfiguriert oder ungueltig.');
    }
    lehrfahrer_api_authorization_error(503, 'Legacy-Startgesellschaft ist nicht verfuegbar.');
}

function lehrfahrer_route_authorize(
    string $capability,
    bool $mutation = false,
    bool $allowLegacyParameterFallback = false
): string {
    return lehrfahrer_route_company_id(
        lehrfahrer_api_authorize($capability, $mutation, $allowLegacyParameterFallback)
    );
}

function lehrfahrer_route_segment(string $value): string {
    $segments = lehrfahrer_tenant_segments($value);
    if (count($segments) !== 1) throw new InvalidArgumentException('Ungueltiger Fachpfadname.');
    return $segments[0];
}

function lehrfahrer_route_city_path(string $companyId, string $city, bool $create = false): string {
    return lehrfahrer_tenant_path($companyId, 'cities', lehrfahrer_route_segment($city), $create);
}

function lehrfahrer_route_line_city_path(string $companyId, string $city, bool $create = false): string {
    return lehrfahrer_tenant_path($companyId, 'lines', lehrfahrer_route_segment($city), $create);
}

function lehrfahrer_route_settings_path(string $companyId, bool $create = false): string {
    return lehrfahrer_tenant_path($companyId, 'settings', 'city_settings.json', $create);
}

function lehrfahrer_route_city_exists(string $companyId, string $city): bool {
    return is_dir(lehrfahrer_route_city_path($companyId, $city));
}

function lehrfahrer_route_city_slug(string $city): string {
    $slug = mb_strtolower(trim($city), 'UTF-8');
    $slug = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $slug);
    $slug = preg_replace('/[^a-z0-9_-]+/u', '-', $slug);
    $slug = trim(preg_replace('/-+/', '-', $slug), '-');
    if ($slug === '') throw new InvalidArgumentException('Ungültiger Ortsname.');
    return $slug;
}

function lehrfahrer_route_register_city(string $companyId, string $city): string {
    $slug = lehrfahrer_route_city_slug($city);
    lehrfahrer_tenant_ensure_directory($companyId, 'cities', $slug);
    lehrfahrer_tenant_ensure_directory($companyId, 'lines', $slug);
    return $slug;
}

function lehrfahrer_route_file(
    string $companyId,
    string $city,
    string $line,
    string $extension,
    string $lineFolder = '',
    string $categoryFolder = '',
    bool $createParents = false
): string {
    if (!in_array($extension, ['json', 'gpx', 'pdf'], true)) {
        throw new InvalidArgumentException('Ungueltige Routendateiendung.');
    }
    $parts = [lehrfahrer_route_segment($city)];
    if ($lineFolder !== '') $parts[] = lehrfahrer_route_segment($lineFolder);
    if ($categoryFolder !== '') {
        if ($lineFolder === '') throw new InvalidArgumentException('Kategorie ohne Linienordner.');
        $parts[] = lehrfahrer_route_segment($categoryFolder);
    }
    $parts[] = lehrfahrer_route_segment($line) . '.' . $extension;
    return lehrfahrer_tenant_path($companyId, 'lines', implode('/', $parts), $createParents);
}

function lehrfahrer_route_checked_path(string $companyId, string $absolutePath): string {
    $root = lehrfahrer_tenant_area($companyId, 'lines');
    $normalizedRoot = str_replace('\\', '/', $root);
    $normalizedPath = str_replace('\\', '/', $absolutePath);
    $prefix = $normalizedRoot . '/';
    $inside = DIRECTORY_SEPARATOR === '\\'
        ? strncasecmp($normalizedPath, $prefix, strlen($prefix)) === 0
        : str_starts_with($normalizedPath, $prefix);
    if (!$inside) throw new InvalidArgumentException('Pfad liegt ausserhalb des Linienbereichs.');
    return lehrfahrer_tenant_path($companyId, 'lines', substr($normalizedPath, strlen($prefix)));
}

function lehrfahrer_route_sibling_path(string $companyId, string $knownPath, string $fileName): string {
    lehrfahrer_route_segment($fileName);
    return lehrfahrer_route_checked_path(
        $companyId,
        dirname($knownPath) . DIRECTORY_SEPARATOR . $fileName
    );
}

function lehrfahrer_route_find_file(
    string $companyId,
    string $city,
    string $line,
    string $extension,
    string $lineFolder = '',
    string $categoryFolder = ''
): ?string {
    if (!lehrfahrer_route_city_exists($companyId, $city)) return null;
    $candidates = [];
    if ($lineFolder !== '' && $categoryFolder !== '') {
        $candidates[] = [$lineFolder, $categoryFolder];
    }
    if ($lineFolder !== '') $candidates[] = [$lineFolder, ''];
    $candidates[] = ['', ''];
    foreach ($candidates as [$folder, $category]) {
        $path = lehrfahrer_route_file($companyId, $city, $line, $extension, $folder, $category);
        if (is_file($path)) return $path;
    }
    return null;
}

function lehrfahrer_route_safe_entries(string $directory): array {
    if (!is_dir($directory)) return [];
    $entries = [];
    foreach (scandir($directory) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..' || is_link($directory . DIRECTORY_SEPARATOR . $entry)) continue;
        try { lehrfahrer_route_segment($entry); }
        catch (InvalidArgumentException $error) { continue; }
        $entries[] = $entry;
    }
    return $entries;
}
