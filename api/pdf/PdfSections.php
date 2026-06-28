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
        // Future header: logo/fallback, title, route metadata, and optional QR placeholder.
    }

    public function renderInfoBoxes(
        array $data = [],
        ?PdfLayout $layout = null,
        ?PdfHelpers $helpers = null
    ): void
    {
        // Future left box: line, route, direction, distance, and stop count.
        // Future right box: variant, category, duration, valid-from date, and version.
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
