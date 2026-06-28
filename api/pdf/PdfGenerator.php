<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Future entry point for generating PDF 3.0 documents.
 */
final class PdfGenerator
{
    public function generatePreview(): string
    {
        $layout = new PdfLayout();
        $sections = new PdfSections();
        $branding = new PdfBranding([
            'fallbackLogoText' => 'Lehrfahrer®',
            'primaryColor' => '#3D5D7A',
            'secondaryColor' => '#B8BEC5',
            'accentColor' => '#ECEFF2',
            'website' => 'www.lehrfahrer.de',
        ]);
        $data = [
            'title' => 'Streckeneinweisung',
            'line' => '2',
            'route' => 'R01',
            'direction' => 'Schmellwitz',
            'distance' => '11,4 km',
            'stopCount' => '18',
            'variant' => 'Standard',
            'category' => 'Straßenbahn',
            'duration' => '29 min',
            'validFrom' => '01.07.2026',
            'version' => 'PDF 3.0 Preview',
        ];

        $sections->renderHeader($data, $branding, $layout);
        $sections->renderInfoBoxes($data, $layout, new PdfHelpers());
        $sections->renderStopTable([
            ['number' => 1, 'stop' => 'Hauptbahnhof', 'instruction' => 'Geradeaus'],
            ['number' => 2, 'stop' => 'Stadthalle', 'instruction' => 'Links halten'],
            ['number' => 3, 'stop' => 'Nordring', 'instruction' => 'Rechts abbiegen'],
        ], $layout);
        $sections->renderSpecialNotes([
            'Langsamfahrt im Haltestellenbereich.',
            'Wendeschleife mit Gegenverkehr beachten.',
        ], $layout);
        $sections->renderTrainingRecord([
            'Fahrer',
            'Datum',
            'Unterschrift Fahrer',
            'Unterschrift Einweiser',
        ], $layout);
        $sections->renderFooter('Preview', 1, 1, $branding, $layout);

        return $this->buildPdf($layout->getStream());
    }

    public function generateProjectPreview(array $project): string
    {
        $layout = new PdfLayout();
        $sections = new PdfSections();
        $branding = new PdfBranding([
            'fallbackLogoText' => 'Lehrfahrer®',
            'primaryColor' => '#3D5D7A',
            'secondaryColor' => '#B8BEC5',
            'accentColor' => '#ECEFF2',
            'website' => 'www.lehrfahrer.de',
        ]);
        $data = PdfHelpers::prepareProjectData($project);

        $sections->renderHeader($data, $branding, $layout);
        $sections->renderInfoBoxes($data, $layout, new PdfHelpers());
        $sections->renderStopTable($data['stops'], $layout);
        $sections->renderSpecialNotes(
            [$data['description'] !== '' ? $data['description'] : 'Keine Besonderheiten hinterlegt.'],
            $layout
        );
        $sections->renderTrainingRecord([
            'Fahrer',
            'Datum',
            'Unterschrift Fahrer',
            'Unterschrift Einweiser',
        ], $layout);

        $streams = $layout->getStreams();
        $pageCount = count($streams);
        foreach ($streams as $index => $stream) {
            $footerLayout = new PdfLayout();
            $footerLayout->applyBranding($branding->toArray());
            $sections->renderFooter('PDF 3.0 Preview', $index + 1, $pageCount, $branding, $footerLayout);
            $streams[$index] = $stream . $footerLayout->getStream();
        }

        return $this->buildPdfPages($streams);
    }

    private function buildPdf(string $stream): string
    {
        $objects = [
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
            3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
            5 => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
                . '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>',
            6 => "<< /Length " . strlen($stream) . " >>\nstream\n{$stream}\nendstream",
        ];

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        foreach ($objects as $id => $object) {
            $offsets[$id] = strlen($pdf);
            $pdf .= "{$id} 0 obj\n{$object}\nendobj\n";
        }

        $xref = strlen($pdf);
        $pdf .= "xref\n0 7\n0000000000 65535 f \n";
        for ($id = 1; $id <= 6; $id++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
        }

        return $pdf . "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    }

    private function buildPdfPages(array $streams): string
    {
        $objects = [
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '',
            3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
        ];
        $nextId = 5;
        $pageIds = [];
        foreach ($streams as $stream) {
            $contentId = $nextId++;
            $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n{$stream}\nendstream";
            $pageId = $nextId++;
            $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                . "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {$contentId} 0 R >>";
            $pageIds[] = $pageId;
        }
        $objects[2] = '<< /Type /Pages /Kids ['
            . implode(' ', array_map(static fn (int $id): string => "{$id} 0 R", $pageIds))
            . '] /Count ' . count($pageIds) . ' >>';

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        for ($id = 1; $id < $nextId; $id++) {
            $offsets[$id] = strlen($pdf);
            $pdf .= "{$id} 0 obj\n" . ($objects[$id] ?? '') . "\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= "xref\n0 {$nextId}\n0000000000 65535 f \n";
        for ($id = 1; $id < $nextId; $id++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
        }
        return $pdf . "trailer\n<< /Size {$nextId} /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    }
}
