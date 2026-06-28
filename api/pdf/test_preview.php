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

// Development-only preview with static sample data.
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="Lehrfahrer_PDF_3_Preview.pdf"');
header('Cache-Control: no-store');

echo (new PdfGenerator())->generatePreview();
