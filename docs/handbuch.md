# Benutzerhandbuch Lehrfahrer-Linieneditor

Dieses Handbuch beschreibt die Bedienung des Linieneditors in **V2.1.000**. Screenshots werden später ergänzt.

## Änderungsübersicht V2.1.000

- `Straßenrouting über Fahrwegpunkte` ist der Standardmodus.
- `Fahrwegpunkte exakt halten` ist für neue und alte feldlose Projekte standardmäßig aktiv.
- Aufeinanderfolgende Fahrwegpunkte werden bei aktivierter Option exakt verbunden; Stopanschlüsse bleiben Straßenrouting.
- `Punktführung` ist als Expertenmodus gekennzeichnet.
- Die dauerhaften Setzmodi heißen `Haltestellen setzen` und `Fahrwegpunkte setzen`.
- Vollberechnung, Zwischenstopp-Routing und Segment-Neuberechnung erhalten manuelle Pflichtpunkte.
- GuidedStreet-Umleitungen können exakte Fahrwegpunkt-Ketten verwenden.
- Routing-, Strict- und Setzmodus werden in Projektdateien, Autosave und History berücksichtigt.

## 1. Linien erstellen

1. Ort, Liniennummer, Route und Richtung eintragen.
2. Linienfarbe auswählen.
3. `Haltestellen setzen` wählen und Haltestellen in der gewünschten Reihenfolge hinzufügen.
4. Bei Bedarf `Fahrwegpunkte setzen` wählen und den gewünschten Korridor markieren.
5. Routingart auswählen und die Route erzeugen.
6. Linie prüfen und speichern.

Vor dem Speichern sollten Start, Ziel, Stopreihenfolge und Streckenverlauf kontrolliert werden.

## 2. Haltestellen

Haltestellen können aus dem Katalog übernommen oder frei auf der Karte gesetzt werden. Die Reihenfolge in der Haltestellenliste entspricht der Linienreihenfolge.

Haltestellen können ausgewählt, verschoben, bearbeitet und gelöscht werden. Änderungen an Namen, Minuten, Notizen oder Ghost-Kennzeichen werden im Haltestelleneditor gespeichert.

Durchfahrpunkte sind Ghost-Haltestellen. Sie erscheinen im Editor als betriebliche Referenzpunkte, sind aber keine regulären Fahrgasthalte.

### Setzmodus: Haltestellen setzen

Der Button `Haltestellen setzen` aktiviert einen dauerhaften Modus. Jeder Kartenklick setzt eine reale freie Haltestelle, bis bewusst auf `Fahrwegpunkte setzen` oder einen anderen Arbeitsmodus umgeschaltet wird. Das Auswählen oder Setzen eines einzelnen Punktes schaltet nicht automatisch zurück.

## 3. RoutePoints

RoutePoints bilden die sichtbare Routengeometrie. Sie können automatisch durch Routing entstehen oder manuell gesetzt werden.

Je nach Modus können RoutePoints ausgewählt, verschoben, ergänzt oder gelöscht werden. Mehrfachauswahl und Segmentbearbeitung dienen zur Korrektur größerer Bereiche.

RoutePoints sind keine Haltestellen.

### Fahrwegpunkte setzen

`Fahrwegpunkte setzen` ersetzt die frühere Bezeichnung `Route manuell`. Der Modus bleibt aktiv, bis der Nutzer bewusst umschaltet. Kartenklicks erzeugen manuelle RoutePoints mit `sourceType: "manual"`.

Fahrwegpunkte können ausgewählt, verschoben und gelöscht werden. Ihre Reihenfolge in `state.routePoints` bestimmt die Reihenfolge der GuidedStreet-Anker.

### Segment-Neuberechnung

Für eine Teilstrecke werden zwei RoutePoints als Grenzen ausgewählt und `Teilstrecke neu berechnen` gestartet. Manuelle Fahrwegpunkte innerhalb des Abschnitts bleiben Pflichtanker. Bei aktivem `Fahrwegpunkte exakt halten` werden direkt aufeinanderfolgende manuelle Punkte exakt verbunden.

### Zwischenstopp-Routing

Wird ein Stop in eine bereits berechnete Route eingefügt, berechnet der Editor den betroffenen Abschnitt neu. Im GuidedStreet-Modus bleiben manuelle Fahrwegpunkte dieses Abschnitts erhalten. Der neue Stop wird anhand seiner Nähe zur vorhandenen Route in die Anchor-Reihenfolge eingeordnet.

## 4. Straßenrouting

Straßenrouting berechnet automatisch eine Route zwischen den vorgesehenen Haltestellen und Durchfahrpunkten.

Geeignet für:

- normale Straßen
- eindeutig im Kartenmaterial erfasste Strecken
- schnelle Grundrouten

Bei Busspuren, Gleisen, Betriebshöfen oder Sonderzufahrten kann das Ergebnis abweichen. In diesen Fällen `Straßenrouting über Fahrwegpunkte` verwenden.

## 5. Punktführung

Punktführung ist ein Expertenmodus. Es findet keine Routerberechnung statt; die Linie folgt exakt der gesetzten Punktfolge.

Geeignet für:

- Flächen ohne routbare Straßen
- Betriebshöfe
- Gleisbereiche
- exakt vorgegebene Wendeschleifen
- Situationen, in denen der Straßenrouter den gewünschten Weg ablehnt

Fahrwegpunkte sind reine Geometriepunkte und erscheinen nicht als Haltestellen.

## 6. GuidedStreet

`Straßenrouting über Fahrwegpunkte` ist der Standardmodus. GuidedStreet berechnet Straßenrouting abschnittsweise über gesetzte Zwangspunkte. Dadurch lässt sich der Router gezielt durch einen gewünschten Korridor führen.

Typische Anwendungen:

- Busspuren
- Straßenbahngleise
- Betriebshöfe
- Wendeschleifen
- Baustellen
- Durchfahrverbote mit Freigabe für Linienverkehr

### Fahrwegpunkte exakt halten

Die Option ist standardmäßig aktiv und nur bei GuidedStreet sichtbar.

- Stop zu Fahrwegpunkt: normale Routerberechnung
- Fahrwegpunkt zu Fahrwegpunkt: direkte exakte Verbindung
- Fahrwegpunkt zu Stop: normale Routerberechnung

Bei deaktivierter Option routet der Router auch zwischen zwei Fahrwegpunkten. Das entspricht dem bisherigen GuidedStreet-Verhalten.

Die exakte Verbindung eignet sich für Busbahnhöfe, Betriebshöfe, Wendeschleifen, Tramtrassen und nichtöffentliche Fahrwege. Sie prüft nicht automatisch, ob die direkte Linie Hindernisse schneidet. Fahrwegpunkte müssen deshalb sorgfältig und in Fahrreihenfolge gesetzt werden.

### Projektdateien und Autosave

Projektdateien speichern:

- `routingMode`: gewählte Routingart
- `preserveManualChains`: exakte Fahrwegpunkt-Ketten an oder aus
- `placementMode`: `freeStop` für Haltestellen oder `route` für Fahrwegpunkte

Autosave und History berücksichtigen dieselben Einstellungen. Alte Projekte ohne `routingMode` starten mit GuidedStreet. Fehlt `preserveManualChains`, wird die Option aktiviert. Ein ausdrücklich gespeichertes `false` bleibt erhalten.

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

Bei GuidedStreet gilt auch im Wizard `Fahrwegpunkte exakt halten`: Folgen zwei Fahrwegpunkte direkt aufeinander, wird ihre Punktfolge exakt übernommen. Ersatzhaltestellen, Durchfahrpunkte und Anschlüsse an die Originalroute werden weiterhin über Straßenrouting verbunden. Im Wizard-Modus Punktführung ist die gesamte gesetzte Folge ohnehin direkt.

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

Nur als Expertenmodus, wenn die gesamte Route exakt vorgegeben werden muss oder der Router einen Abschnitt nicht berechnen kann.

### Wann verwende ich GuidedStreet?

Wenn der Router grundsätzlich verwendet werden soll, aber über bestimmte Zwischenpunkte geführt werden muss.

### Warum läuft GuidedStreet trotz Fahrwegpunkt nicht über eine Busspur?

Ein einzelner Fahrwegpunkt erzwingt nur eine Koordinate. Für einen exakten Korridor mehrere Punkte in Fahrreihenfolge setzen und `Fahrwegpunkte exakt halten` aktivieren. Stopanschlüsse bleiben trotzdem Routersegmente.

### Bleibt der Setzmodus nach einem Klick aktiv?

Ja. `Haltestellen setzen` und `Fahrwegpunkte setzen` bleiben aktiv, bis bewusst umgeschaltet wird.

### Was passiert beim Abbrechen einer Umleitung?

Der temporäre Entwurf wird entfernt. Die ursprüngliche Route und Haltestellenfolge bleiben unverändert.

### Werden Fahrwegpunkte gespeichert?

Sie werden nicht als Haltestellen gespeichert. Ihre Wirkung wird in die finale Folge der RoutePoints übernommen.
