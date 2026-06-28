# PDF 3.0 Spezifikation

## 1. Ziel von PDF 3.0

PDF 3.0 ist kein technischer Export, sondern ein offizielles, druckbares Ausbildungsdokument für Streckeneinweisungen.

Das Dokument enthält keine technischen Daten wie:

- Koordinaten
- Routenpunkte
- Ghosthaltestellen
- interne IDs

Im Mittelpunkt stehen:

- gute Lesbarkeit
- verlässliche Nachweisführung
- ein professionelles Erscheinungsbild
- eine klare, auf die Streckeneinweisung ausgerichtete Informationsstruktur

## 2. Grundprinzipien

- Die alte PDF-Ausgabe bleibt unangetastet.
- PDF 3.0 wird als neue, eigenständige Ausgabe aufgebaut.
- Layout, Datenaufbereitung und Branding werden voneinander getrennt.
- Die Architektur berücksichtigt Mandantenfähigkeit von Anfang an.
- Firmennamen, Logos, Farben und Webseiten werden nicht fest im PDF-Code hinterlegt.
- Der PDF-Code enthält keine Fachlogik.
- Die Fachlogik bereitet vollständige und geprüfte Daten vor.
- Der PDF-Generator stellt die vorbereiteten Daten ausschließlich dar.

## 3. Geplanter Dokumentaufbau

1. Header mit Firmenlogo oder Fallback `Lehrfahrer®`
2. Titel `Streckeneinweisung`
3. Linie, Route, Richtung und Variante
4. Zwei kompakte Informationskästen
5. Bemerkungsbereich
6. Haltestellentabelle
7. Besonderheiten
8. Nachweis der Lehrfahrt
9. vorbereiteter Bereich für einen QR-Code
10. Fußzeile mit Version und Seitenzahl

## 4. Pflichtfelder

- Linie
- Route
- Richtung
- Variantenname
- Kategorie
- Bemerkung
- Streckenlänge
- Fahrzeit
- Haltestellenanzahl
- Erstellungsdatum
- Gültig ab

Die Datenaufbereitung liefert für jedes Pflichtfeld einen definierten Wert oder einen fachlich festgelegten Fallback.

## 5. Optionale Felder

- Firmenlogo
- QR-Code
- Besonderheiten
- Bearbeiter
- Freigabestatus
- Firmenwebsite
- Corporate-Footer

Optionale Bereiche werden nur dargestellt, wenn verwertbare Inhalte vorhanden sind. Leere Überschriften, Kästen und Abstände werden vermieden.

## 6. Layoutregeln

- Papierformat: DIN A4
- Ausrichtung: Hochformat
- Das Layout bleibt kompakt, professionell und druckfreundlich.
- Der Tabellenkopf wird bei jedem Seitenumbruch wiederholt.
- Kästen dürfen nicht am Seitenende abgeschnitten werden.
- Der Nachweisblock bleibt vollständig auf einer Seite.
- Der QR-Code wird möglichst auf der ersten oder letzten Seite platziert.
- Die Fußzeile erscheint auf jeder Seite.
- Inhalte dürfen weder überlappen noch außerhalb des druckbaren Bereichs liegen.
- Seitenumbrüche werden anhand des tatsächlich benötigten Platzes gesteuert.

## 7. Branding und Mandantenfähigkeit

Das Branding wird über ein eigenständiges Konfigurationsobjekt bereitgestellt. Der PDF-Generator kennt keine fest eingetragenen Unternehmensdaten.

Vorgesehene Branding-Felder:

| Feld | Bedeutung |
| --- | --- |
| `companyName` | Anzeigename des Verkehrsunternehmens |
| `logoPath` | serverseitig validierter Pfad zum Firmenlogo |
| `primaryColor` | primäre Unternehmensfarbe |
| `secondaryColor` | sekundäre Unternehmensfarbe |
| `accentColor` | Akzentfarbe für Hinweise und Hervorhebungen |
| `footerText` | zusätzlicher Text für die Fußzeile |
| `website` | Unternehmens- oder Projektwebsite |
| `copyright` | Copyright-Hinweis |
| `fallbackLogoText` | Textdarstellung, wenn kein Logo verfügbar ist |

Alle Werte werden vor der Übergabe an das Layout validiert und normalisiert. Fehlt eine Branding-Konfiguration, werden neutrale Lehrfahrer-Standardwerte verwendet.

## 8. Geplante Architektur

```text
api/pdf/
├── PdfGenerator.php
├── PdfBranding.php
├── PdfLayout.php
├── PdfSections.php
├── PdfHelpers.php
└── assets/
```

### Verantwortlichkeiten

- `PdfGenerator.php`: koordiniert die Dokumenterzeugung und Seitenfolge.
- `PdfBranding.php`: lädt, validiert und normalisiert Branding-Daten.
- `PdfLayout.php`: verwaltet Seitenmaße, Positionen, Abstände und Seitenumbrüche.
- `PdfSections.php`: rendert die fachlich benannten Dokumentbereiche.
- `PdfHelpers.php`: enthält zustandsarme Hilfsfunktionen für Text, Maße und Formatierung.
- `assets/`: enthält ausschließlich PDF-spezifische, freigegebene Ressourcen.

Die Datenaufbereitung erfolgt außerhalb dieser Render-Schicht. Der Generator erhält ein definiertes Dokumentmodell und ein separates Branding-Modell.

## 9. Geplante Render-Module

- `renderHeader()`
- `renderInfoBoxes()`
- `renderRemark()`
- `renderStopTable()`
- `renderSpecialNotes()`
- `renderTrainingRecord()`
- `renderFooter()`

Jedes Render-Modul verarbeitet nur seinen vorbereiteten Datenbereich. Module verändern keine Projekt-, Editor- oder App-Daten.

## 10. Abgrenzung

Nicht Teil von Phase 1 sind:

- Karten
- Fotos
- Deckblatt
- Inhaltsverzeichnis
- Liniennetzpläne
- komplexe Freigabeprozesse
- Benutzerverwaltung

## 11. Qualitätskriterien

- PHP-Lint muss erfolgreich sein, falls PHP-Dateien angefasst werden.
- Die Markdown-Datei ist sauber und nachvollziehbar strukturiert.
- Bestehende Funktionen werden nicht verändert.
- Bestehende PDF-Dateien und PDF-Ausgaben werden nicht ersetzt.
- Im Editor und in der App entstehen keine Seiteneffekte.
- Layout, Datenaufbereitung und Branding bleiben klar getrennt.
- Fehlende optionale Daten führen nicht zu leeren oder beschädigten Layoutbereichen.
- Das Ergebnis bleibt auf allen Seiten eindeutig einer Linie und Variante zuordenbar.
