<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_driver_packages.php';
lehrfahrer_require_write_auth();

$root = driverPackageRoot();
$packages = [];

if (is_dir($root)) {
    foreach (glob($root . '/*/*/paket.json') ?: [] as $packageFile) {
        $data = json_decode((string)@file_get_contents($packageFile), true);
        if (!is_array($data)) continue;

        $relativePath = str_replace('\\', '/', substr($packageFile, strlen(dirname(__DIR__)) + 1));
        $documents = [];
        foreach (($data['documents'] ?? []) as $document) {
            if (!is_array($document)) continue;
            $documents[] = [
                'lineName' => trim((string)($document['lineName'] ?? '')),
                'routeName' => trim((string)($document['routeName'] ?? '')),
                'variantName' => trim((string)($document['variantName'] ?? '')),
                'path' => trim((string)($document['path'] ?? ''))
            ];
        }

        $packages[] = [
            'id' => trim((string)($data['id'] ?? '')) ?: driverPackageLegacyId($packageFile),
            'driverName' => trim((string)($data['driverName'] ?? '')),
            'created' => trim((string)($data['created'] ?? ($data['createdAt'] ?? ''))) ?: date('c', (int)filemtime($packageFile)),
            'updated' => trim((string)($data['updated'] ?? ($data['createdAt'] ?? ''))) ?: date('c', (int)filemtime($packageFile)),
            'version' => (int)($data['version'] ?? 1),
            'status' => 'Erstellt',
            'documentCount' => count($documents),
            'documents' => $documents,
            'selectedItems' => is_array($data['selectedItems'] ?? null) ? $data['selectedItems'] : [],
            'packagePath' => $relativePath
        ];
    }
}

usort($packages, static function (array $a, array $b): int {
    return strcmp($b['created'], $a['created']);
});

echo json_encode([
    'ok' => true,
    'packages' => $packages
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
