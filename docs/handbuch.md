# Benutzerhandbuch Lehrfahrer-Linieneditor

Dieses Handbuch beschreibt die Bedienung des Linieneditors. Screenshots werden später ergänzt.

## 1. Linien erstellen

1. Ort, Liniennummer, Route und Richtung eintragen.
2. Linienfarbe auswählen.
3. Haltestellen in der gewünschten Reihenfolge hinzufügen.
4. Routengeometrie automatisch berechnen oder manuell bearbeiten.
5. Linie prüfen und speichern.

Vor dem Speichern sollten Start, Ziel, Stopreihenfolge und Streckenverlauf kontrolliert werden.

## 2. Haltestellen

Haltestellen können aus dem Katalog übernommen oder frei auf der Karte gesetzt werden. Die Reihenfolge in der Haltestellenliste entspricht der Linienreihenfolge.

Haltestellen können ausgewählt, verschoben, bearbeitet und gelöscht werden. Änderungen an Namen, Minuten, Notizen oder Ghost-Kennzeichen werden im Haltestelleneditor gespeichert.

Durchfahrpunkte sind Ghost-Haltestellen. Sie erscheinen im Editor als betriebliche Referenzpunkte, sind aber keine regulären Fahrgasthalte.

## 3. RoutePoints

RoutePoints bilden die sichtbare Routengeometrie. Sie können automatisch durch Routing entstehen oder manuell gesetzt werden.

Je nach Modus können RoutePoints ausgewählt, verschoben, ergänzt oder gelöscht werden. Mehrfachauswahl und Segmentbearbeitung dienen zur Korrektur größerer Bereiche.

RoutePoints sind keine Haltestellen.

## 4. Straßenrouting

Straßenrouting berechnet automatisch eine Route zwischen den vorgesehenen Haltestellen und Durchfahrpunkten.

Geeignet für:

- normale Straßen
- eindeutig im Kartenmaterial erfasste Strecken
- schnelle Grundrouten

Bei Busspuren, Gleisen, Betriebshöfen oder Sonderzufahrten kann das Ergebnis abweichen. In diesen Fällen Punktführung oder GuidedStreet verwenden.

## 5. Punktführung

Bei Punktführung findet keine Routerberechnung statt. Die Linie folgt exakt der gesetzten Punktfolge.

Geeignet für:

- Flächen ohne routbare Straßen
- Betriebshöfe
- Gleisbereiche
- exakt vorgegebene Wendeschleifen
- Situationen, in denen der Straßenrouter den gewünschten Weg ablehnt

Fahrwegpunkte sind reine Geometriepunkte und erscheinen nicht als Haltestellen.

## 6. GuidedStreet

GuidedStreet berechnet Straßenrouting abschnittsweise über gesetzte Zwangspunkte. Dadurch lässt sich der Router gezielt durch einen gewünschten Korridor führen.

Typische Anwendungen:

- Busspuren
- Straßenbahngleise
- Betriebshöfe
- Wendeschleifen
- Baustellen
- Durchfahrverbote mit Freigabe für Linienverkehr

GuidedStreet kann nur Wege verwenden, die der Router akzeptiert. Falls ein Abschnitt trotz Zwangspunkten nicht berechnet werden kann, Punktführung verwenden.

## 7. Umleitungen

Der stop-basierte Umleitungs-Wizard ersetzt einen zusammenhängenden Haltestellen- und Routenbereich.

Vorgehen:

1. `Umleitung starten` auswählen.
2. Zusammenhängenden Stopbereich in der Haltestellenliste markieren.
3. `Bereich übernehmen` auswählen.
4. Ersatzhaltestellen, Durchfahrpunkte und Fahrwegpunkte in Fahrreihenfolge setzen.
5. Routingart auswählen.
6. Ergebnis übernehmen oder den Wizard abbrechen.

Punkttypen:

- Ersatzhaltestelle: echter Ersatzhalt
- Durchfahrpunkt: Ghost-Haltestelle und betrieblicher Referenzpunkt
- Fahrwegpunkt: reine Geometrie, kein Halt

Bei Punktführung und GuidedStreet wird die gemeinsame Setzreihenfolge aller drei Typen berücksichtigt. Im Straßenrouting werden Fahrwegpunkte ignoriert, bleiben beim Moduswechsel aber erhalten.

`Umleitung abbrechen` verwirft den Entwurf und lässt Originalroute und Originalhaltestellen unverändert.

## 8. GPX Export

Der GPX-Export enthält den finalen Routenverlauf als Track. Haltestellen können zusätzlich als Waypoints enthalten sein.

Vor dem Export prüfen:

- korrekter Routenverlauf
- richtige Richtung
- vollständige Haltestellenfolge
- gewünschte Original- oder vereinfachte Geometrie

Das Verhalten von Durchfahrpunkten als GPX-Waypoints wird noch fachlich überprüft.

## 9. Fahrer-App

Die Fahrer-App zeigt gespeicherte Linien, Routengeometrie und reguläre Haltestellen. Ghost-Haltestellen werden nicht als normale Fahrgasthalte behandelt.

Fahrwegpunkte erscheinen nicht in der Fahrer-App. Ihre Wirkung ist bereits in der gespeicherten Routengeometrie enthalten.

Nach Änderungen an einer Linie sollte in der Fahrer-App geprüft werden:

- Route wird vollständig dargestellt
- Haltestellenfolge ist korrekt
- Durchfahrpunkte erscheinen nicht als reguläre Fahrgasthalte
- Navigation folgt der erwarteten Geometrie

## 10. FAQ

### Was ist der Unterschied zwischen Durchfahrpunkt und Fahrwegpunkt?

Ein Durchfahrpunkt ist eine Ghost-Haltestelle und steht in der Haltestellenliste. Ein Fahrwegpunkt beeinflusst nur die Geometrie und ist kein Stop. Beide Konzepte dürfen nicht verwechselt werden.

### Wann verwende ich Straßenrouting?

Wenn die Strecke über normale, im Kartenmaterial korrekt erfasste Straßen führt.

### Wann verwende ich Punktführung?

Wenn die Route exakt vorgegeben werden muss oder der Router einen Abschnitt nicht berechnen kann.

### Wann verwende ich GuidedStreet?

Wenn der Router grundsätzlich verwendet werden soll, aber über bestimmte Zwischenpunkte geführt werden muss.

### Warum läuft GuidedStreet trotz Fahrwegpunkt nicht über eine Busspur?

Der Fahrwegpunkt erzwingt eine Koordinate, ändert aber nicht die Zugangsregeln des Routers. Bei nicht routbaren Abschnitten muss Punktführung verwendet werden.

### Was passiert beim Abbrechen einer Umleitung?

Der temporäre Entwurf wird entfernt. Die ursprüngliche Route und Haltestellenfolge bleiben unverändert.

### Werden Fahrwegpunkte gespeichert?

Sie werden nicht als Haltestellen gespeichert. Ihre Wirkung wird in die finale Folge der RoutePoints übernommen.

