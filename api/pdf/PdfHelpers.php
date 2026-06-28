<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Provides future shared helper functions for PDF 3.0.
 */
final class PdfHelpers
{
    public static function escapePdfText(string $text): string
    {
        $registeredMark = '__LEHRFAHRER_REGISTERED__';
        $text = str_replace('®', $registeredMark, $text);
        $text = strtr($text, [
            'ä' => 'ae',
            'ö' => 'oe',
            'ü' => 'ue',
            'Ä' => 'Ae',
            'Ö' => 'Oe',
            'Ü' => 'Ue',
            'ß' => 'ss',
            '–' => '-',
            '—' => '-',
        ]);
        $text = preg_replace('/[^\x20-\x7E]/', '?', $text);
        $text = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);

        return str_replace($registeredMark, '\\256', $text);
    }

    public function formatDistance($distance = null): string
    {
        // Distance formatting will be implemented in a later phase.
        return '';
    }

    public function formatDuration($duration = null): string
    {
        // Duration formatting will be implemented in a later phase.
        return '';
    }

    public function formatDate($date = null): string
    {
        // Date formatting will be implemented in a later phase.
        return '';
    }
}
