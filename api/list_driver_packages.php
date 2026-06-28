<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

$root = dirname(__DIR__) . '/fahrerunterlagen';
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
            'driverName' => trim((string)($data['driverName'] ?? '')),
            'createdAt' => trim((string)($data['createdAt'] ?? '')),
            'documentCount' => count($documents),
            'documents' => $documents,
            'packagePath' => $relativePath
        ];
    }
}

usort($packages, static function (array $a, array $b): int {
    return strcmp($b['createdAt'], $a['createdAt']);
});

echo json_encode([
    'ok' => true,
    'packages' => $packages
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
