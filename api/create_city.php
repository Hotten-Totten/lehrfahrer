<?php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/_tenant_route_storage.php';
$companyId = lehrfahrer_route_authorize('cities.manage', true, true);

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

try {
    $slug = lehrfahrer_route_register_city($companyId, $city);
} catch (InvalidArgumentException $error) {
    http_response_code(400);
    echo json_encode(["ok" => false, "error" => "Ungültiger Ortsname."]);
    exit;
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "Ortsordner konnte nicht erstellt werden."
    ]);
    exit;
}

echo json_encode([
    "ok" => true,
    "city" => $slug
]);
