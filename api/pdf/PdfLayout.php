<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Provides future reusable layout primitives for PDF 3.0.
 */
final class PdfLayout
{
    private string $stream = '';

    public function drawHeaderArea(array $options = []): void
    {
        $this->drawText(48, 790, (string) ($options['logoText'] ?? ''), 17, true);
        $this->drawText(365, 790, (string) ($options['title'] ?? ''), 16, true);
        $this->drawLine(48, 772, 547, 772, 1.1, [0.24, 0.36, 0.48]);
    }

    public function drawLogoBlock(array $branding = []): void
    {
        $this->drawText(48, 746, (string) ($branding['fallbackLogoText'] ?? ''), 9);
    }

    public function drawTitleBlock(string $title = '', array $options = []): void
    {
        $this->drawText(
            (float) ($options['x'] ?? 48),
            (float) ($options['y'] ?? 720),
            $title,
            (float) ($options['size'] ?? 12),
            true
        );
    }

    public function drawMetaLine(string $label = '', string $value = '', array $options = []): void
    {
        $x = (float) ($options['x'] ?? 48);
        $y = (float) ($options['y'] ?? 700);
        $this->drawText($x, $y, $label, 9, true);
        $this->drawText($x + 75, $y, $value, 10);
    }

    public function drawInfoBox(array $content = [], array $options = []): void
    {
        $x = (float) ($options['x'] ?? 48);
        $y = (float) ($options['y'] ?? 650);
        $width = (float) ($options['width'] ?? 240);
        $height = (float) ($options['height'] ?? 170);
        $titleHeight = 28.0;

        $this->drawRectangle($x, $y - $height, $width, $height, [1, 1, 1], [0.72, 0.75, 0.78]);
        $this->drawRectangle(
            $x,
            $y - $titleHeight,
            $width,
            $titleHeight,
            [0.93, 0.94, 0.95],
            [0.72, 0.75, 0.78]
        );
        $this->drawText($x + 14, $y - 19, (string) ($options['title'] ?? 'Informationen'), 10, true);

        $rowY = $y - 52;
        foreach ($content as $label => $value) {
            $this->drawInfoLabel((string) $label, ['x' => $x + 14, 'y' => $rowY]);
            $this->drawInfoValue((string) $value, ['x' => $x + 105, 'y' => $rowY]);
            $rowY -= 24;
        }
    }

    public function drawInfoLabel(string $label = '', array $options = []): void
    {
        $this->drawText(
            (float) ($options['x'] ?? 48),
            (float) ($options['y'] ?? 600),
            $label,
            9,
            true
        );
    }

    public function drawInfoValue(string $value = '', array $options = []): void
    {
        $this->drawText(
            (float) ($options['x'] ?? 150),
            (float) ($options['y'] ?? 600),
            $value,
            10
        );
    }

    public function drawInfoGrid(array $boxes = [], array $options = []): void
    {
        $x = (float) ($options['x'] ?? 48);
        $y = (float) ($options['y'] ?? 680);
        $gap = (float) ($options['gap'] ?? 18);
        $width = (float) ($options['boxWidth'] ?? 240);

        foreach ($boxes as $index => $box) {
            $this->drawInfoBox(
                is_array($box['content'] ?? null) ? $box['content'] : [],
                [
                    'x' => $x + ($index * ($width + $gap)),
                    'y' => $y,
                    'width' => $width,
                    'height' => (float) ($options['boxHeight'] ?? 170),
                    'title' => (string) ($box['title'] ?? 'Informationen'),
                ]
            );
        }
    }

    public function drawFooter(string $version, int $pageNumber, int $pageCount): void
    {
        $this->drawLine(48, 52, 547, 52, 0.6, [0.65, 0.68, 0.71]);
        $this->drawText(48, 34, 'Erstellt mit Lehrfahrer®', 8);
        $this->drawText(248, 34, $version, 8);
        $this->drawText(475, 34, "Seite {$pageNumber} von {$pageCount}", 8);
    }

    public function getStream(): string
    {
        return $this->stream;
    }

    private function drawText(float $x, float $y, string $text, float $size, bool $bold = false): void
    {
        $font = $bold ? 'F2' : 'F1';
        $escaped = PdfHelpers::escapePdfText($text);
        $this->stream .= "0 g\nBT\n/{$font} {$size} Tf\n{$x} {$y} Td\n({$escaped}) Tj\nET\n";
    }

    private function drawLine(
        float $x1,
        float $y1,
        float $x2,
        float $y2,
        float $width,
        array $color
    ): void {
        $this->stream .= implode(' ', $color) . " RG\n{$width} w\n{$x1} {$y1} m\n{$x2} {$y2} l\nS\n";
    }

    private function drawRectangle(
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
}
