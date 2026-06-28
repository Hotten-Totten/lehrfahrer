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
                'directionName' => trim((string)($document['directionName'] ?? '')),
                'variantName' => trim((string)($document['variantName'] ?? '')),
                'variantCategory' => trim((string)($document['variantCategory'] ?? '')),
                'validFrom' => trim((string)($document['validFrom'] ?? '')),
                'validUntil' => trim((string)($document['validUntil'] ?? '')),
                'path' => trim((string)($document['path'] ?? ''))
            ];
        }

        $lineNames = [];
        $categories = [];
        $validity = [];
        foreach ($documents as $document) {
            if ($document['lineName'] !== '') $lineNames[$document['lineName']] = true;
            if ($document['variantCategory'] !== '') $categories[$document['variantCategory']] = true;
            $validityKey = $document['validFrom'] . '|' . $document['validUntil'];
            if ($validityKey !== '|') {
                $validity[$validityKey] = [
                    'validFrom' => $document['validFrom'],
                    'validUntil' => $document['validUntil']
                ];
            }
        }

        $packages[] = [
            'id' => trim((string)($data['id'] ?? '')) ?: driverPackageLegacyId($packageFile),
            'driverName' => trim((string)($data['driverName'] ?? '')),
            'created' => trim((string)($data['created'] ?? ($data['createdAt'] ?? ''))) ?: date('c', (int)filemtime($packageFile)),
            'updated' => trim((string)($data['updated'] ?? ($data['createdAt'] ?? ''))) ?: date('c', (int)filemtime($packageFile)),
            'version' => (int)($data['version'] ?? 1),
            'status' => 'Erstellt',
            'note' => trim((string)($data['note'] ?? ($data['description'] ?? ''))),
            'documentCount' => count($documents),
            'lineCount' => count($lineNames),
            'categories' => array_keys($categories),
            'validity' => array_values($validity),
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
