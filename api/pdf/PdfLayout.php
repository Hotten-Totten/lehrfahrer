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

    public function drawInfoBox(array $content = [], array $options = []): void
    {
        // Draws one information box in a later implementation.
    }

    public function drawInfoLabel(string $label = '', array $options = []): void
    {
        // Draws a label inside an information box in a later implementation.
    }

    public function drawInfoValue(string $value = '', array $options = []): void
    {
        // Draws a value inside an information box in a later implementation.
    }

    public function drawInfoGrid(array $boxes = [], array $options = []): void
    {
        // Arranges information boxes in a grid in a later implementation.
    }
}
