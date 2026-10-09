<?php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/_tenant_catalog_storage.php';
$companyId = lehrfahrer_route_authorize('stops.catalog.write', true, true);

// Speichert den clientseitig gemergten Katalog im privaten Tenant-Bereich.

$rawCatalog = isset($_POST["catalog"]) ? $_POST["catalog"] : null;

if ($rawCatalog === null) {
    http_response_code(400);
    echo json_encode(["error" => "Parameter 'catalog' fehlt"]);
    exit;
}

$stops = json_decode($rawCatalog, true);
if (!is_array($stops)) {
    http_response_code(400);
    echo json_encode(["error" => "Ungültiges JSON im catalog-Parameter"]);
    exit;
}

// Sicherheitscheck: niemals mit 0 Einträgen speichern
if (count($stops) === 0) {
    http_response_code(400);
    echo json_encode(["error" => "Speichern verhindert: 0 Haltestellen – vorhandene Datei bleibt erhalten."]);
    exit;
}

// Felder bereinigen & validieren
$clean = [];
foreach ($stops as $s) {
    if (!isset($s["name"], $s["lat"], $s["lon"])) continue;
    $name = trim((string)$s["name"]);
    if ($name === "") continue;
    $lat = (float)$s["lat"];
    $lon = (float)$s["lon"];
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) continue;
    $clean[] = [
        "id"          => isset($s["id"]) ? (string)$s["id"] : ("hst_" . count($clean)),
        "name"        => $name,
        "lat"         => round($lat, 6),
        "lon"         => round($lon, 6),
        "type"        => isset($s["type"]) ? (string)$s["type"] : "bus",
        "sourceCount" => isset($s["sourceCount"]) ? (int)$s["sourceCount"] : 1,
    ];
}

if (count($clean) === 0) {
    http_response_code(400);
    echo json_encode(["error" => "Keine gültigen Haltestellen nach Bereinigung"]);
    exit;
}

$saved = false;
try { $saved = lehrfahrer_catalog_save($companyId, $clean); }
catch (Throwable $error) { error_log('Tenant-Katalog konnte nicht gespeichert werden: ' . $error->getMessage()); }
if (!$saved) {
    http_response_code(500);
    echo json_encode(["error" => "Konnte Katalog nicht speichern"]);
    exit;
}

echo json_encode(["ok" => true, "count" => count($clean)]);
