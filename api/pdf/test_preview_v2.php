<?php

declare(strict_types=1);

use Lehrfahrer\Pdf\PdfBranding;
use Lehrfahrer\Pdf\PdfHelpers;
use Lehrfahrer\Pdf\PdfPreviewV2;

require_once __DIR__ . '/PdfHelpers.php';
require_once __DIR__ . '/PdfBranding.php';
require_once __DIR__ . '/PdfPreviewV2.php';

$rawInput = file_get_contents('php://input');
$project = $rawInput !== '' ? json_decode($rawInput, true) : null;
if (!is_array($project)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Für die PDF-3.0-Preview V2 werden Projektdaten als JSON benötigt.';
    exit;
}

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="Lehrfahrer_PDF_3_Preview_V2.pdf"');
header('Cache-Control: no-store');

echo (new PdfPreviewV2())->render($project);
