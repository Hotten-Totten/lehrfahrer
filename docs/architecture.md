# Architektur des Lehrfahrer-Linieneditors

Dokumentationsstand: **V2.1.000**

## Projektziel

Der Lehrfahrer-Linieneditor erstellt, bearbeitet und speichert Linienverläufe für den betrieblichen Einsatz. Er verbindet eine geordnete Haltestellenfolge mit einer unabhängig davon bearbeitbaren Routengeometrie. Die erzeugten Daten werden vom Editor, von Exportfunktionen und von der Fahrer-App verwendet.

Die Architektur muss zwei fachliche Ebenen sauber trennen:

- Die Haltestellenfolge beschreibt betriebliche und für Fahrgäste relevante Punkte.
- Die Routengeometrie beschreibt den tatsächlich zu fahrenden Weg.

Nicht jeder betriebliche Punkt ist ein Fahrgasthalt und nicht jeder Geometriepunkt ist eine Haltestelle.

## Aktuelle Architekturübersicht V2.1.000

Der Editor trennt in V2.1.000 vier Zustandsbereiche:

- `state.stops` enthält Haltestellen und Ghost-Haltestellen.
- `state.routePoints` enthält die finale Routengeometrie. Manuell gesetzte Fahrwegpunkte sind durch `sourceType: "manual"` als wiederverwendbare Routing-Anker erkennbar.
- `state.placementMode` steuert dauerhaft, ob Kartenklicks Haltestellen oder Fahrwegpunkte setzen.
- `state.routingMode` und `state.preserveManualChains` steuern die nächste Routenberechnung.

Straßenrouting und GuidedStreet verwenden zentral `buildStreetRouteCoordsViaAnchors()`. Der Helper ist zustandslos: Er verändert weder Editor-State noch History oder Autosave. Diese Verantwortung bleibt bei den aufrufenden Editorfunktionen.

## Kernobjekte

Die wichtigsten Objekte sind:

- Haltestellen und Ghost-Haltestellen in `state.stops`
- RoutePoints in `state.routePoints`
- temporäre Elemente eines aktiven Umleitungs-Wizards
- vereinfachte RoutePoints für Vorschau und Export
- Sondertrassen und weitere Editorzustände

Objekte im Editor können zusätzlich Marker oder Polylines für die Kartendarstellung enthalten. Solche Leaflet-Referenzen sind Laufzeitobjekte und dürfen nicht ungeprüft serialisiert werden.

## Haltestellen

Eine Haltestelle ist ein geordneter Punkt einer Linie. Sie besitzt mindestens Name, Koordinaten, Reihenfolge und betriebliche Zeitinformationen. Je nach Herkunft kann sie aus dem Haltestellenkatalog stammen oder frei gesetzt worden sein.

Normale Haltestellen sind Fahrgasthalte. Sie erscheinen in der Haltestellenliste des Editors und in der Fahrer-App.

Die Haltestellenreihenfolge und die Routengeometrie sind miteinander verbunden, aber nicht identisch. Eine Haltestelle muss durch geeignete Routing-Anker oder eine nachgelagerte Distanzprüfung an die Route gebunden werden.

## Ersatzhaltestellen

Ersatzhaltestellen ersetzen während einer Umleitung einen oder mehrere ursprüngliche Halte. Sie bleiben echte Haltestellen und werden nach Übernahme des Umleitungs-Wizards in `state.stops` eingefügt.

Fertige Ersatzhaltestellen tragen Umleitungsmetadaten, beispielsweise:

- `isDetourReplacement`
- `detourId`
- `detourRole`
- Referenzen oder Namen der ersetzten Originalhaltestellen

Eine Ersatzhaltestelle muss als Geometrie-Anker berücksichtigt werden. Eine Stopliste, deren Ersatzhalt neben der Route liegt, ist fachlich inkonsistent.

## Durchfahrpunkte

Ein Durchfahrpunkt ist eine Ghost-Haltestelle und ein betrieblicher Referenzpunkt. Er wird in der Haltestellenliste des Editors geführt, ist aber kein Fahrgasthalt.

Eigenschaften:

- betrieblicher Referenzpunkt
- Bestandteil der geordneten Stopfolge
- erscheint in der Haltestellenliste
- kann als Routing-Anker dienen
- wird in der Fahrer-App nicht als regulärer Fahrgasthalt behandelt
- wird typischerweise mit `isGhostPoint` und der Umleitungsrolle `passThrough` gekennzeichnet

Durchfahrpunkte eignen sich beispielsweise für benannte Durchfahrten, Abzweige oder betriebliche Kontrollpunkte.

## Fahrwegpunkte

Ein Fahrwegpunkt ist ein reiner Geometriepunkt. Er beeinflusst den Verlauf der Route, ist aber weder Haltestelle noch betrieblicher Stop.

Eigenschaften:

- reine Routengeometrie
- kein Halt
- kein Eintrag in der finalen Haltestellenliste
- kein Eintrag in der Fahrer-App
- keine Fahrgast- oder Zeitplanfunktion
- kann bei Punktführung oder GuidedStreet als Zwangspunkt dienen

Fahrwegpunkte werden im aktiven Wizard temporär separat von Stops gehalten. Bei der finalen Übernahme werden sie ausschließlich in Routengeometrie umgesetzt.

Im normalen Linieneditor entstehen Fahrwegpunkte als RoutePoints mit `sourceType: "manual"`. Sie können gesetzt, verschoben und gelöscht werden und bleiben bei GuidedStreet als Pflichtanker erhalten. Aufeinanderfolgende manuelle RoutePoints bilden eine Manual-Kette.

> **Feste Architekturentscheidung:** Durchfahrpunkte und Fahrwegpunkte sind unterschiedliche Konzepte und dürfen niemals zusammengelegt werden.

## RoutePoints

RoutePoints bilden die gespeicherte Geometrie einer Linie. Sie werden in ihrer Array-Reihenfolge als zusammenhängender Linienzug interpretiert.

RoutePoints können unterschiedliche Herkunft besitzen, zum Beispiel automatisch geroutet oder manuell erzeugt. Fahrwegpunkte sind Eingabeanker; nach der Berechnung entsteht daraus eine Folge von RoutePoints. Ein Fahrwegpunkt muss daher nicht dauerhaft als eigenes fachliches Objekt gespeichert werden.

## Ghostpunkte

Ghostpunkte sind Haltestellenobjekte ohne reguläre Fahrgastfunktion. Durchfahrpunkte sind eine fachlich definierte Form von Ghost-Haltestellen.

Ghostpunkte können für Navigation, Distanzberechnung oder betriebliche Referenzen benötigt werden. Verbraucher müssen über `isGhostPoint`, `isGhost` oder kompatible Legacy-Kennzeichen erkennen, dass kein regulärer Fahrgasthalt vorliegt.

Ghostpunkte dürfen nicht mit unsichtbaren Geometriepunkten verwechselt werden: Sie bleiben Stopobjekte.

## Routingmodi

Der normale Editor und der Umleitungs-Wizard unterscheiden drei Routingarten. Im normalen Editor ist `guidedStreet` der Standard. Die Modi legen fest, wie aus Stops und Fahrwegpunkten eine Routengeometrie entsteht.

### Straßenrouting

Interner Wert: `street`

Der Router berechnet automatisch eine Straßenroute zwischen Ersatzhaltestellen und Durchfahrpunkten. Fahrwegpunkte werden in diesem Modus nicht als Anker verwendet.

Vorteile:

- wenig Bedienaufwand
- geeignet für normale, im Routingnetz korrekt abgebildete Straßen
- automatische Erzeugung detaillierter RoutePoints

Grenzen:

- Busspuren oder Gleisbereiche können fehlen
- Zufahrts- und Durchfahrtsbeschränkungen können zu unerwünschten Umwegen führen
- Betriebshöfe und Sonderflächen sind häufig nicht ausreichend im Routingnetz abgebildet

### Punktführung

Interner Wert: `manual`

Es findet keine Straßenrouter-Berechnung statt. Die Linie folgt exakt der gesetzten Ankerfolge. Zwischen den Ankern wird die Geometrie linear verdichtet.

Die Ankerfolge im stop-basierten Umleitungs-Wizard lautet:

1. Haltestelle vor dem Umleitungsbereich
2. alle temporären Ersatzhaltestellen, Durchfahrpunkte und Fahrwegpunkte in Bedienreihenfolge
3. Haltestelle nach dem Umleitungsbereich

Punktführung ist ein Experten- und Legacy-Modus für Bereiche, die ein Straßenrouter nicht sinnvoll oder gar nicht routen kann.

### GuidedStreet

Interner Wert: `guidedStreet`

GuidedStreet verbindet automatische Straßenrouter-Berechnung mit einer expliziten Ankerfolge. Der Router berechnet jeden Abschnitt zwischen zwei aufeinanderfolgenden Ankern separat.

Im Umleitungs-Wizard werden folgende Elemente als Zwangspunkte verwendet:

- Ersatzhaltestellen
- Durchfahrpunkte
- Fahrwegpunkte

Typische Anwendungsfälle:

- Busspuren
- Straßenbahngleise
- Betriebshöfe
- Wendeschleifen
- Baustellenführungen
- Durchfahrverbote oder Bereiche mit Freigabe für Linienverkehr

GuidedStreet zwingt den Router über gesetzte Koordinaten, ändert aber nicht automatisch das zugrunde liegende Routingprofil oder dessen Zugangsregeln. Wenn der Router einen Abschnitt grundsätzlich nicht akzeptiert, bleibt Punktführung der notwendige Fallback.

### Exakte Fahrwegpunkt-Ketten

Interne Option: `preserveManualChains`

Die Option ist in neuen Projekten standardmäßig aktiv. Fehlt das Feld in einer alten Projektdatei, wird ebenfalls `true` verwendet. Ein ausdrücklich gespeichertes `false` bleibt erhalten.

Bei aktivierter Option gilt:

- Stop zu Fahrwegpunkt: Straßenrouting
- Fahrwegpunkt zu Fahrwegpunkt: direkte, exakte Koordinatenfolge ohne Routeraufruf
- Fahrwegpunkt zu Stop: Straßenrouting

Der Helper entfernt doppelte Segmentübergänge. Manual-Punkte mit weniger als 25 Zentimetern Abstand werden weiterhin dedupliziert. Die exakte Verbindung ist eine bewusste Nutzervorgabe und darf daher auch über Flächen verlaufen, die ein Straßenrouter nicht akzeptieren würde.

## Stop-basierter Umleitungs-Wizard

Der Wizard bearbeitet einen zusammenhängenden Bereich der Haltestellenfolge, ohne Originalroute und Originalstopps während des Entwurfs sofort zu verändern.

Phasen:

1. Zusammenhängenden Stopbereich auswählen.
2. Bereich übernehmen.
3. Ersatzhaltestellen, Durchfahrpunkte und Fahrwegpunkte setzen.
4. Routingmodus wählen.
5. Geometrie berechnen und Umleitung übernehmen oder Entwurf abbrechen.

Temporäre Ersatzhaltestellen und Durchfahrpunkte liegen in `replacementStops`. Temporäre Fahrwegpunkte liegen in `manualRoutePoints`. Alle temporären Elemente erhalten zusätzlich:

- `detourItemOrder` für die gemeinsame Bedienreihenfolge
- `kind` mit `replacementStop`, `passThroughStop` oder `guidePoint`

Die beiden Arrays dürfen für Speicherung und spezialisierte Bearbeitung getrennt bleiben. Für Preview, Manual-Routing, GuidedStreet, Sidebar und finalen Stop-Splice ist jedoch die gemeinsame, nach `detourItemOrder` sortierte Folge maßgeblich.

Beim finalen Stop-Splice werden nur `replacementStop` und `passThroughStop` übernommen. `guidePoint` wird ausschließlich in Routengeometrie umgesetzt.

Der Modus `street` darf Fahrwegpunkte ignorieren, soll sie beim Moduswechsel aber nicht zerstören.

Bei GuidedStreet werden aufeinanderfolgende Wizard-Elemente vom Typ `guidePoint` intern als Manual-Kette an den gemeinsamen Routinghelper übergeben. Ist `preserveManualChains` aktiv, wird nur `guidePoint` zu `guidePoint` direkt verbunden. Ersatzhaltestellen, Durchfahrpunkte und die Anschlüsse an `beforeStop` und `afterStop` bleiben Routersegmente. Die Punktführung des Wizards war bereits vollständig direkt und bleibt davon unabhängig.

## Save/Load

Save/Load serialisiert die fertige Linie, nicht die temporären Leaflet-Objekte eines aktiven Wizard-Entwurfs.

Gespeichert werden insbesondere:

- finale Haltestellen und Ghost-Kennzeichen
- Umleitungsmetadaten fertiger Ersatz- und Durchfahrpunkte
- finale RoutePoints
- Linien-, Routen- und Richtungsmetadaten
- `routingMode`: `street`, `guidedStreet` oder `manual`
- `preserveManualChains`: exakte Manual-Ketten an oder aus
- `placementMode`: dauerhaftes Setzen von `freeStop` oder `route`

Beim Laden müssen alte Formate weiterhin unterstützt werden. Fehlende neue Felder benötigen sichere Defaults. Das Speichern während eines aktiven Wizard-Entwurfs muss zukünftig ausdrücklich blockiert oder fachlich definiert werden.

## Autosave

Autosave schützt den normalen Editorzustand im Browser. Aktive Wizard-Drafts werden derzeit nicht vollständig persistiert. Temporäre Marker und Wizard-Arrays dürfen daher nicht als wiederherstellbar vorausgesetzt werden.

Fertige Umleitungsstopps und deren Metadaten gehören dagegen zum normalen Linienzustand und werden im Autosave berücksichtigt. Autosave speichert außerdem `routingMode`, `preserveManualChains` und `placementMode`. Alte Autosaves ohne Strict-Feld laden `preserveManualChains` mit `true`; alte Setzmodi werden soweit möglich aus `routeMode` abgeleitet.

## History

Undo/Redo arbeitet snapshot-basiert. Die finale Übernahme einer Umleitung muss als zusammenhängende Aktion rückgängig gemacht werden können.

Snapshots enthalten in V2.1.000 auch Routingmodus, Strict-Option und Setzmodus. Der Routinghelper selbst schreibt weiterhin keine History.

Einzelne temporäre Wizard-Schritte sind derzeit keine vollständigen History-Aktionen. Das Verhalten von Undo/Redo während eines aktiven Wizards muss vor weiterer Ausweitung ausdrücklich definiert werden.

## GPX

Der GPX-Track wird aus der finalen Routengeometrie erzeugt. Damit fließen auch Punktführung und GuidedStreet in den Track ein.

GPX-Waypoints werden aus Stopobjekten erzeugt. Für Durchfahrpunkte muss fachlich entschieden und getestet werden, ob sie als Waypoints exportiert, besonders gekennzeichnet oder ausgefiltert werden sollen. Fahrwegpunkte dürfen nicht als Stop-Waypoints erscheinen.

## Fahrer-App

Die Fahrer-App verwendet die gespeicherte Routengeometrie für Anzeige und Navigation. Reguläre Haltestellen erscheinen in der Stopliste.

Durchfahrpunkte sind Ghost-Haltestellen und keine Fahrgasthalte. Fahrwegpunkte sind reine Editor- und Routinghilfen und erscheinen niemals als Stop in der Fahrer-App.

Die Fahrer-App darf nicht aus dem Fehlen eines Fahrgasthalts schließen, dass ein Punkt für Geometrie oder Betrieb bedeutungslos ist.

## Feste Architekturentscheidungen

1. Durchfahrpunkte und Fahrwegpunkte bleiben dauerhaft getrennte Konzepte.
2. Stopfolge und Routengeometrie sind getrennte, aber zu validierende Ebenen.
3. Fahrwegpunkte werden nicht in `state.stops` übernommen.
4. Durchfahrpunkte bleiben Stopobjekte und tragen ein Ghost-Kennzeichen.
5. Manual und GuidedStreet berücksichtigen im Wizard alle temporären Elemente in gemeinsamer Bedienreihenfolge.
6. Street-Routing verwendet Stops und Durchfahrpunkte, aber keine Fahrwegpunkte.
7. Ein Moduswechsel darf gesetzte Fahrwegpunkte nicht unbemerkt löschen.
8. Temporäre Kartenobjekte sind keine direkt serialisierbaren Fachdaten.
9. Fertige Umleitungsmetadaten müssen Save/Load, Autosave und History überstehen.
10. Neue Routingfunktionen sollen auf gemeinsamen Routinghelpern aufbauen und keine parallelen Sonderimplementierungen erzeugen.
11. `placementMode` ist vom geometrischen `routeMode` getrennt, damit der gewählte Setzmodus Routingberechnungen übersteht.
12. Strict-Fahrwegführung verändert nur aufeinanderfolgende Manual-Anker; Stopanschlüsse bleiben geroutet.

## Bekannte Einschränkungen

- Stop- und Zwischenstopp-Zuordnungen zur Route beruhen bei Schleifen teilweise auf dem nächsten RoutePoint und können mehrdeutig sein.
- Exakte Manual-Segmente prüfen nicht automatisch, ob sie Straßen, Hindernisse oder betriebliche Grenzen schneiden.
- Segment-Neuberechnung erkennt betroffene Stops, verwendet sie aber nicht automatisch als Pflichtanker.
- Aktive Wizard-Drafts werden nicht vollständig in Autosave oder Projektdateien persistiert.
- Das GPX-Verhalten für Durchfahrpunkte ist noch nicht abschließend fachlich festgelegt.
- Für Routingfehler, Schleifen und dichte Manual-Ketten fehlen automatisierte Browser- und Integrationstests.

## Zukunftsplanung

GuidedStreet, der gemeinsame Routinghelper und Strict-Manual-Ketten sind seit V2.1.000 im normalen Linieneditor vorhanden.

### Empfehlungen für zukünftige Entwicklung

- Routingentscheidungen weiterhin im gemeinsamen Helper konzentrieren; State-Mutationen bleiben in den Editor-Workflows.
- Strict-Führung langfristig segmentbezogen modellieren, statt weitere globale Modi einzuführen.
- Neue Datenfelder immer mit Migrationstests für fehlende, `false` gesetzte und alte Legacy-Werte absichern.
- Stop-Anker, Manual-Anker und Ghost-Stops in automatisierten Tests als getrennte Fachobjekte behandeln.
- Vor einer vollständigen Wizard-Persistenz Undo, Save und Autosave für aktive Entwürfe gemeinsam definieren.
- Routingqualität nicht nur anhand vorhandener RoutePoints, sondern auch anhand der Entfernung fachlich erforderlicher Stops bewerten.

Weitere geplante Bausteine:

- automatisierte Tests für Street, GuidedStreet, Strict-Manual-Ketten und Fehler-Rollback
- definierter Umgang mit Save/Load und Undo während aktiver Wizard-Drafts
- Routingpresets für Busspur, Betriebshof, Gleisbereich und Sonderzufahrten
- segmentbezogene Routingmetadaten
- segmentbezogene Entscheidung zwischen Routing und exakter Geometrie
- robuste Behandlung mehrdeutiger Stop-Zuordnungen in Schleifen
