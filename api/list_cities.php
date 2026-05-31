<?php
header("Content-Type: application/json; charset=utf-8");

$baseDir = __DIR__ . "/../linien";

if (!is_dir($baseDir)) {
    mkdir($baseDir, 0775, true);
}

$entries = scandir($baseDir);
$cities = [];

foreach ($entries as $entry) {
    if ($entry === "." || $entry === "..") continue;

    $fullPath = $baseDir . "/" . $entry;

    if (is_dir($fullPath)) {
        $cities[] = $entry;
    }
}

natcasesort($cities);
$cities = array_values($cities);

echo json_encode([
    "ok" => true,
    "cities" => $cities
]);