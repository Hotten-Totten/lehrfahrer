<?php

function driverPackageRoot(): string {
    return dirname(__DIR__) . '/fahrerunterlagen';
}

function driverPackageLegacyId(string $packageFile): string {
    $relative = str_replace('\\', '/', substr($packageFile, strlen(driverPackageRoot()) + 1));
    return 'legacy_' . substr(hash('sha256', $relative), 0, 24);
}

function driverPackageFind(string $requestedId): ?array {
    if (!preg_match('/^[a-zA-Z0-9_-]{8,80}$/', $requestedId)) {
        return null;
    }
    foreach (glob(driverPackageRoot() . '/*/*/paket.json') ?: [] as $packageFile) {
        $data = json_decode((string)@file_get_contents($packageFile), true);
        if (!is_array($data)) continue;
        $storedId = trim((string)($data['id'] ?? ''));
        $effectiveId = $storedId !== '' ? $storedId : driverPackageLegacyId($packageFile);
        if (hash_equals($effectiveId, $requestedId)) {
            return [
                'id' => $effectiveId,
                'storedId' => $storedId,
                'file' => $packageFile,
                'dir' => dirname($packageFile),
                'data' => $data
            ];
        }
    }
    return null;
}

function driverPackageNewId(): string {
    do {
        $id = 'pkg_' . bin2hex(random_bytes(16));
    } while (driverPackageFind($id) !== null);
    return $id;
}

function driverPackageDeleteDirectory(string $directory): bool {
    $root = realpath(driverPackageRoot());
    $target = realpath($directory);
    if ($root === false || $target === false || !str_starts_with($target, $root . DIRECTORY_SEPARATOR)) {
        return false;
    }
    $items = scandir($target);
    if ($items === false) return false;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $target . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path)) {
            if (!driverPackageDeleteDirectory($path)) return false;
        } elseif (!@unlink($path)) {
            return false;
        }
    }
    return @rmdir($target);
}
