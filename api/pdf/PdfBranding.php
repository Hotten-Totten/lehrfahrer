<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Holds future company branding configuration for PDF documents.
 */
final class PdfBranding
{
    private string $companyName;
    private string $logoPath;
    private string $fallbackLogoText;
    private string $primaryColor;
    private string $secondaryColor;
    private string $accentColor;
    private string $footerText;
    private string $website;
    private string $copyright;

    public function __construct(array $branding = [])
    {
        $this->companyName = (string) ($branding['companyName'] ?? '');
        $this->logoPath = (string) ($branding['logoPath'] ?? '');
        $this->fallbackLogoText = (string) ($branding['fallbackLogoText'] ?? 'Lehrfahrer®');
        $this->primaryColor = (string) ($branding['primaryColor'] ?? '');
        $this->secondaryColor = (string) ($branding['secondaryColor'] ?? '');
        $this->accentColor = (string) ($branding['accentColor'] ?? '');
        $this->footerText = (string) ($branding['footerText'] ?? '');
        $this->website = (string) ($branding['website'] ?? '');
        $this->copyright = (string) ($branding['copyright'] ?? '');
    }

    public function toArray(): array
    {
        return [
            'companyName' => $this->companyName,
            'logoPath' => $this->logoPath,
            'fallbackLogoText' => $this->fallbackLogoText,
            'primaryColor' => $this->primaryColor,
            'secondaryColor' => $this->secondaryColor,
            'accentColor' => $this->accentColor,
            'footerText' => $this->footerText,
            'website' => $this->website,
            'copyright' => $this->copyright,
        ];
    }
}
