<?php

declare(strict_types=1);

use Lehrfahrer\Pdf\PdfBranding;
use Lehrfahrer\Pdf\PdfGenerator;
use Lehrfahrer\Pdf\PdfHelpers;
use Lehrfahrer\Pdf\PdfLayout;
use Lehrfahrer\Pdf\PdfSections;

require_once __DIR__ . '/PdfHelpers.php';
require_once __DIR__ . '/PdfBranding.php';
require_once __DIR__ . '/PdfLayout.php';
require_once __DIR__ . '/PdfSections.php';
require_once __DIR__ . '/PdfGenerator.php';

// Development-only preview. POST a project JSON to render real project data.
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="Lehrfahrer_PDF_3_Preview.pdf"');
header('Cache-Control: no-store');

$rawInput = file_get_contents('php://input');
$project = $rawInput !== '' ? json_decode($rawInput, true) : null;
if (!is_array($project)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Für die PDF-3.0-Preview werden Projektdaten als JSON benötigt.';
    exit;
}

echo (new PdfGenerator())->generateProjectPreview($project);
