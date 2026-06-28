# Unternehmensbranding für PDF 3.0

PDF 3.0 kann ein unternehmenseigenes Branding aus dem Verzeichnis
`assets/company/` laden. Fehlen einzelne oder alle Dateien, verwendet die PDF
automatisch das neutrale Lehrfahrer-Standardbranding.

## Logos

Unterstützte Dateien in bevorzugter Reihenfolge:

1. `logo_print.png`
2. `logo.png`

Alternativ kann `company.json` über das Feld `logo` eine PNG-Datei aus
demselben Verzeichnis auswählen. Pfadangaben außerhalb von `assets/company/`
werden nicht verwendet.

Empfehlungen:

- PNG-Format
- transparenter Hintergrund
- mindestens 600 Pixel Breite
- Seitenverhältnis zwischen 2:1 und 4:1
- `logo_print.png` für eine speziell auf den Druck optimierte Variante
- ausreichender Kontrast auf weißem Hintergrund

Kann ein Logo technisch nicht geladen werden, erscheint ohne Fehlermeldung der
Fallback-Text `Lehrfahrer®`.

## company.json

Beispiel:

```json
{
  "companyName": "Beispiel Verkehrsgesellschaft",
  "department": "Aus- und Weiterbildung",
  "street": "Musterstraße 1",
  "postalCode": "12345",
  "city": "Musterstadt",
  "phone": "+49 000 123456",
  "email": "ausbildung@example.org",
  "website": "www.example.org",
  "primaryColor": "#B3262D",
  "accentColor": "#EEF1F3",
  "logo": "logo_print.png"
}
```

Die deutschen Feldnamen `firmenname`, `abteilung`, `strasse`, `plz`, `ort`,
`telefon`, `e-mail`, `homepage`, `hauptfarbe` und `akzentfarbe` werden
ebenfalls akzeptiert.

## Farben

Farben werden als sechsstellige Hex-Werte angegeben:

- `primaryColor`: Hauptfarbe für Trennlinien und Akzente
- `accentColor`: dezente Hintergrundfarbe
- `secondaryColor`: optionale Farbe für feine Linien und Tabellenrahmen

Ohne gültige Konfiguration verwendet PDF 3.0 Lehrfahrer-Rot als Hauptfarbe
sowie neutrale Grauwerte für Tabellen und Hintergründe.
