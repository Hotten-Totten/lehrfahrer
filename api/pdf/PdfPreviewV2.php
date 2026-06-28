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
    private string $documentVersion = 'PDF 3.0';
    private ?array $logoImage = null;

    public function render(array $project): string
    {
        $this->stream = '';
        $this->completedStreams = [];
        $this->logoImage = null;
        $data = PdfHelpers::prepareProjectData($project);
        $branding = PdfBranding::loadFromDirectory(dirname(__DIR__, 2) . '/assets/company')->toArray();
        $this->documentVersion = trim((string) $data['version']) ?: 'PDF 3.0';
        $this->logoImage = $this->prepareLogoImage((string) $branding['logoPath']);
        $stops = $this->prepareStops($project);
        $lineData = is_array($project['line'] ?? null) ? $project['line'] : [];
        $data['start'] = trim((string) (
            $project['startStopName']
            ?? $lineData['startStopName']
            ?? ($stops[0]['stop'] ?? '')
        ));
        $data['end'] = trim((string) (
            $project['endStopName']
            ?? $lineData['endStopName']
            ?? ($stops[count($stops) - 1]['stop'] ?? '')
        ));
        $data['stopCount'] = (string) count($stops);
        $data['distance'] = $data['distance'] === '-' ? '' : $data['distance'];
        $data['duration'] = $data['duration'] === '-' ? '' : $data['duration'];

        $this->drawHeader($data, $branding);
        $this->drawInformationArea($data, $branding);
        $tableTop = $this->drawSpecialNotes((string) $data['description'], $branding);
        $tableBottom = $this->drawStopTable($stops, $branding, $tableTop);
        $this->drawTrainingRecord($tableBottom, $branding);

        return $this->buildPdf($branding);
    }

    private function drawHeader(array $data, array $branding): void
    {
        $primary = $this->color($branding['primaryColor'], [0.2, 0.31, 0.41]);

        if ($this->logoImage !== null) {
            $this->drawLogoImage(50, 764, 112, 38);
        } else {
            $this->text(52, 775, (string) $branding['fallbackLogoText'], 15, true);
        }
        if (trim((string) $branding['companyName']) !== '') {
            $this->text(52, 746, $this->crop((string) $branding['companyName'], 25), 7);
        }
        $this->text(210, 772, (string) $data['title'], 22, true);
        $this->rectangle(489, 758, 40, 40, [1, 1, 1], $primary);
        $this->text(502, 775, 'QR', 8, true);
        $this->line(42, 730, 553, 730, 1.1, $primary);
    }

    private function drawInformationArea(array $data, array $branding): void
    {
        $this->text(42, 706, 'Streckenübersicht', 11, true);
        $leftRows = [
            'Linie' => (string) $data['line'],
            'Route' => (string) $data['route'],
            'Richtung' => (string) $data['direction'],
        ];
        $rightRows = [
            'Kategorie' => (string) $data['category'],
            'Gültigkeit' => (string) $data['validFrom'],
            'Version' => (string) $data['version'],
        ];

        $y = 681.0;
        foreach ($leftRows as $label => $value) {
            $this->text(42, $y, $label, 9, true);
            foreach ($this->wrap($value, 31, 2) as $lineIndex => $line) {
                $this->text(112, $y - ($lineIndex * 11), $line, 9);
            }
            $y -= $label === 'Richtung' ? 34 : 23;
        }

        $y = 681.0;
        foreach ($rightRows as $label => $value) {
            $this->text(320, $y, $label, 9, true);
            $this->text(400, $y, $this->crop($value, 25), 9);
            $y -= 23;
        }
    }

    private function drawStopTable(array $stops, array $branding, float $tableTop): float
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);
        $this->text(42, $tableTop + 24, 'Haltestellen und Fahranweisungen', 13, true);
        $rowTop = $this->drawStopTableHeader($tableTop, $border, $accent);

        foreach ($stops as $rowIndex => $stop) {
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
            $rowFill = $rowIndex % 2 === 1 ? [0.97, 0.975, 0.98] : [1, 1, 1];
            $this->rectangle(42, $rowBottom, 511, $rowHeight, $rowFill, $border);
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
        $this->text(397, $bottom + 8, 'Fahranweisung', 9, true);
        $this->line(42, $bottom, 553, $bottom, 1.0, $border);
        return $bottom;
    }

    private function drawSpecialNotes(string $description, array $branding): float
    {
        if (trim($description) === '') {
            return 585.0;
        }

        $accent = $this->color($branding['accentColor'], [0.93, 0.94, 0.95]);
        $lines = $this->wrap($description, 82, 4);
        $height = 32 + (count($lines) * 13);
        $top = 608.0;
        $this->fillRectangle(42, $top - $height, 511, $height, $accent);
        $this->text(54, $top - 17, 'Besonderheiten', 10, true);
        foreach ($lines as $index => $line) {
            $this->text(54, $top - 36 - ($index * 13), $line, 8.5);
        }
        return $top - $height - 38;
    }

    private function drawTrainingRecord(float $tableBottom, array $branding): void
    {
        $border = $this->color($branding['secondaryColor'], [0.72, 0.75, 0.78]);
        $top = $tableBottom - 34;
        if ($top - 128 < 70) {
            $this->newPage();
            $top = 790;
        }

        $this->text(42, $top, 'Nachweis der Streckeneinweisung', 11, true);
        $fields = ['Name Fahrer', 'Abgefahren am', 'Unterschrift Fahrer', 'Unterschrift Einweiser'];
        foreach ($fields as $index => $field) {
            $y = $top - 30 - ($index * 27);
            $this->text(42, $y, $field, 9, true);
            $this->line(175, $y - 3, 540, $y - 3, 0.6, $border);
        }
    }

    private function text(float $x, float $y, string $text, float $size, bool $bold = false): void
    {
        $font = $bold ? 'F2' : 'F1';
        $copyrightMark = '__LEHRFAHRER_COPYRIGHT__';
        $escaped = PdfHelpers::escapePdfText(str_replace('©', $copyrightMark, $text));
        $escaped = str_replace($copyrightMark, '\\251', $escaped);
        $this->stream .= "0 g\nBT\n/{$font} {$size} Tf\n{$x} {$y} Td\n("
            . $escaped . ") Tj\nET\n";
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

    private function fillRectangle(float $x, float $y, float $width, float $height, array $fill): void
    {
        $this->stream .= implode(' ', $fill) . " rg\n{$x} {$y} {$width} {$height} re\nf\n";
    }

    private function drawLogoImage(float $x, float $y, float $maxWidth, float $maxHeight): void
    {
        if ($this->logoImage === null) {
            return;
        }
        $scale = min(
            $maxWidth / $this->logoImage['width'],
            $maxHeight / $this->logoImage['height']
        );
        $width = round($this->logoImage['width'] * $scale, 2);
        $height = round($this->logoImage['height'] * $scale, 2);
        $this->stream .= "q\n{$width} 0 0 {$height} {$x} {$y} cm\n/Logo Do\nQ\n";
    }

    private function prepareLogoImage(string $path): ?array
    {
        if (
            $path === ''
            || !is_file($path)
            || !function_exists('imagecreatefrompng')
            || !function_exists('imagecreatetruecolor')
            || !function_exists('imagecolorallocate')
            || !function_exists('imagejpeg')
        ) {
            return null;
        }
        $source = @imagecreatefrompng($path);
        if ($source === false) {
            return null;
        }
        $width = imagesx($source);
        $height = imagesy($source);
        $canvas = imagecreatetruecolor($width, $height);
        $white = imagecolorallocate($canvas, 255, 255, 255);
        imagefill($canvas, 0, 0, $white);
        imagealphablending($canvas, true);
        imagecopy($canvas, $source, 0, 0, 0, 0, $width, $height);
        ob_start();
        $written = imagejpeg($canvas, null, 90);
        $jpeg = ob_get_clean();
        imagedestroy($canvas);
        imagedestroy($source);
        if (!$written || !is_string($jpeg) || $jpeg === '') {
            return null;
        }
        return ['data' => $jpeg, 'width' => $width, 'height' => $height];
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
        foreach (['isGhostPoint', 'isGhost', 'ghost', 'isRoutePoint', 'isGuidePoint'] as $flag) {
            if (!empty($stop[$flag])) {
                return true;
            }
        }
        $kind = strtolower(trim((string) ($stop['kind'] ?? '')));
        if ($kind === 'replacementstop') {
            return false;
        }
        foreach (['synthetic', 'manual'] as $flag) {
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
            $this->text(42, 34, 'Erstellt mit Lehrfahrer®', 7);
            $this->text(175, 34, (string) $branding['website'], 7);
            $this->text(278, 34, (string) $branding['copyright'], 7);
            $this->text(407, 34, $this->crop($this->documentVersion, 16), 7);
            $this->text(492, 34, 'Seite ' . ($index + 1) . ' von ' . $pageCount, 7);
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
        $logoObjectId = null;
        if ($this->logoImage !== null) {
            $logoObjectId = $nextId++;
            $logoData = $this->logoImage['data'];
            $objects[$logoObjectId] = '<< /Type /XObject /Subtype /Image'
                . ' /Width ' . $this->logoImage['width']
                . ' /Height ' . $this->logoImage['height']
                . ' /ColorSpace /DeviceRGB /BitsPerComponent 8'
                . ' /Filter /DCTDecode /Length ' . strlen($logoData)
                . " >>\nstream\n{$logoData}\nendstream";
        }
        $pageIds = [];
        foreach ($streams as $stream) {
            $contentId = $nextId++;
            $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n{$stream}\nendstream";
            $pageId = $nextId++;
            $xObject = $logoObjectId !== null ? " /XObject << /Logo {$logoObjectId} 0 R >>" : '';
            $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                . "/Resources << /Font << /F1 3 0 R /F2 4 0 R >>{$xObject} >> "
                . "/Contents {$contentId} 0 R >>";
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
