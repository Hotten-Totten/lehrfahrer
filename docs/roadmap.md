# Roadmap des Lehrfahrer-Linieneditors

Die Roadmap priorisiert fachliche Stabilität vor Komfort und visueller Erweiterung. Architekturentscheidungen sind in [architecture.md](architecture.md) dokumentiert.

## HIGH PRIORITY

### Routing und GuidedStreet

- GuidedStreet-Routinghelper aus der Wizard-Implementierung extrahieren.
- Gemeinsamen Helper `buildStreetRouteCoordsViaAnchors()` einführen.
- GuidedStreet im normalen Linieneditor verfügbar machen.
- Sicherstellen, dass alle Verbraucher dieselbe geordnete Anchor-Logik verwenden.
- GuidedStreet-Vorschau vor finaler Übernahme bereitstellen.

### Validierung und Datensicherheit

- Distanzprüfung zwischen Ersatzhaltestelle und finaler Route einführen.
- Save/Load während eines aktiven Wizards absichern.
- Undo-Verhalten während eines aktiven Wizards definieren.
- GPX-Verhalten für Durchfahrpunkte prüfen und festlegen.
- Mischfolgen aus Ersatzhaltestellen, Durchfahrpunkten und Fahrwegpunkten automatisiert testen.

### Routingpresets

- Busspur-Presets entwickeln.
- Betriebshof-Presets entwickeln.
- Gleis-Presets entwickeln.
- Presets für Durchfahrverbote oder Freigabe für Linienverkehr untersuchen.
- Festlegen, welche Preset-Metadaten später segmentbezogen gespeichert werden.

### NORMALER LINIENEDITOR

GuidedStreet soll später auch außerhalb des Umleitungs-Wizards verfügbar sein. Dies ist ein Kernfeature für professionelle Routenerstellung.

Nutzen:

- Busspuren
- Straßenbahngleise
- Betriebshof
- Wendeschleifen
- Fußgängerzonen
- Durchfahrverbote
- Baustellen

Die Übernahme soll nicht durch Kopieren der Wizard-Logik erfolgen. Wizard und normaler Linieneditor müssen denselben Routinghelper und dasselbe Anchor-Datenmodell verwenden.

## MEDIUM PRIORITY

### Umleitungs-Wizard

- Sichtbaren Schrittindikator ergänzen.
- Temporäre Punkte umbenennen und gezielt neu ordnen können.
- GuidedStreet-Routingfehler pro Segment verständlich anzeigen.
- Warnung anzeigen, wenn Fahrwegpunkte im Street-Modus vorhanden, aber inaktiv sind.
- Umleitungen am Linienanfang und Linienende unterstützen.
- Bestätigungsübersicht vor dem finalen Stop- und Route-Splice ergänzen.

### Codequalität

- Wizard-Logik aus `editor.stops.js` in ein eigenes Modul auslagern.
- Doppelte globale Hilfsfunktionen konsolidieren.
- RouteMode-Bezeichnungen vereinheitlichen.
- Routing-, State- und Renderinglogik deutlicher voneinander trennen.
- Tests für History, Autosave und Laden fertiger Umleitungen ergänzen.

### Export und App

- Ghost- und Durchfahrpunktdarstellung zwischen Editor, GPX und Fahrer-App vereinheitlichen.
- Segmentbezogene Routinginformationen im Exportformat vorbereiten.
- Kompatibilität alter Linienformate durch Migrationstests absichern.

## LONG TERM

- Mehrere Umleitungsabschnitte in einem Arbeitsgang bearbeiten.
- Aktive Wizard-Drafts vollständig persistieren und wiederherstellen.
- Unterschiedliche Presets innerhalb einer Umleitung pro Teilsegment erlauben.
- Eigene Routingprofile für Bus, Straßenbahn und betriebliche Sonderflächen untersuchen.
- Betrieblich freigegebene Zufahrten und lokale Routingregeln verwalten.
- Qualitätsprüfung für Schleifen, Gegenrichtungen und mehrdeutige Anschluss-RoutePoints ausbauen.
- Visuelle Routendifferenz zwischen Original, Entwurf und finaler Umleitung verbessern.
- Versionsfähiges Datenmodell für Umleitungen und Routingsegmente entwickeln.

