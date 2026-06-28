<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Renders the independent PDF 3.0 Preview V2 with its own page geometry.
 */
final class PdfPreviewV2
{
    private string $stream = '';

    public function render(array $project): string
    {
        $data = PdfHelpers::prepareProjectData($project);
        $branding = (new PdfBranding([
            'fallbackLogoText' => 'Lehrfahrer®',
            'primaryColor' => '#344F68',
            'secondaryColor' => '#B8C0C7',
            'accentColor' => '#EEF1F3',
            'website' => 'www.lehrfahrer.de',
        ]))->toArray();

        $this->drawHeader($data, $branding);
        $this->drawInformationArea($data, $branding);
        $this->drawPreviewBody($data, $branding);
        $this->drawFooter($branding);

        return $this->buildPdf();
    }

    private function drawHeader(array $data, array $branding): void
    {
        $primary = $this->color($branding['primaryColor'], [0.2, 0.31, 0.41]);
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);

        $this->rectangle(42, 742, 511, 72, [1, 1, 1], $border);
        $this->line(178, 742, 178, 814, 0.7, $border);
        $this->line(465, 742, 465, 814, 0.7, $border);
        $this->text(62, 775, (string) $branding['fallbackLogoText'], 16, true);
        $this->text(210, 772, (string) $data['title'], 22, true);
        $this->rectangle(489, 758, 40, 40, [1, 1, 1], $primary);
        $this->text(502, 775, 'QR', 8, true);
        $this->line(42, 730, 553, 730, 1.1, $primary);
    }

    private function drawInformationArea(array $data, array $branding): void
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);

        $this->infoColumn(42, 690, 248, 160, 'Strecke', [
            'Linie' => $data['line'],
            'Route' => $data['route'],
            'Richtung' => $data['direction'],
        ], $border, $accent);
        $this->infoColumn(305, 690, 248, 160, 'Variante', [
            'Variante' => $data['variant'],
            'Kategorie' => $data['category'],
            'Gültig ab' => $data['validFrom'],
            'Erstellt' => $data['created'],
            'Version' => $data['version'],
        ], $border, $accent);
    }

    private function infoColumn(
        float $x,
        float $top,
        float $width,
        float $height,
        string $title,
        array $rows,
        array $border,
        array $accent
    ): void {
        $this->rectangle($x, $top - $height, $width, $height, [1, 1, 1], $border);
        $this->rectangle($x, $top - 28, $width, 28, $accent, $border);
        $this->text($x + 14, $top - 19, $title, 10, true);

        $y = $top - 54;
        foreach ($rows as $label => $value) {
            $this->text($x + 14, $y, (string) $label, 9, true);
            foreach ($this->wrap((string) $value, 28, 2) as $lineIndex => $line) {
                $this->text($x + 102, $y - ($lineIndex * 11), $line, 9);
            }
            $y -= $label === 'Richtung' ? 34 : 23;
        }
    }

    private function drawPreviewBody(array $data, array $branding): void
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);
        $this->text(42, 500, 'PDF 3.0 Preview V2', 13, true);
        $this->rectangle(42, 410, 511, 70, [1, 1, 1], $border);
        $this->rectangle(42, 456, 511, 24, $accent, $border);
        $this->text(56, 464, 'Dokumentvorschau', 10, true);
        $this->text(56, 438, 'Haltestellen: ' . (string) $data['stopCount'], 9);
        $this->text(210, 438, 'Streckenlänge: ' . (string) $data['distance'], 9);
        $this->text(390, 438, 'Fahrzeit: ' . (string) $data['duration'], 9);
    }

    private function drawFooter(array $branding): void
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $this->line(42, 52, 553, 52, 0.6, $border);
        $this->text(42, 34, 'Erstellt mit Lehrfahrer®', 8);
        $this->text(225, 34, (string) $branding['website'], 8);
        $this->text(395, 34, 'Preview V2', 8);
        $this->text(492, 34, 'Seite 1 von 1', 8);
    }

    private function text(float $x, float $y, string $text, float $size, bool $bold = false): void
    {
        $font = $bold ? 'F2' : 'F1';
        $this->stream .= "0 g\nBT\n/{$font} {$size} Tf\n{$x} {$y} Td\n("
            . PdfHelpers::escapePdfText($text) . ") Tj\nET\n";
    }

    private function line(float $x1, float $y1, float $x2, float $y2, float $width, array $color): void
    {
        $this->stream .= implode(' ', $color) . " RG\n{$width} w\n{$x1} {$y1} m\n{$x2} {$y2} l\nS\n";
    }

    private function rectangle(
        float $x,
        float $y,
        float $width,
        float $height,
        array $fill,
        array $stroke
    ): void {
        $this->stream .= implode(' ', $fill) . " rg\n"
            . implode(' ', $stroke) . " RG\n"
            . "0.7 w\n{$x} {$y} {$width} {$height} re\nB\n";
    }

    private function wrap(string $text, int $length, int $maxLines): array
    {
        $lines = explode("\n", wordwrap(trim($text), $length, "\n", true));
        if (count($lines) > $maxLines) {
            $lines = array_slice($lines, 0, $maxLines);
            $lines[$maxLines - 1] = rtrim(substr($lines[$maxLines - 1], 0, $length - 3)) . '...';
        }
        return $lines ?: [''];
    }

    private function color(string $hex, array $fallback): array
    {
        $hex = ltrim($hex, '#');
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            return $fallback;
        }
        return [
            hexdec(substr($hex, 0, 2)) / 255,
            hexdec(substr($hex, 2, 2)) / 255,
            hexdec(substr($hex, 4, 2)) / 255,
        ];
    }

    private function buildPdf(): string
    {
        $objects = [
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
            3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
            5 => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
                . '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>',
            6 => "<< /Length " . strlen($this->stream) . " >>\nstream\n{$this->stream}\nendstream",
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
}
