<?php
declare(strict_types=1);

/** Der GPX-Begleiter entsteht aus genau den Daten des JSON-Save-Requests. */
function lehrfahrer_route_gpx_coordinate(mixed $point): ?array {
    if (!is_array($point)) return null;
    $lat = $point['lat'] ?? $point[0] ?? null;
    $lon = $point['lon'] ?? $point[1] ?? null;
    if (!is_numeric($lat) || !is_numeric($lon)) return null;
    $lat = (float)$lat; $lon = (float)$lon;
    if (!is_finite($lat) || !is_finite($lon) || abs($lat) > 90 || abs($lon) > 180) return null;
    return [$lat, $lon];
}

function lehrfahrer_route_gpx_xml(mixed $value): string {
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function lehrfahrer_route_gpx_from_data(array $data): string {
    $stops = is_array($data['stops'] ?? null) ? $data['stops'] : [];
    $candidate = $data['routePointsSimplified'] ?? null;
    if (!is_array($candidate) || count($candidate) < 2) $candidate = $data['routePoints'] ?? null;
    if (!is_array($candidate) || count($candidate) < 2) $candidate = $stops;
    if (!is_array($candidate)) throw new RuntimeException('GPX benoetigt mindestens zwei Routenpunkte.');
    $points = array_values(array_filter(array_map('lehrfahrer_route_gpx_coordinate', $candidate)));
    if (count($points) < 2) throw new RuntimeException('GPX benoetigt mindestens zwei gueltige Routenpunkte.');

    $parts = array_filter(array_map(static fn(string $key): string => trim((string)($data[$key] ?? '')),
        ['lineName', 'routeName', 'directionName']), static fn(string $part): bool => $part !== '');
    $name = lehrfahrer_route_gpx_xml($parts === [] ? 'Linie' : implode(' - ', $parts));
    $color = lehrfahrer_route_gpx_xml(trim((string)($data['color'] ?? '#d32f2f')));
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<gpx version="1.1" creator="Lehrfahrer Linieneditor" xmlns="http://www.topografix.com/GPX/1/1">' . "\n"
        . '  <metadata><name>' . $name . '</name><desc>Export aus dem Lehrfahrer Linieneditor | Farbe: '
        . $color . '</desc></metadata>' . "\n";
    $number = 0;
    foreach ($stops as $stop) {
        $coordinate = lehrfahrer_route_gpx_coordinate($stop);
        if ($coordinate === null) continue;
        $number++;
        $stopName = lehrfahrer_route_gpx_xml($stop['name'] ?? ('Haltestelle ' . $number));
        $minute = lehrfahrer_route_gpx_xml($stop['minuteFromStart'] ?? $stop['minute'] ?? $stop['minutesFromStart'] ?? 0);
        $note = trim((string)($stop['note'] ?? ''));
        $description = 'Stopp ' . $number . ' | SollMinute: ' . $minute
            . ($note !== '' ? ' | Info: ' . lehrfahrer_route_gpx_xml($note) : '');
        $xml .= '  <wpt lat="' . $coordinate[0] . '" lon="' . $coordinate[1] . '"><name>'
            . $stopName . '</name><cmt>SollMinute:' . $minute . ';Stop:' . $number
            . '</cmt><desc>' . $description . '</desc></wpt>' . "\n";
    }
    $xml .= '  <trk><name>' . $name . '</name><desc>Route fuer Maps.me Offline-Nutzung</desc><trkseg>' . "\n";
    foreach ($points as [$lat, $lon]) $xml .= '    <trkpt lat="' . $lat . '" lon="' . $lon . '"></trkpt>' . "\n";
    return $xml . "  </trkseg></trk>\n</gpx>";
}
