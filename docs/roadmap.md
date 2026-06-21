# Roadmap des Lehrfahrer-Linieneditors

Die Roadmap priorisiert fachliche Stabilität vor Komfort und visueller Erweiterung. Architekturentscheidungen sind in [architecture.md](architecture.md) dokumentiert.

## Stand V2.1.000

In V2.1.000 umgesetzt:

- gemeinsamer zustandsloser Helper `buildStreetRouteCoordsViaAnchors()`
- GuidedStreet im normalen Linieneditor und im Umleitungs-Wizard
- dauerhafte Setzmodi für Haltestellen und Fahrwegpunkte
- Strict-Fahrwegführung über `preserveManualChains`
- Erhalt manueller Anchors bei Voll-, Zwischenstopp- und Segmentrouting
- gemeinsame Bedienreihenfolge temporärer Wizard-Elemente
- geplante und entfallende Umleitungs-Preview
- Distanzprüfung fachlich erforderlicher Umleitungspunkte
- Speicherung von `routingMode`, `preserveManualChains` und `placementMode`

## HIGH PRIORITY

### Routing und GuidedStreet

- Automatisierte Tests für Street, GuidedStreet und Strict-Manual-Ketten einführen.
- Fehler-Rollback für Voll-, Zwischenstopp- und Segmentrouting automatisiert prüfen.
- Mehrdeutige Stop- und Anchor-Zuordnungen bei Schleifen robust behandeln.
- Segment-Neuberechnung fachlich um optionale Stop-Pflichtanker erweitern.

### Validierung und Datensicherheit

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

GuidedStreet ist seit V2.1.000 außerhalb des Umleitungs-Wizards verfügbar und der Standardmodus. Strict-Manual-Ketten decken komplexe Sonderbereiche ab. Dies bleibt ein Kernfeature für professionelle Routenerstellung.

Nutzen:

- Busspuren
- Straßenbahngleise
- Betriebshof
- Wendeschleifen
- Fußgängerzonen
- Durchfahrverbote
- Baustellen

Wizard und normaler Linieneditor verwenden denselben Routinghelper. Künftige Erweiterungen müssen diese gemeinsame Implementierung erhalten.

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
- Verbleibende Legacy-Nutzung von `routeMode` gegen `placementMode` prüfen und vereinheitlichen.
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
- Strict- oder Routingentscheidung pro Teilsegment statt nur pro Projekt ermöglichen.
- Eigene Routingprofile für Bus, Straßenbahn und betriebliche Sonderflächen untersuchen.
- Betrieblich freigegebene Zufahrten und lokale Routingregeln verwalten.
- Qualitätsprüfung für Schleifen, Gegenrichtungen und mehrdeutige Anschluss-RoutePoints ausbauen.
- Visuelle Routendifferenz zwischen Original, Entwurf und finaler Umleitung verbessern.
- Versionsfähiges Datenmodell für Umleitungen und Routingsegmente entwickeln.
