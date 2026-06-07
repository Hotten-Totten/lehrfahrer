<?php
header("Content-Type: application/json; charset=utf-8");
set_time_limit(120); // PHP-Ausführungszeit erhöhen
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

// ---- Parameter lesen & validieren ----
$lat    = isset($_POST["lat"])    ? (float) $_POST["lat"]    : null;
$lon    = isset($_POST["lon"])    ? (float) $_POST["lon"]    : null;
$radius = isset($_POST["radius"]) ? (int)   $_POST["radius"] : null;
$save   = isset($_POST["save"])   && $_POST["save"] === "1";

if ($lat === null || $lon === null || $radius === null) {
    http_response_code(400);
    echo json_encode(["error" => "Fehlende Parameter: lat, lon, radius"]);
    exit;
}

// Sinnvolle Grenzen
if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
    http_response_code(400);
    echo json_encode(["error" => "Ungültige Koordinaten"]);
    exit;
}
if ($radius < 1 || $radius > 150) {
    http_response_code(400);
    echo json_encode(["error" => "Radius muss zwischen 1 und 150 km liegen"]);
    exit;
}

$radiusMeters = $radius * 1000;

// ---- Overpass-Abfrage ----
// Nur node-Typen – way-Varianten sind selten und verlangsamen stark.
$query = "[out:json][timeout:50];\n(\n" .
    "  node[\"highway\"=\"bus_stop\"](around:{$radiusMeters},{$lat},{$lon});\n" .
    "  node[\"railway\"=\"tram_stop\"](around:{$radiusMeters},{$lat},{$lon});\n" .
    "  node[\"public_transport\"=\"platform\"](around:{$radiusMeters},{$lat},{$lon});\n" .
    ");\nout body qt;";

$overpassUrls = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "http://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
];

$rawData = null;
$lastError = "";

foreach ($overpassUrls as $url) {
    if (function_exists("curl_init")) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => "data=" . urlencode($query),  // URL-encoded, kein multipart!
            CURLOPT_HTTPHEADER     => ["Content-Type: application/x-www-form-urlencoded"],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,    // Schnell scheitern, nächsten Server versuchen
            CURLOPT_TIMEOUT        => 55,  // Knapp über Overpass-Timeout von 50s
            CURLOPT_USERAGENT      => "LehrfahrerEditor/1.0",
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($response !== false && $httpCode === 200) {
            $rawData = $response;
            break;
        }
        $lastError = $curlErr ?: "HTTP {$httpCode}";
    } elseif (ini_get("allow_url_fopen")) {
        // Fallback: file_get_contents wenn cURL nicht verfügbar
        $ctx = stream_context_create([
            "http" => [
                "method"  => "POST",
                "header"  => "Content-Type: application/x-www-form-urlencoded\r\nUser-Agent: LehrfahrerEditor/1.0\r\n",
                "content" => "data=" . urlencode($query),
                "timeout" => 55,
            ],
            "ssl" => ["verify_peer" => true],
        ]);
        $response = @file_get_contents($url, false, $ctx);
        if ($response !== false) {
            $rawData = $response;
            break;
        }
        $lastError = "file_get_contents fehlgeschlagen";
    }
}

// Letzter Versuch: file_get_contents, falls cURL überall scheiterte
if ($rawData === null && ini_get("allow_url_fopen")) {
    foreach ($overpassUrls as $url) {
        $ctx = stream_context_create([
            "http" => [
                "method"  => "POST",
                "header"  => "Content-Type: application/x-www-form-urlencoded\r\nUser-Agent: LehrfahrerEditor/1.0\r\n",
                "content" => "data=" . urlencode($query),
                "timeout" => 55,
            ],
        ]);
        $response = @file_get_contents($url, false, $ctx);
        if ($response !== false) {
            $rawData = $response;
            break;
        }
    }
}

if ($rawData === null) {
    http_response_code(502);
    echo json_encode(["error" => "Overpass nicht erreichbar: " . $lastError]);
    exit;
}

$parsed = json_decode($rawData, true);
if (!$parsed || !isset($parsed["elements"])) {
    http_response_code(502);
    echo json_encode(["error" => "Ungültige Overpass-Antwort"]);
    exit;
}

// ---- Haltestellen verarbeiten (gleiche Logik wie build_haltestellen.py) ----
$MERGE_RADIUS_M = 8.0;

function distanceMeters($lat1, $lon1, $lat2, $lon2) {
    $r = 6371000;
    $phi1 = deg2rad($lat1); $phi2 = deg2rad($lat2);
    $dphi = deg2rad($lat2 - $lat1);
    $dlambda = deg2rad($lon2 - $lon1);
    $a = sin($dphi/2)**2 + cos($phi1)*cos($phi2)*sin($dlambda/2)**2;
    return $r * 2 * atan2(sqrt($a), sqrt(1-$a));
}

function classifyStop($tags) {
    if (($tags["railway"] ?? "") === "tram_stop") return "tram";
    $bus  = $tags["bus"]  ?? "";
    $tram = $tags["tram"] ?? "";
    if ($bus === "yes" && $tram === "yes") return "bus_tram";
    if ($tram === "yes") return "tram";
    if ($bus  === "yes") return "bus";
    if (($tags["highway"] ?? "")          === "bus_stop")  return "bus";
    if (($tags["railway"] ?? "")          === "tram_stop") return "tram";
    if (($tags["public_transport"] ?? "") === "platform")  return "bus";
    return "bus";
}

function normalizeDirectionText($value) {
    $value = trim((string)$value);
    if ($value === "") return "";
    $value = preg_replace('/\s+/', ' ', $value);
    return mb_strtolower($value, 'UTF-8');
}

function extractDirectionHint($tags) {
    $candidates = [
        $tags["towards"] ?? "",
        $tags["destination"] ?? "",
        $tags["direction"] ?? "",
        $tags["local_ref"] ?? "",
    ];

    foreach ($candidates as $cand) {
        $normalized = normalizeDirectionText($cand);
        if ($normalized !== "") return $normalized;
    }

    return "";
}

$raw = [];
foreach ($parsed["elements"] as $el) {
    $tags = $el["tags"] ?? [];
    // name > ref als Fallback > überspringen
    $name = trim($tags["name"] ?? "");
    if ($name === "") $name = trim($tags["ref"] ?? "");
    if ($name === "") continue;
    // Normalize whitespace
    $name = preg_replace('/\s+/', ' ', $name);

    if (isset($el["lat"])) {
        $elLat = (float) $el["lat"];
        $elLon = (float) $el["lon"];
    } elseif (isset($el["center"])) {
        $elLat = (float) $el["center"]["lat"];
        $elLon = (float) $el["center"]["lon"];
    } else {
        continue;
    }

    $raw[] = [
        "name" => $name,
        "lat" => $elLat,
        "lon" => $elLon,
        "type" => classifyStop($tags),
        "direction" => extractDirectionHint($tags),
    ];
}

// Merge by name + proximity (8 m)
$merged = [];
foreach ($raw as $stop) {
    $found = false;
    foreach ($merged as &$m) {
        if ($m["name"] !== $stop["name"]) continue;
        $mDir = $m["direction"] ?? "";
        $sDir = $stop["direction"] ?? "";
        $dirCompatible = ($mDir !== "" && $sDir !== "") ? ($mDir === $sDir) : true;
        if ($dirCompatible && distanceMeters($m["lat"], $m["lon"], $stop["lat"], $stop["lon"]) <= $MERGE_RADIUS_M) {
            // weighted centroid
            $n = $m["sourceCount"];
            $m["lat"] = ($m["lat"] * $n + $stop["lat"]) / ($n + 1);
            $m["lon"] = ($m["lon"] * $n + $stop["lon"]) / ($n + 1);
            $m["sourceCount"]++;
            if (($m["direction"] ?? "") === "" && $sDir !== "") $m["direction"] = $sDir;
            // tram beats bus
            if ($stop["type"] === "tram" || $stop["type"] === "bus_tram") $m["type"] = $stop["type"];
            $found = true;
            break;
        }
    }
    unset($m);
    if (!$found) {
        $merged[] = ["name" => $stop["name"], "lat" => $stop["lat"], "lon" => $stop["lon"],
                     "type" => $stop["type"], "direction" => ($stop["direction"] ?? ""), "sourceCount" => 1];
    }
}

// Sort by name, assign IDs
usort($merged, fn($a, $b) => strcmp($a["name"], $b["name"]));
$stops = [];
foreach ($merged as $i => $s) {
    $stops[] = [
        "id"          => "hst_" . ($i + 1),
        "name"        => $s["name"],
        "lat"         => round($s["lat"], 6),
        "lon"         => round($s["lon"], 6),
        "type"        => $s["type"],
        "direction"   => $s["direction"] ?? "",
        "sourceCount" => $s["sourceCount"],
    ];
}

// ---- Optional: als haltestellen.js speichern ----
if ($save) {
    if (count($stops) === 0) {
        // Sicherheitscheck: niemals mit 0 Einträgen speichern
        echo json_encode(["stops" => [], "count" => 0, "rawCount" => count($parsed["elements"]),
            "saveError" => "Speichern verhindert: 0 Haltestellen gefunden – vorhandene Datei bleibt erhalten."]);
        exit;
    }
    $jsContent = "const stopCatalog = " . json_encode($stops, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . ";\n";
    $outPath = __DIR__ . "/../data/haltestellen.js";
    if (file_put_contents($outPath, $jsContent) === false) {
        echo json_encode(["stops" => $stops, "count" => count($stops), "rawCount" => count($parsed["elements"]),
            "saveError" => "Konnte Datei nicht schreiben"]);
        exit;
    }
}

echo json_encode(["stops" => $stops, "count" => count($stops), "rawCount" => count($parsed["elements"])]);
