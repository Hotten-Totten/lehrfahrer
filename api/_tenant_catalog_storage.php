<?php

// PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.
require_once __DIR__ . '/_tenant_route_storage.php';

function lehrfahrer_catalog_file(string $companyId, bool $create = false): string {
    return lehrfahrer_tenant_path($companyId, 'catalogs', 'haltestellen.json', $create);
}

function lehrfahrer_catalog_load(string $companyId): array {
    $file = lehrfahrer_catalog_file($companyId);
    if (!is_file($file)) return [];
    $catalog = json_decode((string)file_get_contents($file), true);
    return is_array($catalog) && array_is_list($catalog) ? $catalog : [];
}

function lehrfahrer_catalog_save(string $companyId, array $stops): bool {
    $file = lehrfahrer_catalog_file($companyId, true);
    $temporary = lehrfahrer_tenant_path($companyId, 'catalogs', 'haltestellen.json.tmp', true);
    $json = json_encode(array_values($stops), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($temporary, $json, LOCK_EX) === false) return false;
    if (@rename($temporary, $file)) return true;
    @unlink($temporary);
    return false;
}
