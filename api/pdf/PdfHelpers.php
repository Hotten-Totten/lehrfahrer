<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Provides future shared helper functions for PDF 3.0.
 */
final class PdfHelpers
{
    public static function prepareProjectData(array $project): array
    {
        $line = is_array($project['line'] ?? null) ? $project['line'] : [];
        $stats = is_array($project['stats'] ?? null) ? $project['stats'] : [];
        $value = static function (string $key, string $fallback = '') use ($project, $line): string {
            return trim((string) ($project[$key] ?? ($line[$key] ?? $fallback)));
        };

        $stops = [];
        foreach (is_array($project['stops'] ?? null) ? $project['stops'] : [] as $stop) {
            if (!is_array($stop) || self::isTechnicalStop($stop)) {
                continue;
            }
            $name = trim((string) ($stop['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $stops[] = [
                'number' => count($stops) + 1,
                'stop' => $name,
                'instruction' => self::stopInstruction($stop),
            ];
        }

        $distanceMeters = (float) ($stats['routeLengthMeters'] ?? ($project['routeLengthMeters'] ?? 0));
        $durationMinutes = (int) ($stats['estimatedDriveMinutes'] ?? ($project['estimatedDriveMinutes'] ?? 0));

        return [
            'title' => 'Streckeneinweisung',
            'line' => preg_replace('/^Linie\s+/i', '', $value('lineName')),
            'route' => preg_replace('/^Route\s+/i', '', $value('routeName')),
            'direction' => $value('directionName'),
            'distance' => $distanceMeters > 0
                ? number_format($distanceMeters / 1000, 1, ',', '.') . ' km'
                : '-',
            'stopCount' => (string) count($stops),
            'variant' => $value('variantName'),
            'category' => $value('variantCategory'),
            'duration' => $durationMinutes > 0 ? $durationMinutes . ' min' : '-',
            'validFrom' => self::formatProjectDate($value('validFrom')),
            'created' => self::formatProjectDate(substr($value('savedAt'), 0, 10)),
            'version' => $value('formatVersion', 'PDF 3.0 Preview'),
            'description' => $value('description'),
            'stops' => $stops,
        ];
    }

    private static function isTechnicalStop(array $stop): bool
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

    private static function stopInstruction(array $stop): string
    {
        foreach (['nextDrivingInstruction', 'nextInstruction', 'drivingInstruction', 'instruction', 'turnInstruction', 'routeInstruction', 'drivingHint'] as $key) {
            $instruction = trim((string) ($stop[$key] ?? ''));
            if ($instruction !== '') {
                return $instruction;
            }
        }
        return '-';
    }

    private static function formatProjectDate(string $date): string
    {
        $parsed = \DateTime::createFromFormat('!Y-m-d', $date);
        return $parsed && $parsed->format('Y-m-d') === $date ? $parsed->format('d.m.Y') : ($date !== '' ? $date : '-');
    }

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
