<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';
require_once __DIR__ . '/_professional_pdf.php';
require_once __DIR__ . '/_route_maintenance.php';
$auth = lehrfahrer_route_require_account_write('routes.maintain');
$companyId = lehrfahrer_route_company_id($auth);

require_once __DIR__ . '/_route_maintenance_render.php';

function collectJsonLinesForCity(string $cityDir, string $citySlug): array {
    $entries = lehrfahrer_route_safe_entries($cityDir);
    $lines = [];

    if ($entries) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === 'gpx' || $entry === 'backup' || $entry === 'pdf') {
                continue;
            }
            $subPath = $cityDir . '/' . $entry;
            if (is_link($subPath) || !is_dir($subPath)) {
                continue;
            }
            foreach (glob($subPath . '/*.json') as $jsonFile) {
                if (is_link($jsonFile)) continue;
                $lines[] = [
                    'city' => $citySlug,
                    'lineFolder' => $entry,
                    'jsonPath' => $jsonFile,
                    'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
                ];
            }
            foreach (lehrfahrer_route_safe_entries($subPath) as $categoryEntry) {
                if ($categoryEntry === '.' || $categoryEntry === '..') {
                    continue;
                }
                $categoryPath = $subPath . '/' . $categoryEntry;
                if (is_link($categoryPath) || !is_dir($categoryPath)) {
                    continue;
                }
                foreach (glob($categoryPath . '/*.json') as $jsonFile) {
                    if (is_link($jsonFile)) continue;
                    $lines[] = [
                        'city' => $citySlug,
                        'lineFolder' => $entry,
                        'categoryFolder' => $categoryEntry,
                        'jsonPath' => $jsonFile,
                        'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
                    ];
                }
            }
        }
    }

    foreach (glob($cityDir . '/*.json') as $jsonFile) {
        if (is_link($jsonFile)) continue;
        $lines[] = [
            'city' => $citySlug,
            'lineFolder' => '',
            'jsonPath' => $jsonFile,
            'fileBase' => pathinfo($jsonFile, PATHINFO_FILENAME)
        ];
    }

    return $lines;
}

try {
    lehrfahrer_audit_file_lock($companyId, static function (string $directory) use ($auth, $companyId): void {
        lehrfahrer_audit_file_recover_locked($auth['pdo'], $companyId, $directory);

        $raw = file_get_contents('php://input');
        $input = json_decode($raw ?: '{}', true);
        if (!is_array($input)) {
            $input = [];
        }

        $requestedCity = strtolower(trim((string)($input['city'] ?? '')));
        $requestedCity = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $requestedCity);

        $linienBaseDir = lehrfahrer_tenant_area($companyId, 'lines');
        $citiesBaseDir = lehrfahrer_tenant_area($companyId, 'cities');

        if (!is_dir($linienBaseDir)) {
            echo json_encode([
                'ok' => true,
                'totalLines' => 0,
                'generatedCount' => 0,
                'cityScope' => $requestedCity ?: 'alle',
                'errors' => []
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }

        $cities = [];
        if ($requestedCity !== '') {
            if (lehrfahrer_route_city_exists($companyId, $requestedCity)) {
                $cities[] = $requestedCity;
            } else {
                http_response_code(404);
                echo json_encode(['ok' => false, 'error' => 'Ort nicht gefunden']);
                exit;
            }
        } else {
            foreach (lehrfahrer_route_safe_entries($citiesBaseDir) as $entry) {
                if (lehrfahrer_route_city_exists($companyId, $entry)) {
                    $cities[] = $entry;
                }
            }
        }

        $totalLines = 0;
        $generatedPdfCount = 0;
        $generatedGpxCount = 0;
        $errors = [];

        foreach ($cities as $citySlug) {
            $cityDir = lehrfahrer_route_line_city_path($companyId, $citySlug);

            $lineEntries = collectJsonLinesForCity($cityDir, $citySlug);

            foreach ($lineEntries as $entry) {
                $totalLines++;

                $jsonRaw = @file_get_contents($entry['jsonPath']);
                $lineData = $jsonRaw ? @json_decode($jsonRaw, true) : null;

                if (!is_array($lineData)) {
                    $errors[] = [
                        'file' => basename($entry['jsonPath']),
                        'error' => 'JSON ungültig'
                    ];
                    continue;
                }

                if (!isset($lineData['savedAt'])) {
                    $lineData['savedAt'] = date('c', (int)(filemtime($entry['jsonPath']) ?: 0));
                }

                $targetPdfPath = lehrfahrer_route_sibling_path($companyId, $entry['jsonPath'], $entry['fileBase'] . '.pdf');

                try {
                    $pdfBinary = buildLineOverviewPdf($lineData, $citySlug, $entry['lineFolder'] ?: '-');
                    $gpxText = buildGpxFromLineData($lineData);
                    lehrfahrer_route_maintenance_artifacts($auth, $entry['jsonPath'], $pdfBinary, $gpxText);
                    $generatedPdfCount++;
                    if ($gpxText !== null) $generatedGpxCount++;
                } catch (Throwable $err) {
                    $errors[] = [
                        'file' => basename($entry['jsonPath']),
                        'error' => $err->getMessage(),
                        'target' => basename($targetPdfPath)
                    ];
                }
            }
        }

        echo json_encode([
            'ok' => true,
            'totalLines' => $totalLines,
            'generatedPdfCount' => $generatedPdfCount,
            'generatedGpxCount' => $generatedGpxCount,
            'cityScope' => $requestedCity ?: 'alle',
            'errors' => array_slice($errors, 0, 50)
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    });
} catch (Throwable $error) {
    error_log('Audit-Routenwartung fehlgeschlagen.');
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'Routenwartung konnte nicht sicher ausgefuehrt werden.']);
}
