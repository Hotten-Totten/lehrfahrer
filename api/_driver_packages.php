<?php

// PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.
require_once __DIR__ . '/_tenant_personnel_storage.php';

function driverPackageRoot(string $companyId, bool $create = false): string {
    return lehrfahrer_tenant_area($companyId, 'packages', $create);
}

function driverPackageFiles(string $companyId): array {
    $root = driverPackageRoot($companyId);
    if (!is_dir($root)) return [];
    $files = [];
    foreach (scandir($root) ?: [] as $entry) {
        if (!preg_match('/^pkg_[a-f0-9]{32}$/D', $entry)) continue;
        $file = lehrfahrer_tenant_path($companyId, 'packages', $entry . '/paket.json');
        if (is_file($file)) $files[] = $file;
    }
    return $files;
}

function driverPackageFind(string $companyId, string $requestedId): ?array {
    if (!preg_match('/^pkg_[a-f0-9]{32}$/D', $requestedId)) return null;
    $file = lehrfahrer_tenant_path($companyId, 'packages', $requestedId . '/paket.json');
    if (!is_file($file)) return null;
    $data = json_decode((string)file_get_contents($file), true);
    if (!is_array($data) || ($data['id'] ?? null) !== $requestedId) return null;
    return ['id' => $requestedId, 'storedId' => $requestedId, 'file' => $file, 'dir' => dirname($file), 'data' => $data];
}

function driverPackageNewId(string $companyId): string {
    do { $id = 'pkg_' . bin2hex(random_bytes(16)); }
    while (driverPackageFind($companyId, $id) !== null);
    return $id;
}

function driverPackageDeleteDirectory(string $companyId, string $packageId): bool {
    $package = driverPackageFind($companyId, $packageId);
    if ($package === null) return false;
    foreach (scandir($package['dir']) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $file = lehrfahrer_tenant_path($companyId, 'packages', $packageId . '/' . $entry);
        if (!is_file($file) || !@unlink($file)) return false;
    }
    if (!@rmdir($package['dir'])) return false;
    $documentDir = lehrfahrer_tenant_path($companyId, 'documents', $packageId);
    if (is_dir($documentDir)) {
        foreach (scandir($documentDir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $file = lehrfahrer_personnel_document_file($companyId, $packageId, $entry);
            if ($file === null || !is_file($file) || !@unlink($file)) return false;
        }
        if (!@rmdir($documentDir)) return false;
    }
    return true;
}
