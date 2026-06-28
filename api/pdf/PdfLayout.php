<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Provides future reusable layout primitives for PDF 3.0.
 */
final class PdfLayout
{
    private string $stream = '';
    private array $completedStreams = [];
    private array $branding = [];

    public function applyBranding(array $branding): void
    {
        $this->branding = $branding;
    }

    public function drawHeaderArea(array $options = []): void
    {
        $this->drawText(48, 790, (string) ($options['logoText'] ?? ''), 17, true);
        $primary = $this->color('primaryColor', [0.24, 0.36, 0.48]);
        $this->drawText(218, 790, (string) ($options['title'] ?? ''), 18, true);
        $this->drawRectangle(505, 770, 42, 42, [1, 1, 1], $primary);
        $this->drawText(518, 788, 'QR', 9, true);
        $this->drawLine(48, 755, 547, 755, 1.1, $primary);
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

        $border = $this->color('secondaryColor', [0.72, 0.75, 0.78]);
        $heading = $this->color('accentColor', [0.93, 0.94, 0.95]);
        $this->drawRectangle($x, $y - $height, $width, $height, [1, 1, 1], $border);
        $this->drawRectangle(
            $x,
            $y - $titleHeight,
            $width,
            $titleHeight,
            $heading,
            $border
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

    public function drawStopTable(array $rows): void
    {
        $border = $this->color('secondaryColor', [0.72, 0.75, 0.78]);
        $heading = $this->color('accentColor', [0.93, 0.94, 0.95]);
        $this->drawText(48, 475, 'Haltestellen und Fahranweisungen', 12, true);
        $top = 455.0;
        $rowHeight = 24.0;
        $this->drawRectangle(48, $top - $rowHeight, 499, $rowHeight, $heading, $border);
        $this->drawText(60, $top - 16, 'Nr.', 9, true);
        $this->drawText(103, $top - 16, 'Haltestelle', 9, true);
        $this->drawText(350, $top - 16, 'Fahrhinweis', 9, true);

        foreach ($rows as $index => $row) {
            if ($index === 5 || ($index > 5 && (($index - 5) % 18) === 0)) {
                $this->newPage();
                $top = 760.0;
                $this->drawText(48, 785, 'Haltestellen und Fahranweisungen', 12, true);
                $this->drawRectangle(48, $top - $rowHeight, 499, $rowHeight, $heading, $border);
                $this->drawText(60, $top - 16, 'Nr.', 9, true);
                $this->drawText(103, $top - 16, 'Haltestelle', 9, true);
                $this->drawText(350, $top - 16, 'Fahrhinweis', 9, true);
            }
            $pageRowIndex = $index < 5 ? $index : (($index - 5) % 18);
            $rowTop = $top - (($pageRowIndex + 1) * $rowHeight);
            $this->drawRectangle(48, $rowTop - $rowHeight, 499, $rowHeight, [1, 1, 1], $border);
            $this->drawText(60, $rowTop - 16, (string) ($row['number'] ?? ''), 9);
            $this->drawText(103, $rowTop - 16, (string) ($row['stop'] ?? ''), 9);
            $this->drawText(350, $rowTop - 16, (string) ($row['instruction'] ?? ''), 9);
        }

        $visibleRows = count($rows) <= 5 ? count($rows) : ((count($rows) - 5 - 1) % 18) + 1;
        $bottom = $top - (($visibleRows + 1) * $rowHeight);
        $this->drawLine(88, $top, 88, $bottom, 0.7, $border);
        $this->drawLine(335, $top, 335, $bottom, 0.7, $border);
    }

    public function drawSpecialNotes(array $notes): void
    {
        $border = $this->color('secondaryColor', [0.72, 0.75, 0.78]);
        $heading = $this->color('accentColor', [0.93, 0.94, 0.95]);
        $this->drawRectangle(48, 235, 499, 92, [1, 1, 1], $border);
        $this->drawRectangle(48, 303, 499, 24, $heading, $border);
        $this->drawText(60, 311, 'Besonderheiten', 10, true);
        foreach ($notes as $index => $note) {
            $this->drawText(62, 286 - ($index * 16), '- ' . (string) $note, 9);
        }
    }

    public function drawTrainingRecord(array $fields): void
    {
        $border = $this->color('secondaryColor', [0.72, 0.75, 0.78]);
        $heading = $this->color('accentColor', [0.93, 0.94, 0.95]);
        $this->drawRectangle(48, 78, 499, 137, [1, 1, 1], $border);
        $this->drawRectangle(48, 191, 499, 24, $heading, $border);
        $this->drawText(60, 199, 'Nachweis der Streckeneinweisung', 10, true);
        $positions = [169, 145, 116, 88];
        foreach (array_values($fields) as $index => $field) {
            if (!isset($positions[$index])) {
                break;
            }
            $this->drawText(60, $positions[$index], (string) $field, 9, true);
            $this->drawLine(190, $positions[$index] - 3, 525, $positions[$index] - 3, 0.6, $border);
        }
    }

    public function drawFooter(
        string $version,
        int $pageNumber,
        int $pageCount,
        string $website = ''
    ): void
    {
        $this->drawLine(48, 52, 547, 52, 0.6, [0.65, 0.68, 0.71]);
        $this->drawText(48, 34, 'Erstellt mit Lehrfahrer®', 8);
        $this->drawText(205, 34, $website, 8);
        $this->drawText(360, 34, $version, 8);
        $this->drawText(475, 34, "Seite {$pageNumber} von {$pageCount}", 8);
    }

    public function getStream(): string
    {
        return $this->stream;
    }

    public function getStreams(): array
    {
        return array_merge($this->completedStreams, [$this->stream]);
    }

    private function newPage(): void
    {
        $this->completedStreams[] = $this->stream;
        $this->stream = '';
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

    private function color(string $key, array $fallback): array
    {
        $value = ltrim((string) ($this->branding[$key] ?? ''), '#');
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $value)) {
            return $fallback;
        }

        return [
            hexdec(substr($value, 0, 2)) / 255,
            hexdec(substr($value, 2, 2)) / 255,
            hexdec(substr($value, 4, 2)) / 255,
        ];
    }
}
