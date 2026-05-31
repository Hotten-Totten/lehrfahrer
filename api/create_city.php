<?php
header("Content-Type: application/json; charset=utf-8");

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

if ($city === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "Bitte einen Ortsnamen eingeben."
    ]);
    exit;
}

// slug bauen
$slug = mb_strtolower($city, "UTF-8");
$slug = str_replace(["ä", "ö", "ü", "ß"], ["ae", "oe", "ue", "ss"], $slug);
$slug = preg_replace('/[^a-z0-9_-]+/u', '-', $slug);
$slug = preg_replace('/-+/', '-', $slug);
$slug = trim($slug, '-');

if ($slug === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "Ungültiger Ortsname."
    ]);
    exit;
}

$baseDir = __DIR__ . "/../linien/" . $slug;
$gpxDir = $baseDir . "/gpx";

if (!is_dir($baseDir) && !mkdir($baseDir, 0775, true)) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "Ortsordner konnte nicht erstellt werden."
    ]);
    exit;
}

if (!is_dir($gpxDir) && !mkdir($gpxDir, 0775, true)) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "GPX-Ordner konnte nicht erstellt werden."
    ]);
    exit;
}

echo json_encode([
    "ok" => true,
    "city" => $slug
]);