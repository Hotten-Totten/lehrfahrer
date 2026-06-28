<?php

declare(strict_types=1);

use Lehrfahrer\Pdf\PdfBranding;
use Lehrfahrer\Pdf\PdfHelpers;
use Lehrfahrer\Pdf\PdfPreviewV2;

require_once __DIR__ . '/PdfHelpers.php';
require_once __DIR__ . '/PdfBranding.php';
require_once __DIR__ . '/PdfPreviewV2.php';

$rawInput = file_get_contents('php://input');
$project = trim($rawInput) !== '' ? json_decode($rawInput, true) : null;
if (trim($rawInput) !== '' && !is_array($project)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Die übergebenen Projektdaten sind kein gültiges JSON.';
    exit;
}

if (!is_array($project)) {
    $stopNames = [
        'Betriebshof',
        'Nordring',
        'Universität',
        'Stadthalle',
        'Hauptbahnhof',
        'Spremberger Straße',
        'Blechen Carré',
        'Marienstraße',
        'Leipziger Straße',
        'Thiemstraße',
        'Sportzentrum',
        'Sachsendorf',
        'Gelsenkirchener Allee',
        'Zielona-Góra-Straße',
        'Priorgraben',
        'Madlow',
        'Kiekebuscher Straße',
        'Wendeschleife',
    ];
    $stops = [];
    foreach ($stopNames as $index => $name) {
        $stops[] = [
            'id' => 'demo_stop_' . ($index + 1),
            'catalogId' => 'demo_' . ($index + 1),
            'sourceType' => 'catalog',
            'type' => 'stop',
            'name' => $name,
            'order' => $index + 1,
        ];
    }

    $project = [
        'lineName' => 'Linie 2',
        'routeName' => 'Route R01',
        'directionName' => 'Betriebshof über Hauptbahnhof nach Wendeschleife',
        'variantName' => 'Standardfahrt Süd',
        'variantCategory' => 'Standard',
        'description' => "Bemerkung: Ausbildungsfahrt mit Wendeschleife.\n"
            . "Besonderheiten: Engstelle am Nordring; Langsamfahrt im Betriebshof; "
            . "Abfahrt an der Wendeschleife beachten.",
        'specialNotes' => [
            'Engstelle am Nordring',
            'Langsamfahrt im Betriebshof',
            'Abfahrt an der Wendeschleife beachten',
        ],
        'validFrom' => '2026-07-01',
        'savedAt' => '2026-06-28T12:00:00+02:00',
        'formatVersion' => 'PDF 3.0 Preview V2',
        'stops' => $stops,
        'stats' => [
            'routeLengthMeters' => 11400,
            'estimatedDriveMinutes' => 29,
            'stopCount' => count($stops),
        ],
    ];
}

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="Lehrfahrer_PDF_3_Preview_V2.pdf"');
header('Cache-Control: no-store');

echo (new PdfPreviewV2())->render($project);
