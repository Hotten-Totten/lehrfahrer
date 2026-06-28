<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Defines the future render sections of a PDF 3.0 document.
 */
final class PdfSections
{
    public function renderHeader(
        array $data = [],
        ?PdfBranding $branding = null,
        ?PdfLayout $layout = null
    ): void
    {
        if ($layout === null) {
            return;
        }

        $brandingData = ($branding ?? new PdfBranding())->toArray();
        $layout->drawHeaderArea([
            'logoText' => $brandingData['fallbackLogoText'],
            'title' => (string) ($data['title'] ?? 'Streckeneinweisung'),
        ]);
    }

    public function renderInfoBoxes(
        array $data = [],
        ?PdfLayout $layout = null,
        ?PdfHelpers $helpers = null
    ): void
    {
        if ($layout === null) {
            return;
        }

        $layout->drawInfoGrid([
            [
                'title' => 'Strecke',
                'content' => [
                    'Linie' => (string) ($data['line'] ?? ''),
                    'Route' => (string) ($data['route'] ?? ''),
                    'Richtung' => (string) ($data['direction'] ?? ''),
                    'Streckenlänge' => (string) ($data['distance'] ?? ''),
                    'Haltestellen' => (string) ($data['stopCount'] ?? ''),
                ],
            ],
            [
                'title' => 'Ausführung',
                'content' => [
                    'Variante' => (string) ($data['variant'] ?? ''),
                    'Kategorie' => (string) ($data['category'] ?? ''),
                    'Fahrzeit' => (string) ($data['duration'] ?? ''),
                    'Gültig ab' => (string) ($data['validFrom'] ?? ''),
                    'Version' => (string) ($data['version'] ?? ''),
                ],
            ],
        ]);
    }

    public function renderRemark(): void
    {
    }

    public function renderStopTable(): void
    {
    }

    public function renderSpecialNotes(): void
    {
    }

    public function renderTrainingRecord(): void
    {
    }

    public function renderFooter(): void
    {
    }
}
