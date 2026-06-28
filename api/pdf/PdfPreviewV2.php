<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Renders the independent PDF 3.0 Preview V2 with its own page geometry.
 */
final class PdfPreviewV2
{
    private string $stream = '';
    private array $completedStreams = [];

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
        $tableBottom = $this->drawStopTable($this->prepareStops($project), $branding);
        $this->drawSpecialNotes((string) $data['description'], $tableBottom, $branding);

        return $this->buildPdf($branding);
    }

    private function drawHeader(array $data, array $branding): void
    {
        $primary = $this->color($branding['primaryColor'], [0.2, 0.31, 0.41]);

        $this->text(62, 775, (string) $branding['fallbackLogoText'], 16, true);
        $this->text(210, 772, (string) $data['title'], 22, true);
        $this->rectangle(489, 758, 40, 40, [1, 1, 1], $primary);
        $this->text(502, 775, 'QR', 8, true);
        $this->line(42, 730, 553, 730, 1.1, $primary);
    }

    private function drawInformationArea(array $data, array $branding): void
    {
        $leftRows = [
            'Linie' => (string) $data['line'],
            'Route' => (string) $data['route'],
            'Richtung' => (string) $data['direction'],
        ];
        $rightRows = [
            'Variante' => (string) $data['variant'],
            'Kategorie' => (string) $data['category'],
            'Gültigkeit' => (string) $data['validFrom'],
        ];

        $y = 700.0;
        foreach ($leftRows as $label => $value) {
            $this->text(42, $y, $label, 9, true);
            foreach ($this->wrap($value, 31, 2) as $lineIndex => $line) {
                $this->text(112, $y - ($lineIndex * 11), $line, 9);
            }
            $y -= $label === 'Richtung' ? 34 : 23;
        }

        $y = 700.0;
        foreach ($rightRows as $label => $value) {
            $this->text(320, $y, $label, 9, true);
            foreach ($this->wrap($value, 25, 2) as $lineIndex => $line) {
                $this->text(400, $y - ($lineIndex * 11), $line, 9);
            }
            $y -= 23;
        }
    }

    private function drawStopTable(array $stops, array $branding): float
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);
        $tableTop = 591.0;
        $this->text(42, 615, 'Haltestellen und Fahranweisungen', 13, true);
        $rowTop = $this->drawStopTableHeader($tableTop, $border, $accent);

        foreach ($stops as $stop) {
            $stopLines = $this->wrap((string) ($stop['stop'] ?? ''), 35, 4);
            $instructionLines = $this->wrap((string) ($stop['instruction'] ?? ''), 43, 8);
            $lineCount = max(count($stopLines), count($instructionLines), 1);
            $rowHeight = max(22, 10 + ($lineCount * 11));

            if ($rowTop - $rowHeight < 120) {
                $this->newPage();
                $this->text(42, 808, 'Haltestellen und Fahranweisungen', 13, true);
                $rowTop = $this->drawStopTableHeader(790, $border, $accent);
            }

            $rowBottom = $rowTop - $rowHeight;
            $this->rectangle(42, $rowBottom, 511, $rowHeight, [1, 1, 1], $border);
            $this->line(93, $rowBottom, 93, $rowTop, 0.5, $border);
            $this->line(297, $rowBottom, 297, $rowTop, 0.5, $border);
            $textY = $rowTop - 15;
            $this->text(63, $textY, (string) ($stop['number'] ?? ''), 8);
            foreach ($stopLines as $lineIndex => $line) {
                $this->text(103, $textY - ($lineIndex * 11), $line, 8.5, true);
            }
            foreach ($instructionLines as $lineIndex => $line) {
                $this->text(307, $textY - ($lineIndex * 11), $line, 7.8);
            }
            $rowTop = $rowBottom;
        }

        return $rowTop;
    }

    private function drawStopTableHeader(float $top, array $border, array $accent): float
    {
        $bottom = $top - 24;
        $this->rectangle(42, $bottom, 511, 24, $accent, $border);
        $this->line(93, $bottom, 93, $top, 0.5, $border);
        $this->line(297, $bottom, 297, $top, 0.5, $border);
        $this->text(61, $bottom + 8, 'Nr.', 9, true);
        $this->text(171, $bottom + 8, 'Haltestelle', 9, true);
        $this->text(418, $bottom + 8, 'Hinweise', 9, true);
        $this->line(42, $bottom, 553, $bottom, 1.0, $border);
        return $bottom;
    }

    private function drawSpecialNotes(string $description, float $tableBottom, array $branding): void
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);
        $lines = $this->wrap($description !== '' ? $description : 'Keine Besonderheiten hinterlegt.', 82, 4);
        $height = 42 + (count($lines) * 13);
        $top = $tableBottom - 57;

        if ($top - $height < 70) {
            $this->newPage();
            $top = 790;
        }

        $this->rectangle(42, $top - $height, 511, $height, [1, 1, 1], $border);
        $this->rectangle(42, $top - 26, 511, 26, $accent, $border);
        $this->text(56, $top - 18, 'Besonderheiten', 10, true);
        foreach ($lines as $index => $line) {
            $this->text(56, $top - 45 - ($index * 13), $line, 8.5);
        }
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

    private function crop(string $text, int $length): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        if (strlen($text) <= $length) {
            return $text;
        }
        return rtrim(substr($text, 0, $length - 3)) . '...';
    }

    private function prepareStops(array $project): array
    {
        $result = [];
        foreach (is_array($project['stops'] ?? null) ? $project['stops'] : [] as $stop) {
            if (!is_array($stop) || $this->isTechnicalStop($stop)) {
                continue;
            }
            $name = trim((string) ($stop['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $result[] = [
                'number' => count($result) + 1,
                'stop' => $name,
                'instruction' => $this->findDrivingInstruction($stop),
            ];
        }
        return $result;
    }

    private function isTechnicalStop(array $stop): bool
    {
        foreach (['isGhostPoint', 'isGhost', 'ghost', 'synthetic', 'manual', 'isRoutePoint', 'isGuidePoint'] as $flag) {
            if (!empty($stop[$flag])) {
                return true;
            }
        }
        $technical = ['ghost', 'synthetic', 'manual', 'routepoint', 'route_point', 'guidepoint', 'guide_point', 'geometry', 'passthrough', 'passthroughstop'];
        foreach (['sourceType', 'type', 'stopType', 'kind', 'detourRole'] as $field) {
            if (in_array(strtolower(trim((string) ($stop[$field] ?? ''))), $technical, true)) {
                return true;
            }
        }
        return false;
    }

    private function findDrivingInstruction(array $stop): string
    {
        // Busbezogene Hinweise können später u. a. Abbiegen, Kreisverkehr,
        // Vorfahrt, Engstellen, Bussteige, Ersatzhalte, Wendestellen und Umleitungen abbilden.
        $instructions = [];
        foreach ([
            'nextDrivingInstruction',
            'nextInstruction',
            'drivingInstruction',
            'instruction',
            'turnInstruction',
            'routeInstruction',
            'drivingHint',
            'travelHint',
            'fahrhinweis',
            'nextManeuver',
            'nextManoeuvre',
            'hint',
            'hints',
            'note',
            'notes',
            'remark',
            'remarks',
            'specialNote',
            'specialNotes',
            'warning',
            'warnings',
            'drivingInstructions',
        ] as $key) {
            $this->appendInstructionValues($instructions, $stop[$key] ?? null);
        }
        foreach (['maneuver', 'manoeuvre', 'navigation', 'instructionData'] as $containerKey) {
            $container = $stop[$containerKey] ?? null;
            if (!is_array($container)) {
                continue;
            }
            foreach (['instruction', 'text', 'description', 'name', 'hint', 'note', 'warning'] as $key) {
                $this->appendInstructionValues($instructions, $container[$key] ?? null);
            }
        }
        return implode("\n", array_values(array_unique($instructions)));
    }

    private function appendInstructionValues(array &$instructions, $value): void
    {
        if (is_string($value)) {
            foreach (preg_split('/\R/u', trim($value)) as $line) {
                $line = trim($line);
                if ($line !== '' && $line !== '-') {
                    $instructions[] = $line;
                }
            }
            return;
        }
        if (!is_array($value)) {
            return;
        }
        $items = array_keys($value) === range(0, count($value) - 1)
            ? $value
            : array_intersect_key($value, array_flip([
                'instruction',
                'text',
                'description',
                'name',
                'hint',
                'note',
                'remark',
                'warning',
            ]));
        foreach ($items as $item) {
            if (is_string($item) || is_array($item)) {
                $this->appendInstructionValues($instructions, $item);
            }
        }
    }

    private function newPage(): void
    {
        $this->completedStreams[] = $this->stream;
        $this->stream = '';
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

    private function buildPdf(array $branding): string
    {
        $streams = array_merge($this->completedStreams, [$this->stream]);
        $pageCount = count($streams);
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        foreach ($streams as $index => &$stream) {
            $footer = '';
            $originalStream = $this->stream;
            $this->stream = '';
            $this->line(42, 52, 553, 52, 0.6, $border);
            $this->text(42, 34, 'Erstellt mit Lehrfahrer®', 8);
            $this->text(225, 34, (string) $branding['website'], 8);
            $this->text(395, 34, 'Preview V2', 8);
            $this->text(492, 34, 'Seite ' . ($index + 1) . ' von ' . $pageCount, 8);
            $footer = $this->stream;
            $this->stream = $originalStream;
            $stream .= $footer;
        }
        unset($stream);

        $objects = [
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '',
            3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
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
            . '] /Count ' . $pageCount . ' >>';

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        for ($id = 1; $id < $nextId; $id++) {
            $object = $objects[$id] ?? '';
            $offsets[$id] = strlen($pdf);
            $pdf .= "{$id} 0 obj\n{$object}\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= "xref\n0 {$nextId}\n0000000000 65535 f \n";
        for ($id = 1; $id < $nextId; $id++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$id]);
        }
        return $pdf . "trailer\n<< /Size {$nextId} /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    }
}
