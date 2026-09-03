<?php

function lehrfahrer_pdf_escape(string $text): string {
    $text = strtr($text, [
        'ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'Ä' => 'Ae', 'Ö' => 'Oe',
        'Ü' => 'Ue', 'ß' => 'ss', '®' => '(R)', '–' => '-', '—' => '-'
    ]);
    $text = preg_replace('/[^\x20-\x7E]/', '?', $text);
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
}

function lehrfahrer_pdf_wrap(string $text, int $maxChars): array {
    $text = trim(preg_replace('/\s+/', ' ', $text));
    return $text === '' ? [''] : explode("\n", wordwrap($text, $maxChars, "\n", true));
}

final class LehrfahrerProfessionalPdf {
    private array $pages = [];
    private int $page = -1;
    private float $y = 0;
    private string $version;
    private array $metadata = [];

    public function __construct(string $version) {
        $this->version = $version !== '' ? $version : 'V2.1.020';
        $this->newPage(false);
    }

    private function command(string $command): void {
        $this->pages[$this->page] .= $command;
    }

    private function text(float $x, float $y, string $text, float $size = 10, bool $bold = false): void {
        $font = $bold ? 'F2' : 'F1';
        $this->command("BT\n/{$font} {$size} Tf\n{$x} {$y} Td\n(" . lehrfahrer_pdf_escape($text) . ") Tj\nET\n");
    }

    private function line(float $x1, float $y1, float $x2, float $y2, float $width = 0.7): void {
        $this->command("0 G\n{$width} w\n{$x1} {$y1} m\n{$x2} {$y2} l\nS\n");
    }

    private function box(float $x, float $y, float $width, float $height, bool $gray = false): void {
        if ($gray) {
            $this->command("0.93 g\n{$x} {$y} {$width} {$height} re\nf\n0 g\n");
        }
        $this->command("0 G\n0.7 w\n{$x} {$y} {$width} {$height} re\nS\n");
    }

    private function newPage(bool $continuedTable): void {
        $this->pages[] = '';
        $this->page = count($this->pages) - 1;
        $this->y = 792;
        if ($this->page > 0) {
            $this->compactHeader();
            if ($continuedTable) $this->tableHeader();
        }
    }

    private function compactHeader(): void {
        $this->text(45, 807, 'Streckeneinweisung', 12, true);
        $this->text(45, 786, 'Linie', 8, true);
        $this->text(78, 786, (string)($this->metadata['Linie'] ?? ''), 9);
        $this->text(145, 786, 'Route', 8, true);
        $this->text(180, 786, (string)($this->metadata['Route'] ?? ''), 9);
        $this->text(245, 786, 'Richtung', 8, true);
        $this->text(295, 786, (string)($this->metadata['Richtung'] ?? ''), 9);
        $this->text(405, 786, 'Variante', 8, true);
        $this->text(455, 786, (string)($this->metadata['Variante'] ?? ''), 9);
        $this->line(45, 776, 550, 776);
        $this->y = 760;
    }

    public function header(array $metadata): void {
        $this->metadata = $metadata;
        $this->text(45, 800, 'Lehrfahrer', 17, true);
        $this->text(405, 800, 'Streckeneinweisung', 15, true);
        $this->line(45, 785, 550, 785, 1.2);
        $this->text(45, 765, 'Firmenlogo', 8);

        $headline = [
            'Linie' => (string)($metadata['Linie'] ?? ''),
            'Route' => (string)($metadata['Route'] ?? ''),
            'Richtung' => (string)($metadata['Richtung'] ?? '')
        ];
        $x = 235;
        $y = 765;
        foreach ($headline as $label => $value) {
            $this->text($x, $y, $label, 9, true);
            $this->text($x + 65, $y, $value, 10);
            $y -= 17;
        }

        $this->y = 695;
        $entries = array_chunk($metadata, 2, true);
        foreach ($entries as $row) {
            $x = 45;
            foreach ($row as $label => $value) {
                $this->text($x, $this->y, $label, 9, true);
                $this->text($x + 65, $this->y, (string)$value, 9);
                $x += 255;
            }
            $this->y -= 18;
        }
        $this->y -= 6;
    }

    public function infoBox(string $description): void {
        if (trim($description) === '') return;
        $lines = [];
        foreach (preg_split('/\R/u', trim($description)) as $paragraph) {
            $lines = array_merge($lines, lehrfahrer_pdf_wrap($paragraph, 82));
        }
        $height = 34 + max(1, count($lines)) * 13;
        if ($this->y - $height < 90) $this->newPage(false);
        $bottom = $this->y - $height;
        $this->box(45, $bottom, 505, $height, true);
        $this->text(57, $this->y - 18, 'Besonderheiten', 11, true);
        $textY = $this->y - 36;
        foreach ($lines as $line) {
            $this->text(57, $textY, $line, 9);
            $textY -= 13;
        }
        $this->y = $bottom - 18;
    }

    private function tableHeader(): void {
        $height = 24;
        $bottom = $this->y - $height;
        $this->box(45, $bottom, 505, $height, true);
        $this->line(82, $bottom, 82, $this->y);
        $this->line(340, $bottom, 340, $this->y);
        $this->text(56, $bottom + 8, 'Nr.', 9, true);
        $this->text(92, $bottom + 8, 'Haltestelle', 9, true);
        $this->text(350, $bottom + 8, 'Naechste Fahranweisung', 9, true);
        $this->y = $bottom;
    }

    public function table(array $stops): void {
        $this->text(45, $this->y, 'Haltestellen', 13, true);
        $this->y -= 18;
        $this->tableHeader();
        if (!$stops) {
            $stops = [['number' => '', 'name' => 'Keine Haltestellen vorhanden.', 'instruction' => '']];
        }
        foreach ($stops as $stop) {
            $nameLines = lehrfahrer_pdf_wrap((string)($stop['name'] ?? ''), 43);
            $instructionLines = lehrfahrer_pdf_wrap((string)($stop['instruction'] ?? ''), 32);
            $lineCount = max(count($nameLines), count($instructionLines), 1);
            $height = max(22, 9 + $lineCount * 12);
            if ($this->y - $height < 100) $this->newPage(true);
            $top = $this->y;
            $bottom = $top - $height;
            $this->box(45, $bottom, 505, $height);
            $this->line(82, $bottom, 82, $top);
            $this->line(340, $bottom, 340, $top);
            $this->text(57, $top - 15, (string)($stop['number'] ?? ''), 9);
            foreach ($nameLines as $index => $line) {
                $this->text(92, $top - 15 - ($index * 12), $line, 9);
            }
            foreach ($instructionLines as $index => $line) {
                $this->text(350, $top - 15 - ($index * 12), $line, 9);
            }
            $this->y = $bottom;
        }
        $this->y -= 18;
    }

    public function proof(string $driverName): void {
        $height = 145;
        if ($this->y - $height < 75) $this->newPage(false);
        $bottom = $this->y - $height;
        $this->box(45, $bottom, 505, $height);
        $this->text(57, $this->y - 20, 'Nachweis der Streckeneinweisung', 12, true);
        $name = trim($driverName) !== '' ? $driverName : '';
        $this->text(57, $this->y - 48, 'Name Fahrer/in:', 9, true);
        $this->text(155, $this->y - 48, $name, 9);
        $this->line(155, $this->y - 52, 535, $this->y - 52);
        $this->text(57, $this->y - 76, 'Abgefahren am:', 9, true);
        $this->line(155, $this->y - 80, 330, $this->y - 80);
        $this->text(57, $this->y - 105, 'Unterschrift Fahrer/in:', 9, true);
        $this->line(185, $this->y - 109, 535, $this->y - 109);
        $this->text(57, $this->y - 132, 'Unterschrift Einweiser/in:', 9, true);
        $this->line(185, $this->y - 136, 535, $this->y - 136);
        $this->y = $bottom - 10;
    }

    public function output(): string {
        $pageCount = count($this->pages);
        foreach ($this->pages as $index => &$stream) {
            $footer = 'Erstellt mit Lehrfahrer(R)   www.lehrfahrer.de   ' . $this->version
                . '   Seite ' . ($index + 1) . ' von ' . $pageCount;
            $stream .= "0 G\n0.5 w\n45 48 m\n550 48 l\nS\n";
            $stream .= "BT\n/F1 8 Tf\n45 32 Td\n(" . lehrfahrer_pdf_escape($footer) . ") Tj\nET\n";
            $stream .= "0.65 G\n0.5 w\n515 58 35 35 re\nS\n0 G\n";
        }
        unset($stream);

        $objects = [
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '',
            3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
        ];
        $nextId = 5;
        $pageRefs = [];
        foreach ($this->pages as $stream) {
            $contentId = $nextId++;
            $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n{$stream}\nendstream";
            $pageId = $nextId++;
            $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                . "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {$contentId} 0 R >>";
            $pageRefs[] = $pageId;
        }
        $objects[2] = '<< /Type /Pages /Kids [ ' . implode(' ', array_map(
            static fn($id) => $id . ' 0 R',
            $pageRefs
        )) . ' ] /Count ' . count($pageRefs) . ' >>';

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

function lehrfahrer_build_professional_pdf(array $document): string {
    $pdf = new LehrfahrerProfessionalPdf((string)($document['version'] ?? 'V2.1.020'));
    $pdf->header(is_array($document['metadata'] ?? null) ? $document['metadata'] : []);
    $pdf->infoBox((string)($document['description'] ?? ''));
    $pdf->table(is_array($document['stops'] ?? null) ? $document['stops'] : []);
    $pdf->proof((string)($document['driverName'] ?? ''));
    return $pdf->output();
}
