<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/_auth.php';
lehrfahrer_require_write_auth();

function vbb_json_error(int $status, string $message): void {
    http_response_code($status);
    echo json_encode([
        'ok' => false,
        'error' => $message
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function vbb_load_config(): array {
    $cfg = [
        'baseUrl' => 'https://vbb-demo.demo2.hafas.cloud/api/fahrinfo/latest',
        'accessId' => '',
        'timeoutSeconds' => 20,
    ];

    $localFile = __DIR__ . '/_vbb_config.local.php';
    if (is_file($localFile)) {
        $fromFile = include $localFile;
        if (is_array($fromFile)) {
            $cfg = array_merge($cfg, $fromFile);
        }
    }

    $envBase = getenv('VBB_API_BASE_URL');
    if (is_string($envBase) && trim($envBase) !== '') {
        $cfg['baseUrl'] = trim($envBase);
    }

    $envId = getenv('VBB_ACCESS_ID');
    if (is_string($envId) && trim($envId) !== '') {
        $cfg['accessId'] = trim($envId);
    }

    $cfg['baseUrl'] = rtrim((string)$cfg['baseUrl'], '/');
    $cfg['accessId'] = trim((string)$cfg['accessId']);
    $cfg['timeoutSeconds'] = max(5, intval($cfg['timeoutSeconds'] ?? 20));

    return $cfg;
}

function vbb_http_get(string $url, int $timeoutSeconds): array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeoutSeconds);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSeconds);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);
        $body = curl_exec($ch);
        $http = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
        $err = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            return ['ok' => false, 'status' => 0, 'error' => $err ?: 'cURL-Fehler'];
        }

        return ['ok' => true, 'status' => $http, 'body' => $body];
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeoutSeconds,
            'header' => "Accept: application/json\r\n",
        ]
    ]);

    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'HTTP-Anfrage fehlgeschlagen'];
    }

    $http = 200;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $http = intval($m[1]);
                break;
            }
        }
    }

    return ['ok' => true, 'status' => $http, 'body' => $body];
}

function vbb_request(array $cfg, string $path, array $query): array {
    $path = '/' . ltrim($path, '/');
    $params = $query;
    $params['accessId'] = $cfg['accessId'];
    $url = $cfg['baseUrl'] . $path . '?' . http_build_query($params);

    $res = vbb_http_get($url, $cfg['timeoutSeconds']);
    if (!$res['ok']) {
        return ['ok' => false, 'error' => $res['error'] ?? 'HTTP-Fehler', 'url' => $url];
    }

    $json = json_decode((string)$res['body'], true);
    if (!is_array($json)) {
        return [
            'ok' => false,
            'error' => 'VBB-Antwort ist kein gültiges JSON',
            'status' => $res['status'],
            'url' => $url,
            'raw' => substr((string)$res['body'], 0, 400)
        ];
    }

    if (($res['status'] ?? 500) >= 400) {
        return [
            'ok' => false,
            'error' => $json['error'] ?? ('VBB-HTTP-Fehler ' . $res['status']),
            'status' => $res['status'],
            'url' => $url,
            'payload' => $json
        ];
    }

    return ['ok' => true, 'data' => $json, 'url' => $url];
}

function vbb_get_first(array $arr, array $keys, $default = null) {
    foreach ($keys as $key) {
        if (array_key_exists($key, $arr) && $arr[$key] !== null && $arr[$key] !== '') {
            return $arr[$key];
        }
    }
    return $default;
}

function vbb_extract_lat_lon($item): ?array {
    if (!is_array($item)) {
        return null;
    }

    $lat = null;
    $lon = null;

    if (isset($item['location']) && is_array($item['location'])) {
        $lat = vbb_get_first($item['location'], ['latitude', 'lat'], null);
        $lon = vbb_get_first($item['location'], ['longitude', 'lon', 'lng'], null);
    }

    if ($lat === null) $lat = vbb_get_first($item, ['latitude', 'lat'], null);
    if ($lon === null) $lon = vbb_get_first($item, ['longitude', 'lon', 'lng'], null);

    if ($lat === null || $lon === null) {
        return null;
    }

    return [floatval($lat), floatval($lon)];
}

function vbb_extract_candidates(array $payload): array {
    $lines = [];

    if (isset($payload['lines']) && is_array($payload['lines'])) {
        $lines = $payload['lines'];
    } elseif (isset($payload['data']) && is_array($payload['data'])) {
        $lines = $payload['data'];
    }

    $out = [];
    foreach ($lines as $line) {
        if (!is_array($line)) continue;

        $id = strval(vbb_get_first($line, ['id', 'lineId', 'journeyRef', 'tripId'], ''));
        if ($id === '') continue;

        $name = trim(strval(vbb_get_first($line, ['name', 'label', 'number', 'line'], '')));
        $direction = trim(strval(vbb_get_first($line, ['direction', 'directionName', 'towards'], '')));
        $product = trim(strval(vbb_get_first($line, ['productName', 'product', 'mode'], '')));

        $out[] = [
            'id' => $id,
            'name' => $name !== '' ? $name : $id,
            'direction' => $direction,
            'product' => $product,
            'raw' => $line,
        ];
    }

    return $out;
}

function vbb_extract_stops(array $line): array {
    $stops = [];

    $candidates = [];
    if (isset($line['stops']) && is_array($line['stops'])) $candidates[] = $line['stops'];
    if (isset($line['route']) && is_array($line['route']) && isset($line['route']['stops']) && is_array($line['route']['stops'])) {
        $candidates[] = $line['route']['stops'];
    }
    if (isset($line['routes']) && is_array($line['routes']) && isset($line['routes'][0]) && is_array($line['routes'][0])) {
        if (isset($line['routes'][0]['stops']) && is_array($line['routes'][0]['stops'])) {
            $candidates[] = $line['routes'][0]['stops'];
        }
    }

    foreach ($candidates as $list) {
        $tmp = [];
        foreach ($list as $idx => $stop) {
            if (!is_array($stop)) continue;
            $latLon = vbb_extract_lat_lon($stop);
            if (!$latLon) continue;

            $name = trim(strval(vbb_get_first($stop, ['name', 'label'], 'Haltestelle ' . ($idx + 1))));
            $sid = strval(vbb_get_first($stop, ['id', 'stationId', 'evaNr'], ''));

            $tmp[] = [
                'id' => $sid !== '' ? $sid : null,
                'name' => $name,
                'lat' => $latLon[0],
                'lon' => $latLon[1],
            ];
        }

        if (count($tmp) >= 2) {
            $stops = $tmp;
            break;
        }
    }

    return $stops;
}

function vbb_extract_route_points(array $line, array $stops): array {
    $points = [];

    $polyline = $line['polyline'] ?? null;
    if (is_array($polyline) && isset($polyline['coordinates']) && is_array($polyline['coordinates'])) {
        foreach ($polyline['coordinates'] as $coord) {
            if (!is_array($coord) || count($coord) < 2) continue;
            $points[] = [
                'lat' => floatval($coord[1]),
                'lon' => floatval($coord[0]),
                'sourceType' => 'imported'
            ];
        }
    }

    if (!$points) {
        foreach ($stops as $stop) {
            $points[] = [
                'lat' => floatval($stop['lat']),
                'lon' => floatval($stop['lon']),
                'sourceType' => 'imported'
            ];
        }
    }

    return $points;
}

function vbb_map_to_editor_line(array $line, string $lineQuery, string $city): array {
    $stopsRaw = vbb_extract_stops($line);
    $routePoints = vbb_extract_route_points($line, $stopsRaw);

    $lineName = trim(strval(vbb_get_first($line, ['name', 'label', 'number', 'line'], $lineQuery)));
    $directionName = trim(strval(vbb_get_first($line, ['direction', 'directionName', 'towards'], 'VBB-Import')));

    $stops = [];
    foreach ($stopsRaw as $idx => $stop) {
        $stops[] = [
            'id' => 'stop_' . ($idx + 1),
            'catalogId' => $stop['id'] ?? null,
            'sourceType' => 'catalog',
            'type' => 'bus',
            'name' => $stop['name'],
            'lat' => round(floatval($stop['lat']), 6),
            'lon' => round(floatval($stop['lon']), 6),
            'order' => $idx + 1,
            'minuteFromStart' => $idx * 2,
            'minuteMode' => 'auto',
            'segmentMinutes' => $idx === 0 ? 0 : 2,
            'arrivalMinute' => $idx * 2,
            'departureMinute' => $idx * 2,
            'note' => '',
            'isGhostPoint' => false,
            'isGhost' => false,
            'isTimingPoint' => ($idx === 0 || $idx === count($stopsRaw) - 1),
        ];
    }

    return [
        'city' => $city,
        'lineName' => 'Linie ' . preg_replace('/^Linie\s+/i', '', $lineName),
        'routeName' => 'Route 01',
        'directionName' => $directionName !== '' ? $directionName : 'VBB-Import',
        'color' => '#d32f2f',
        'routeMode' => 'imported',
        'stops' => $stops,
        'routePoints' => $routePoints,
        'routePointsSimplified' => [],
        'line' => [
            'lineName' => 'Linie ' . preg_replace('/^Linie\s+/i', '', $lineName),
            'routeName' => 'Route 01',
            'directionName' => $directionName !== '' ? $directionName : 'VBB-Import',
            'color' => '#d32f2f',
            'routeMode' => 'imported'
        ],
        'meta' => [
            'source' => 'VBB API Import',
            'importedAt' => date('c')
        ]
    ];
}

$cfg = vbb_load_config();
if ($cfg['accessId'] === '') {
    vbb_json_error(400, 'VBB Access-ID fehlt. Bitte api/_vbb_config.local.php konfigurieren.');
}

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: '{}', true);
if (!is_array($input)) {
    $input = [];
}

$action = trim(strtolower(strval($input['action'] ?? 'search')));
$lineQuery = trim(strval($input['lineQuery'] ?? ''));
$city = trim(strtolower(strval($input['city'] ?? 'cottbus')));
if ($city === '') $city = 'cottbus';

if ($lineQuery === '') {
    vbb_json_error(400, 'Bitte eine Linie angeben.');
}

$search = vbb_request($cfg, '/lines', [
    'query' => $lineQuery,
    'results' => 20,
    'remarks' => 'false'
]);

if (!$search['ok']) {
    vbb_json_error(502, 'VBB-Suche fehlgeschlagen: ' . ($search['error'] ?? 'Unbekannter Fehler'));
}

$candidates = vbb_extract_candidates($search['data']);
if (!$candidates) {
    echo json_encode([
        'ok' => true,
        'candidates' => [],
        'message' => 'Keine Linien gefunden.'
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'search') {
    echo json_encode([
        'ok' => true,
        'candidates' => array_map(function ($line) {
            return [
                'id' => $line['id'],
                'name' => $line['name'],
                'direction' => $line['direction'],
                'product' => $line['product']
            ];
        }, $candidates)
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$lineId = trim(strval($input['lineId'] ?? ''));
if ($lineId === '') {
    $lineId = strval($candidates[0]['id']);
}

$selected = null;
foreach ($candidates as $line) {
    if (strval($line['id']) === $lineId) {
        $selected = $line;
        break;
    }
}
if (!$selected) {
    vbb_json_error(404, 'Gewählte Linie wurde in den Suchergebnissen nicht gefunden.');
}

$detail = vbb_request($cfg, '/lines/' . rawurlencode($lineId), [
    'remarks' => 'false'
]);

$linePayload = $selected['raw'];
if ($detail['ok'] && isset($detail['data']) && is_array($detail['data'])) {
    $linePayload = $detail['data']['line'] ?? $detail['data'];
    if (!is_array($linePayload)) {
        $linePayload = $selected['raw'];
    }
}

$mapped = vbb_map_to_editor_line($linePayload, $lineQuery, $city);
if (count($mapped['stops']) < 2) {
    vbb_json_error(422, 'Linie gefunden, aber ohne nutzbare Stop-/Geometriedaten für den Import.');
}

echo json_encode([
    'ok' => true,
    'line' => $mapped,
    'selected' => [
        'id' => $selected['id'],
        'name' => $selected['name'],
        'direction' => $selected['direction'],
        'product' => $selected['product']
    ],
    'stopCount' => count($mapped['stops']),
    'routePointCount' => count($mapped['routePoints'])
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
