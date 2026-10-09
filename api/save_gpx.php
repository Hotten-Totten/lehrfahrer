<?php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/_tenant_route_storage.php';
$companyId = lehrfahrer_route_authorize('routes.write', true, true);

function sanitizeForFilesystem(string $value): string {
    $value = str_replace(
        ['ä','ö','ü','Ä','Ö','Ü','ß'],
        ['ae','oe','ue','Ae','Oe','Ue','ss'],
        $value
    );
    $value = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $value);
    return trim($value, '_');
}

$raw = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!$data) {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "Ungültige JSON-Daten."
    ]);
    exit;
}

$city = isset($data["city"]) ? trim($data["city"]) : "";
$filename = isset($data["filename"]) ? trim($data["filename"]) : "";
$gpx = isset($data["gpx"]) ? $data["gpx"] : "";
$lineFolder = isset($data["lineFolder"]) ? trim($data["lineFolder"]) : "";
$categoryFolder = isset($data["categoryFolder"]) ? trim($data["categoryFolder"]) : "";

if ($city === "" || $filename === "" || $gpx === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "City, Dateiname oder GPX fehlt."
    ]);
    exit;
}

$city = strtolower($city);
$city = preg_replace('/[^a-z0-9_-]/', '_', $city);

$lineFolder = sanitizeForFilesystem($lineFolder);
if ($lineFolder === '') {
    $lineFolder = 'Linie';
}

$categoryFolder = sanitizeForFilesystem($categoryFolder);
if ($categoryFolder === '') {
    $categoryFolder = 'Standard';
}

$filename = preg_replace('/[\\\\\/:*?"<>|]+/', "_", $filename);

if (!preg_match('/\.gpx$/i', $filename)) {
    $filename .= ".gpx";
}

if (!lehrfahrer_route_city_exists($companyId, $city)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'Ort nicht gefunden']);
    exit;
}

lehrfahrer_tenant_ensure_directory($companyId, 'lines', $city . '/' . $lineFolder . '/' . $categoryFolder);
$fileBase = sanitizeForFilesystem(preg_replace('/\.gpx$/i', '', $filename));
if ($fileBase === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Ungueltiger GPX-Dateiname.']);
    exit;
}
$filename = $fileBase . '.gpx';
$fullPath = lehrfahrer_route_file($companyId, $city, $fileBase, 'gpx', $lineFolder, $categoryFolder);

$result = file_put_contents($fullPath, $gpx);

if ($result === false) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "GPX konnte nicht gespeichert werden."
    ]);
    exit;
}

echo json_encode([
    "ok" => true,
    "filename" => $filename,
    "fileBase" => $fileBase,
    "path" => 'api/download_line_gpx.php?' . http_build_query([
        'city' => $city, 'line' => $fileBase,
        'lineFolder' => $lineFolder, 'categoryFolder' => $categoryFolder
    ], '', '&', PHP_QUERY_RFC3986)
]);
