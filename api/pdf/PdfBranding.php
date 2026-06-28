<?php

declare(strict_types=1);

namespace Lehrfahrer\Pdf;

/**
 * Holds future company branding configuration for PDF documents.
 */
final class PdfBranding
{
    private string $companyName;
    private string $department;
    private string $street;
    private string $postalCode;
    private string $city;
    private string $phone;
    private string $email;
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
        $this->department = (string) ($branding['department'] ?? '');
        $this->street = (string) ($branding['street'] ?? '');
        $this->postalCode = (string) ($branding['postalCode'] ?? '');
        $this->city = (string) ($branding['city'] ?? '');
        $this->phone = (string) ($branding['phone'] ?? '');
        $this->email = (string) ($branding['email'] ?? '');
        $this->logoPath = (string) ($branding['logoPath'] ?? '');
        $this->fallbackLogoText = (string) ($branding['fallbackLogoText'] ?? 'Lehrfahrer®');
        $this->primaryColor = (string) ($branding['primaryColor'] ?? '');
        $this->secondaryColor = (string) ($branding['secondaryColor'] ?? '');
        $this->accentColor = (string) ($branding['accentColor'] ?? '');
        $this->footerText = (string) ($branding['footerText'] ?? '');
        $this->website = (string) ($branding['website'] ?? '');
        $this->copyright = (string) ($branding['copyright'] ?? '');
    }

    public static function loadFromDirectory(string $directory): self
    {
        $branding = [
            'fallbackLogoText' => 'Lehrfahrer®',
            'primaryColor' => '#B3262D',
            'secondaryColor' => '#B8C0C7',
            'accentColor' => '#EEF1F3',
            'website' => 'www.lehrfahrer.de',
            'copyright' => '© 2026 Frank Fudeus',
        ];
        $configPath = rtrim($directory, '/\\') . DIRECTORY_SEPARATOR . 'company.json';
        $config = [];
        if (is_file($configPath) && is_readable($configPath)) {
            $decoded = json_decode((string) file_get_contents($configPath), true);
            if (is_array($decoded)) {
                $config = $decoded;
            }
        }

        $aliases = [
            'companyName' => ['companyName', 'firmenname'],
            'department' => ['department', 'abteilung'],
            'street' => ['street', 'strasse', 'straße'],
            'postalCode' => ['postalCode', 'plz'],
            'city' => ['city', 'ort'],
            'phone' => ['phone', 'telefon'],
            'email' => ['email', 'eMail', 'e-mail'],
            'website' => ['website', 'homepage'],
            'primaryColor' => ['primaryColor', 'hauptfarbe'],
            'secondaryColor' => ['secondaryColor', 'sekundaerfarbe'],
            'accentColor' => ['accentColor', 'akzentfarbe'],
            'footerText' => ['footerText'],
            'copyright' => ['copyright'],
            'fallbackLogoText' => ['fallbackLogoText'],
        ];
        foreach ($aliases as $target => $keys) {
            foreach ($keys as $key) {
                if (isset($config[$key]) && is_scalar($config[$key])) {
                    $branding[$target] = trim((string) $config[$key]);
                    break;
                }
            }
        }

        $configuredLogo = '';
        foreach (['logo', 'logoPath'] as $logoKey) {
            if (isset($config[$logoKey]) && is_string($config[$logoKey])) {
                $configuredLogo = basename($config[$logoKey]);
                break;
            }
        }
        $logoCandidates = array_filter([
            $configuredLogo,
            'logo_print.png',
            'logo.png',
        ]);
        foreach ($logoCandidates as $logoFile) {
            $logoPath = rtrim($directory, '/\\') . DIRECTORY_SEPARATOR . $logoFile;
            if (is_file($logoPath) && is_readable($logoPath)) {
                $branding['logoPath'] = $logoPath;
                break;
            }
        }

        return new self($branding);
    }

    public function toArray(): array
    {
        return [
            'companyName' => $this->companyName,
            'department' => $this->department,
            'street' => $this->street,
            'postalCode' => $this->postalCode,
            'city' => $this->city,
            'phone' => $this->phone,
            'email' => $this->email,
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
