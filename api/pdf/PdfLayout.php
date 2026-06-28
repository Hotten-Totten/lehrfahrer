<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Provides future reusable layout primitives for PDF 3.0.
 */
final class PdfLayout
{
    public function drawHeaderArea(array $options = []): void
    {
    }

    public function drawLogoBlock(array $branding = []): void
    {
    }

    public function drawTitleBlock(string $title = '', array $options = []): void
    {
    }

    public function drawMetaLine(string $label = '', string $value = '', array $options = []): void
    {
    }
}
