<?php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

// Speichert den (bereits clientseitig gemergten) Haltestellen-Katalog als haltestellen.js

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

$jsContent = "const stopCatalog = " . json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . ";\n";
$outPath = __DIR__ . "/../data/haltestellen.js";

if (file_put_contents($outPath, $jsContent) === false) {
    http_response_code(500);
    echo json_encode(["error" => "Konnte Datei nicht schreiben: " . $outPath]);
    exit;
}

echo json_encode(["ok" => true, "count" => count($clean)]);
