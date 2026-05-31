<?php
header("Content-Type: application/json; charset=utf-8");

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

$filename = preg_replace('/[\\\\\/:*?"<>|]+/', "_", $filename);

if (!preg_match('/\.gpx$/i', $filename)) {
    $filename .= ".gpx";
}

// Neues Format: linien/{city}/{lineFolder}/{filename}
$baseDir = __DIR__ . "/../linien/" . $city . "/" . $lineFolder;

if (!is_dir($baseDir)) {
    if (!mkdir($baseDir, 0775, true)) {
        http_response_code(500);
        echo json_encode([
            "ok" => false,
            "error" => "GPX-Ordner konnte nicht erstellt werden."
        ]);
        exit;
    }
}

$fullPath = $baseDir . "/" . $filename;

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
    "fileBase" => preg_replace('/\.gpx$/i', '', $filename),
    "path" => "linien/" . $city . "/" . $lineFolder . "/" . $filename
]);