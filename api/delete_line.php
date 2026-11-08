<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_tenant_route_storage.php';
require_once __DIR__ . '/_route_audit.php';
$auth = lehrfahrer_route_require_account_write('routes.delete');
$companyId = lehrfahrer_route_company_id($auth);


function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

function buildPdfStorageFileName(string $lineFolder, string $fileBase): string {
    $prefix = trim(sanitizeForFilesystem($lineFolder));
    $base = trim(sanitizeForFilesystem($fileBase));
    if ($base === '') {
        $base = 'linie';
    }
    if ($prefix !== '') {
        return $prefix . '__' . $base . '.pdf';
    }
    return $base . '.pdf';
}

try {
    lehrfahrer_audit_file_lock($companyId, static function (string $directory) use ($companyId, $auth): void {
        lehrfahrer_audit_file_recover_locked($auth['pdo'], $companyId, $directory);
        $actor = lehrfahrer_route_audit_actor($auth, 'routes.delete');

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);

        if (!$data || !is_array($data)) {
            http_response_code(400);
            echo json_encode([
                'ok' => false,
                'error' => 'Ungültige JSON-Daten'
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $city = trim($data['city'] ?? 'cottbus');
        $city = strtolower($city);
        $city = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $city);

        if ($city === '') {
            $city = 'cottbus';
        }

        $line = trim($data['line'] ?? '');
        $line = preg_replace('/\.json$/i', '', $line);
        $line = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $line);

        $lineFolder = trim($data['lineFolder'] ?? '');
        $lineFolder = sanitizeForFilesystem($lineFolder);
        $categoryFolder = trim($data['categoryFolder'] ?? '');
        $categoryFolder = sanitizeForFilesystem($categoryFolder);

        if ($line === '') {
            http_response_code(400);
            echo json_encode([
                'ok' => false,
                'error' => 'Fehlende Linien-ID'
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $jsonPath = lehrfahrer_route_find_file($companyId, $city, $line, 'json', $lineFolder, $categoryFolder);

        if ($jsonPath === null) {
            http_response_code(404);
            echo json_encode([
                'ok' => false,
                'error' => 'Linie nicht gefunden'
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $linesRoot = lehrfahrer_tenant_area($companyId, 'lines');
        $cityDir = lehrfahrer_route_line_city_path($companyId, $city);
        $folderToClean = dirname($jsonPath) !== $cityDir ? dirname($jsonPath) : null;
        $parentFolderToClean = $folderToClean && dirname($folderToClean) !== $cityDir ? dirname($folderToClean) : null;
        $relativeDirectory = str_replace('\\', '/', substr(dirname($jsonPath), strlen($linesRoot) + 1));
        $gpxPath = lehrfahrer_tenant_path($companyId, 'lines', $relativeDirectory . '/' . $line . '.gpx');
        if (!is_file($gpxPath) && $relativeDirectory === $city) {
            $gpxPath = lehrfahrer_tenant_path($companyId, 'lines', $city . '/gpx/' . $line . '.gpx');
        }
        $pdfPath = lehrfahrer_tenant_path($companyId, 'lines', $city . '/pdf/' . buildPdfStorageFileName(trim($lineFolder . '_' . $categoryFolder, '_'), $line));
        $legacyPdfPathA = lehrfahrer_tenant_path($companyId, 'lines', $relativeDirectory . '/' . $line . '.pdf');
        $legacyPdfPathB = lehrfahrer_tenant_path($companyId, 'lines', $relativeDirectory . '/gpx/' . $line . '.pdf');

        $reference = str_replace('\\', '/', substr($jsonPath, strlen($linesRoot) + 1));
        $files = [];
        $deletedGpx = false;
        $deletedPdf = false;
        foreach (array_unique([$jsonPath, $gpxPath, $pdfPath, $legacyPdfPathA, $legacyPdfPathB]) as $targetPath) {
            if (!file_exists($targetPath) && !is_link($targetPath)) continue;
            $checkedPath = lehrfahrer_route_checked_path($companyId, $targetPath);
            $relative = str_replace('\\', '/', substr($checkedPath, strlen($linesRoot) + 1));
            $files[] = ['relative' => $relative];
            if ($targetPath === $gpxPath) $deletedGpx = true;
            if (str_ends_with($targetPath, '.pdf')) $deletedPdf = true;
        }
        $event = lehrfahrer_route_audit_event($companyId, $reference, 'ROUTE_DELETE', 'routes.delete');
        lehrfahrer_audit_file_mutate($auth['pdo'], $actor, $companyId, $reference, 'DELETE', $files, $event);
        $deletedJson = true;

        // Leeren Linienordner aufräumen
        if ($folderToClean && is_dir($folderToClean)) {
            $remaining = array_diff(scandir($folderToClean), ['.', '..']);
            if (empty($remaining)) {
                rmdir($folderToClean);
            }
        }
        if ($parentFolderToClean && is_dir($parentFolderToClean)) {
            $remaining = array_diff(scandir($parentFolderToClean), ['.', '..']);
            if (empty($remaining)) {
                rmdir($parentFolderToClean);
            }
        }

        if (!$deletedJson) {
            http_response_code(500);
            echo json_encode([
                'ok' => false,
                'error' => 'JSON-Datei konnte nicht gelöscht werden'
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        echo json_encode([
            'ok' => true,
            'city' => $city,
            'line' => $line,
            'deletedJson' => $deletedJson,
            'deletedGpx' => $deletedGpx,
            'deletedPdf' => $deletedPdf
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    });
} catch (Throwable $error) {
    error_log('Audit-Routenloeschung fehlgeschlagen.');
    http_response_code(503);
    echo json_encode(['ok' => false, 'error' => 'Route konnte nicht sicher geloescht werden.']);
}
