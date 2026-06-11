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
        'baseUrl' => 'https://vbb-demo.demo2.hafas.cloud/api/fahrinfo/2.52',
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
    if (!isset($params['format'])) {
        $params['format'] = 'json';
    }

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

    if (($res['status'] ?? 500) >= 400 || isset($json['errorCode'])) {
        return [
            'ok' => false,
            'error' => ($json['errorText'] ?? $json['error'] ?? ('VBB-HTTP-Fehler ' . $res['status'])),
            'status' => $res['status'],
            'url' => $url,
            'payload' => $json
        ];
    }

    return ['ok' => true, 'data' => $json, 'url' => $url];
}

function vbb_slug_to_city_query(string $citySlug): string {
    $clean = str_replace(['-', '_'], ' ', strtolower(trim($citySlug)));
    if ($clean === '') {
        return 'Cottbus';
    }
    return ucwords($clean);
}

function vbb_normalize_line(string $value): string {
    $v = strtoupper(trim($value));
    $v = preg_replace('/\s+/', '', $v);
    return $v;
}

function vbb_extract_stops_by_city(array $cfg, string $cityQuery): array {
    $res = vbb_request($cfg, '/location.name', [
        'input' => $cityQuery,
        'type' => 'S',
        'maxNo' => 80,
    ]);
    if (!$res['ok']) {
        return [];
    }

    $rows = [];
    $items = $res['data']['stopLocationOrCoordLocation'] ?? [];
    if (!is_array($items)) {
        return [];
    }

    foreach ($items as $item) {
        $stop = $item['StopLocation'] ?? null;
        if (!is_array($stop)) {
            continue;
        }

        $name = trim(strval($stop['name'] ?? ''));
        $id = trim(strval($stop['id'] ?? ''));
        if ($name === '' || $id === '') {
            continue;
        }

        $rows[] = [
            'id' => $id,
            'name' => $name,
            'lat' => isset($stop['lat']) ? floatval($stop['lat']) : null,
            'lon' => isset($stop['lon']) ? floatval($stop['lon']) : null,
        ];
    }

    return $rows;
}

function vbb_collect_candidates(array $cfg, string $lineQuery, array $stops): array {
    $target = vbb_normalize_line($lineQuery);
    $out = [];

    foreach (array_slice($stops, 0, 12) as $stop) {
        $depRes = vbb_request($cfg, '/departureBoard', [
            'id' => $stop['id'],
            'maxJourneys' => 80,
        ]);
        if (!$depRes['ok']) {
            continue;
        }

        $deps = $depRes['data']['Departure'] ?? [];
        if (!is_array($deps)) {
            continue;
        }

        foreach ($deps as $dep) {
            if (!is_array($dep)) {
                continue;
            }

            $line = vbb_normalize_line(strval($dep['Product']['line'] ?? $dep['name'] ?? ''));
            if ($line !== $target) {
                continue;
            }

            $ref = trim(strval($dep['JourneyDetailRef']['ref'] ?? ''));
            if ($ref === '' || isset($out[$ref])) {
                continue;
            }

            $out[$ref] = [
                'id' => $ref,
                'name' => strval($dep['Product']['line'] ?? $dep['name'] ?? $lineQuery),
                'direction' => strval($dep['direction'] ?? ''),
                'product' => strval($dep['Product']['catOut'] ?? $dep['Product']['catOutL'] ?? ''),
                'origin' => $stop['name'],
                'date' => strval($dep['date'] ?? ''),
                'time' => strval($dep['time'] ?? ''),
            ];
        }
    }

    return array_values($out);
}

function vbb_map_journey_to_editor_line(array $journey, string $lineQuery, string $city, string $fallbackDirection): array {
    $stopItems = $journey['Stops']['Stop'] ?? [];
    if (!is_array($stopItems)) {
        $stopItems = [];
    }

    $stops = [];
    $routePoints = [];

    foreach ($stopItems as $idx => $stop) {
        if (!is_array($stop)) {
            continue;
        }

        if (!isset($stop['lat'], $stop['lon'])) {
            continue;
        }

        $name = trim(strval($stop['name'] ?? ('Haltestelle ' . ($idx + 1))));
        $id = trim(strval($stop['id'] ?? ''));

        $lat = round(floatval($stop['lat']), 6);
        $lon = round(floatval($stop['lon']), 6);

        $stops[] = [
            'id' => 'stop_' . (count($stops) + 1),
            'catalogId' => $id !== '' ? $id : null,
            'sourceType' => 'catalog',
            'type' => 'bus',
            'name' => $name,
            'lat' => $lat,
            'lon' => $lon,
            'order' => count($stops) + 1,
            'minuteFromStart' => count($stops) * 2,
            'minuteMode' => 'auto',
            'segmentMinutes' => count($stops) === 0 ? 0 : 2,
            'arrivalMinute' => count($stops) * 2,
            'departureMinute' => count($stops) * 2,
            'note' => '',
            'isGhostPoint' => false,
            'isGhost' => false,
            'isTimingPoint' => false,
        ];

        $routePoints[] = [
            'lat' => $lat,
            'lon' => $lon,
            'sourceType' => 'imported'
        ];
    }

    $stopCount = count($stops);
    if ($stopCount > 0) {
        $stops[0]['isTimingPoint'] = true;
        $stops[$stopCount - 1]['isTimingPoint'] = true;
    }

    $lineNameRaw = trim(strval($journey['Names']['Name'][0]['name'] ?? $lineQuery));
    $lineLabel = preg_replace('/^Linie\s+/i', '', $lineNameRaw);
    $lineLabel = trim($lineLabel) !== '' ? trim($lineLabel) : trim($lineQuery);
    $lineName = 'Linie ' . $lineLabel;

    $direction = trim($fallbackDirection) !== '' ? trim($fallbackDirection) : 'VBB-Import';

    return [
        'city' => $city,
        'lineName' => $lineName,
        'routeName' => 'Route 01',
        'directionName' => $direction,
        'color' => '#d32f2f',
        'routeMode' => 'imported',
        'stops' => $stops,
        'routePoints' => $routePoints,
        'routePointsSimplified' => [],
        'line' => [
            'lineName' => $lineName,
            'routeName' => 'Route 01',
            'directionName' => $direction,
            'color' => '#d32f2f',
            'routeMode' => 'imported'
        ],
        'meta' => [
            'source' => 'VBB API Import (HAFAS 2.52)',
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
if ($city === '') {
    $city = 'cottbus';
}

if ($lineQuery === '') {
    vbb_json_error(400, 'Bitte eine Linie angeben.');
}

$cityQuery = vbb_slug_to_city_query($city);
$stopsByCity = vbb_extract_stops_by_city($cfg, $cityQuery);
if (!$stopsByCity) {
    vbb_json_error(502, 'VBB-Ortssuche fehlgeschlagen oder lieferte keine Haltestellen.');
}

$candidates = vbb_collect_candidates($cfg, $lineQuery, $stopsByCity);
if (!$candidates) {
    echo json_encode([
        'ok' => true,
        'candidates' => [],
        'message' => 'Keine passenden Abfahrten für diese Linie gefunden.'
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($action === 'search') {
    echo json_encode([
        'ok' => true,
        'candidates' => array_slice($candidates, 0, 20)
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$lineId = trim(strval($input['lineId'] ?? ''));
if ($lineId === '') {
    $lineId = strval($candidates[0]['id']);
}

$selected = null;
foreach ($candidates as $candidate) {
    if (strval($candidate['id']) === $lineId) {
        $selected = $candidate;
        break;
    }
}
if (!$selected) {
    vbb_json_error(404, 'Gewählte Fahrt wurde nicht gefunden.');
}

$detail = vbb_request($cfg, '/journeyDetail', [
    'id' => $lineId
]);
if (!$detail['ok']) {
    vbb_json_error(502, 'Journey-Detail konnte nicht geladen werden: ' . ($detail['error'] ?? 'Unbekannter Fehler'));
}

$mapped = vbb_map_journey_to_editor_line($detail['data'], $lineQuery, $city, strval($selected['direction'] ?? ''));
if (count($mapped['stops']) < 2) {
    vbb_json_error(422, 'Fahrt gefunden, aber ohne nutzbare Stopdaten für den Import.');
}

echo json_encode([
    'ok' => true,
    'line' => $mapped,
    'selected' => $selected,
    'stopCount' => count($mapped['stops']),
    'routePointCount' => count($mapped['routePoints'])
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
