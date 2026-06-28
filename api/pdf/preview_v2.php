<?php

declare(strict_types=1);

use Lehrfahrer\Pdf\PdfBranding;
use Lehrfahrer\Pdf\PdfHelpers;
use Lehrfahrer\Pdf\PdfPreviewV2;

require_once __DIR__ . '/PdfHelpers.php';
require_once __DIR__ . '/PdfBranding.php';
require_once __DIR__ . '/PdfPreviewV2.php';

try {
    $project = [
        'lineName' => 'Linie 2',
        'routeName' => 'Route 01',
        'directionName' => 'Betriebshof Schmellwitz - Jessener Straße',
        'variantName' => 'Preview V2',
        'variantCategory' => 'Standard',
        'description' => 'Testhinweis',
        'validFrom' => '2026-07-01',
        'savedAt' => '2026-06-28',
        'formatVersion' => 'PDF 3.0 Preview V2',
        'stops' => [
            [
                'name' => 'Betriebshof Schmellwitz',
                'sourceType' => 'catalog',
                'type' => 'stop',
            ],
            [
                'name' => 'Nordring',
                'sourceType' => 'catalog',
                'type' => 'stop',
                'hint' => 'Engstelle bei der Ausfahrt beachten',
            ],
            [
                'name' => 'Technische Ghosthaltestelle',
                'isGhost' => true,
                'sourceType' => 'manual',
            ],
            [
                'name' => 'Ersatzhaltestelle Musterstraße',
                'sourceType' => 'manual',
                'manual' => true,
                'kind' => 'replacementStop',
                'hint' => 'Ersatzhaltestelle bedienen',
            ],
            [
                'name' => 'Hauptbahnhof',
                'sourceType' => 'catalog',
                'type' => 'stop',
            ],
            [
                'name' => 'Jessener Straße',
                'sourceType' => 'catalog',
                'type' => 'stop',
                'hint' => 'Ziel erreicht',
            ],
        ],
        'stats' => [
            'routeLengthMeters' => 11400,
            'estimatedDriveMinutes' => 29,
        ],
    ];

    $pdf = (new PdfPreviewV2())->render($project);
    if (!str_starts_with($pdf, '%PDF-')) {
        throw new RuntimeException('Die PDF-Preview konnte nicht erzeugt werden.');
    }

    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="Lehrfahrer_PDF_3_Preview_V2.pdf"');
    header('Content-Length: ' . strlen($pdf));
    header('Cache-Control: no-store');
    echo $pdf;
} catch (Throwable $error) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'PDF-Preview V2 konnte nicht erzeugt werden: ' . $error->getMessage();
}
