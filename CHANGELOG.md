# Changelog

## V2.0.170 - 2026-06-11
- **GitHub als zentrale Quelle und Strato-Deploy vorbereitet**:
  - Remote `origin` auf `https://github.com/Hotten-Totten/lehrfahrer.git` eingerichtet und lokaler `main` als aktueller Hauptstand nach GitHub gepusht
  - Automatisches Live-Deploy per GitHub Actions vorbereitet: neue Workflow-Datei [deploy-strato.yml](.github/workflows/deploy-strato.yml)
  - Deploy erfolgt bei jedem Push auf `main` via `rsync` ueber SSH auf den Strato-Server
  - Erforderliche GitHub-Secrets dokumentiert im Workflow: `STRATO_HOST`, `STRATO_PORT`, `STRATO_USER`, `STRATO_SSH_KEY`, `STRATO_TARGET_PATH` (optional `STRATO_KNOWN_HOSTS`)

## V2.0.169 - 2026-06-10
- **Editor-Topbar nach `Neu` verlässlich wiederhergestellt**:
  - Eingabemaske (`Ort/Linie/Route/Richtung/Farbe/Suche`) wird nach Klick auf `Neu` aktiv erzwungen sichtbar gemacht
  - Zusätzliche kurze Retry-Wiederherstellung eingebaut, falls ein spaeter UI-State die Topbar erneut ausblendet
  - Cache-Busting in [index.html](index.html) von `V2.0.165` auf `V2.0.169` angehoben, damit Browser den Fix sicher lädt

## V2.0.168 - 2026-06-10
- **Navi-Pfeil und Richtungsansagen an Haltestellen stabilisiert**:
  - Neue Heading-Stabilisierung: Sensor-Heading wird gegen Routentangente plausibilisiert
  - Grobe Gegensinn-Ausreißer (seitlich/rueckwaerts) werden verworfen
  - HUD-Fortschritt mit Vorwaerts-Hysterese, damit Richtungsansagen bei GPS-Jitter nicht kurz zurueckspringen

## V2.0.167 - 2026-06-10
- **Pfeil-Glättung in Einstellungen integriert**:
  - Neue Optionen in den App-Einstellungen (nicht auf dem Hauptbildschirm)
  - Separate Profile für Marker-Bewegung (`Ruhig/Normal/Direkt`) und Marker-Drehung (`Ruhig/Normal/Direkt`)
  - Interpolation und Dreh-Nachführung nutzen diese Profile live in der Navigation

## V2.0.166 - 2026-06-10
- **App-Navigationspfeil deutlich fluessiger gemacht**:
  - Markerbewegung von GPS-Fix zu GPS-Fix wird jetzt per `requestAnimationFrame` interpoliert statt sprunghaft gesetzt
  - Drehung des Pfeils wird weich nachgefuehrt (Heading-Smoothing zwischen Updates)
  - Gilt fuer normalen GPS-Modus und fuer die routengesnappte Navigationsdarstellung
  - Animation wird beim Stoppen sauber beendet, damit keine Restbewegungen bleiben

## V2.0.165 - 2026-06-07
- **Richtungsanzeige robuster gemacht**:
  - Namensabgleich verbessert (z. B. mit/ohne Stadt-Präfix wie `Cottbus, ...`)
  - Suchradius und Geometrie-Heuristik erweitert
  - Zusätzlicher Nearest-Neighbor-Fallback für Fälle ohne klaren Cluster
  - Ziel: Richtungsdreieck im `B`/`T`-Marker wird deutlich häufiger berechnet

## V2.0.164 - 2026-06-07
- **Richtungsanzeige direkt im B/T-Marker integriert**:
  - Richtung wird jetzt als kleines Dreieck im Marker selbst dargestellt (statt externem Badge)
  - Dadurch ist die Information direkt im `B`/`T`-Symbol sichtbar und robuster lesbar
  - Geometrie-Fallback bleibt erhalten, wenn keine Richtungstexte vorhanden sind

## V2.0.163 - 2026-06-07
- **Alternative zu Pfeilsymbolen umgesetzt**:
  - Statt Unicode-Pfeilen werden nun robuste Richtungs-Badges angezeigt (`N`, `S`, `O`, `W`, `NO`, `NW`, `SO`, `SW`)
  - Badge sitzt direkt am `B`/`T`/`M`-Marker und ist font-unabhängig besser sichtbar
  - Geometrie-Fallback bleibt aktiv, wenn keine Richtungstexte vorhanden sind

## V2.0.162 - 2026-06-07
- **Hotfix Richtungspfeile**:
  - Fehler behoben, bei dem bei leerem Richtungsfeld kein Fallback-Pfeil berechnet wurde
  - Geometrie-Fallback greift jetzt auch ohne `direction/towards` zuverlässig

## V2.0.161 - 2026-06-07
- **Richtungspfeile sichtbar gemacht (Fallback)**:
  - Wenn keine Richtungstexte vorliegen, wird die Richtung aus der Lage gleichnamiger Haltestellen abgeleitet
  - Dadurch erscheinen Pfeile nun auch bei vielen OSM-Datensätzen ohne `direction/towards`
  - Katalogmarker und Linien-Haltestellen nutzen dieselbe Fallback-Logik

## V2.0.160 - 2026-06-07
- **Richtungspfeil in Haltestellenmarker ergänzt**:
  - Marker mit `B`/`T` (und `M`) zeigen jetzt zusätzlich einen kleinen Richtungspfeil
  - Pfeil wird aus verfügbaren Richtungsfeldern (z. B. `directionHint`, `direction`, `towards`) abgeleitet
  - Gilt für Katalogmarker und übernommene Linien-Haltestellen, inkl. Laden/Autosave/Undo

## V2.0.159 - 2026-06-07
- **Haltestellen im Editor klar unterscheidbar gemacht**:
  - Bus-Haltestellen jetzt Lila mit weißem `B`
  - Tram-Haltestellen jetzt Rot mit weißem `T`
  - Katalogmarker und übernommene Linien-Haltestellen nutzen dieselbe Typ-Logik
  - Typ bleibt bei Laden, Autosave sowie Undo/Redo konsistent erhalten

## V2.0.158 - 2026-06-07
- **Tram-Haltestellen wieder korrekt behandelt**:
  - Tram- und Bus/Tram-Haltestellen werden nicht mehr auf das Auto-Straßenprofil gesnappt
  - Der strenge Snap-Filter entfernt diese Haltestellen nicht mehr
  - Ergebnis: Tramgassen und gemeinsame Bus/Tram-Führungen bleiben erhalten

## V2.0.157 - 2026-06-07
- **Snap-Filter verschärft (auf Wunsch)**:
  - Wenn "Haltestellen auf Fahrbahnmitte ausrichten" aktiv ist, bleiben nur erfolgreich gesnappte Haltestellen erhalten
  - Haltestellen ohne gültigen Straßensnap werden konsequent verworfen
  - Import bricht mit klarer Meldung ab, falls keine Haltestelle innerhalb des Snap-Abstands liegt

## V2.0.156 - 2026-06-07
- **Fallback bei fehlender Richtungsinfo verbessert**:
  - Gleichnamige Haltestellen ohne Richtung werden clusterweise auf Nord- und Süd-Extrempunkt reduziert
  - Zielbild: statt 3-4 nahezu identischen Punkten bleiben maximal 2 (Nord/Süd)
  - Statusausgabe erweitert: zeigt Anzahl der auf Nord/Süd reduzierten Einträge

## V2.0.155 - 2026-06-07
- **Haltestellen-Import optimiert: max. 1 Haltestelle pro Richtung**:
  - Richtungsinfos aus OSM (`towards`/`destination`/`direction`/`local_ref`) werden übernommen
  - Nahe Duplikate mit gleichem Namen und gleicher Richtung werden auf einen Punkt zusammengeführt
  - Merge-Schutz ergänzt: Gegenrichtungen werden nicht mehr versehentlich zusammengeführt
  - Ergebnis-Status zeigt an, wie viele Richtungs-Duplikate entfernt wurden

## V2.0.154 - 2026-06-07
- **Haltestellen-Import erweitert: optional auf Fahrbahnmitte ausrichten**:
  - Neuer Schalter im "Katalog laden"-Modal: Haltestellen auf Fahrbahnmitte ausrichten (OSRM)
  - Neuer Sicherheitswert "Max. Abstand" (z. B. 20 m), damit nur nahe Punkte verschoben werden
  - Import zeigt Fortschritt und Anzahl der angepassten Haltestellen
  - Originalkoordinaten werden bei Anpassung mitgespeichert (`originalLat`, `originalLon`)

## V2.0.153 - 2026-06-07
- **Editor-Design wiederhergestellt (klassisch)**:
  - `Neu`-Eingabe-Modal wieder entfernt
  - Rueckkehr zum alten Topbar-Design mit direkter Eingabe im Hauptlayout
  - `Neu` setzt wieder Fokus in das Linienfeld der Topbar

## V2.0.152 - 2026-06-07
- **Editor-UX stabilisiert: `Neu` nutzt jetzt eigenes Eingabe-Modal**:
  - Eigene Eingabemaske (Linie/Route/Richtung/Farbe) erscheint direkt bei `Neu`
  - Umgeht das persistente Auf/Zu-Problem der Topbar-Eingabe auf einzelnen Browser-Setups
  - Eingabe ist dadurch sofort und zuverlässig möglich

## V2.0.151 - 2026-06-07
- **Editor-Fix: Verhalten nicht mehr von F12/DevTools abhaengig**:
  - Cache-Buster fuer `editor.css` und alle lokalen Editor-Skripte in `index.html` aktiviert
  - Verhindert, dass alter Browser-Cache alte `Neu`-Logik weiter ausliefert
  - Neues Verhalten ist damit auch ohne DevTools sofort aktiv

## V2.0.150 - 2026-06-07
- **Editor-Fix: `Neu` klappt nicht mehr sofort wieder zu (cache-robust)**:
  - Legacy-Klasse `input-menu-hidden` wird beim Umschalten aktiv entfernt
  - Verhindert Regressionsfall durch alte gecachte CSS/JS-Zustaende
  - Eingabemaske bleibt nach `Neu` offen

## V2.0.149 - 2026-06-07
- **Editor-Fix: `Neu`-Eingabemaske bleibt offen und bedienbar**:
  - Sichtbarkeitslogik von globalem Body-Status auf direktes Topbar-Toggling umgestellt
  - Regressionsfehler "kurz auf, dann wieder zu" behoben
  - Eingabefelder bleiben nach `Neu` fokussierbar und editierbar

## V2.0.148 - 2026-06-07
- **Editor-Fix: Kein Auf/Zu-Flackern mehr bei `Neu`**:
  - Doppelte Nachtrigger zum Einblenden der Eingabemaske entfernt
  - Eingabemaske wird jetzt nur einmal stabil geoeffnet
  - Fokus wird per `requestAnimationFrame` sauber ins Linienfeld gesetzt

## V2.0.147 - 2026-06-07
- **Editor-UX umgestellt: Eingabemaske nur bei `Neu`**:
  - Obere Eingabemaske ist standardmaessig ausgeblendet
  - Klick auf `Neu` blendet die Eingabemaske gezielt ein und setzt Fokus ins Linienfeld
  - Ohne `Neu` bleibt die Eingabemaske verborgen

## V2.0.146 - 2026-06-07
- **Editor-Fix: `Neu` oeffnet Eingabemenue jetzt aktiv**:
  - Beim Klick auf `Neu` wird die Ansicht immer an den Anfang gescrollt
  - Menuezeile, Topbar und Eingabegruppen werden mehrfach nachgetriggert sichtbar gemacht
  - Statusmeldung klarer: Eingabemenue geoeffnet

## V2.0.145 - 2026-06-07
- **Editor-Fix: Eingabezeile bei `Neu` bleibt sichtbar**:
  - `Neu` erzwingt jetzt die Sichtbarkeit von Menuezeile, Topbar und allen Eingabegruppen
  - Zusätzlicher kurzer Nachtrigger verhindert, dass nachgelagerte UI-Updates die Eingabezeile direkt wieder ausblenden
  - Fokus bleibt auf dem Linienfeld fuer sofortige Eingabe

## V2.0.144 - 2026-06-07
- **Editor-Routing: Manuelle Pflichtpunkte werden jetzt strikt erzwungen**:
  - Wenn manuelle Routenpunkte vorhanden sind, werden betroffene Abschnitte als direkte Verbindung aufgebaut
  - Dadurch entstehen keine ungewollten Umfahrungen ueber Valhalla/OSRM (z. B. wegen Durchfahrtsverboten)
  - Admin-gesetzte Punkte bestimmen den Verlauf jetzt verbindlich

## V2.0.143 - 2026-06-07
- **API-Auth entschärft (Arbeitsmodus)**:
  - Schreibzugriffe sind wieder ohne gesetzten Server-Token möglich
  - Token-Prüfung greift nur noch, wenn `LEHRFAHRER_API_TOKEN` auf dem Server tatsächlich gesetzt ist
  - Damit funktionieren Speichern/Löschen im aktuellen Entwicklungsbetrieb wieder ohne Token-Handling

## V2.0.142 - 2026-06-07
- **Fix: Speichern/Loeschen bei Umleitungen wieder konsistent**:
  - Umleitungs-Erkennung im Backend verbessert (auch wenn nach `Umleitung_XX` noch Richtung/weitere Teile im Dateinamen stehen)
  - Bestehende Umleitungen werden jetzt korrekt als Umleitung erkannt und nicht versehentlich erneut als neue Umleitung abgespeichert
  - Doppelte/ungewollte Suffix-Ketten beim Speichern verhindert

## V2.0.141 - 2026-06-07
- **Editor: Umleitungslabel im Linien-Browser**:
  - Linien mit `Umleitung_XX` im Dateinamen oder Routennamen erhalten jetzt ein sichtbares Badge `Umleitung`
  - Badge erscheint direkt neben JSON/GPX-Status und macht Umleitungen sofort erkennbar

## V2.0.140 - 2026-06-07
- **Editor-Backend: Originalroute wird bei Aenderungen nicht mehr ueberschrieben**:
  - Beim Speichern auf einer Originaldatei mit gleicher Route/Richtung wird automatisch eine neue Datei mit Suffix `Umleitung_XX` erzeugt
  - Der Routename wird ebenfalls um `Umleitung_XX` erweitert, damit die Umleitung im Browser klar erkennbar/laadbar ist
  - Bereits bestehende Umleitungen (`..._Umleitung_XX`) koennen weiterhin normal ueberschrieben werden

## V2.0.139 - 2026-06-07
- **App: Sofort-Refresh fuer geaenderte Linien eingebaut**:
  - Neuer Refresh-Button (oben in der App) aktualisiert Linienkatalog und aktuelle Linie sofort
  - Bei laufender Navigation gibt es eine Sicherheitsabfrage; danach wird Navigation sauber beendet und automatisch neu gestartet
  - API-Ladevorgaenge fuer Staedte/Linien/Route jetzt konsequent mit `cache: no-store` + Cache-Buster
  - Ziel: Aenderungen aus dem Editor direkt in der App sichtbar machen ohne App-Neustart

## V2.0.138 - 2026-06-07
- **Editor-Fix: Gespeicherte Routen/Linien im Browser jetzt stabil sichtbar**:
  - Laden der Linienliste verwendet jetzt konsequent `cache: no-store`
  - Zusätzlicher Cache-Buster (`_ts`) verhindert veraltete Browser-Antworten
  - Race-Condition beim mehrfachen Öffnen/Aktualisieren des Linien-Browsers behoben
  - Veraltete (langsamere) Antworten überschreiben die aktuelle Liste nicht mehr

## V2.0.137 - 2026-06-07
- **Editor: Umleitungen/Einfügen in bestehende Reihenfolge verbessert**:
  - Markierte Haltestelle in der Haltestellen-Reihenfolge dient jetzt als Einfügeanker
  - Neue Haltestellen (freie oder Katalog-Haltestellen) werden direkt darunter eingefügt
  - Aktive Markierung in der Reihenfolge ist stabiler sichtbar
  - Statushinweis ergänzt, dass neue Haltestellen unter der Auswahl eingefügt werden

## V2.0.136 - 2026-06-07
- **Editor-Fix: Bei "Neu" ist das Eingabefeld jetzt sofort sichtbar/nutzbar**:
  - Nach Klick auf `Neu` wird die obere Eingabeleiste aktiv hervorgehoben
  - Editor scrollt zur Eingabeleiste und setzt den Cursor direkt ins Linienfeld
  - Statushinweis ergaenzt: Linie/Route/Richtung oben eingeben

## V2.0.135 - 2026-06-07
- **Sofort-Updates ohne Voll-Reload aller Linien**:
  - Start-Update laedt nur noch fehlende oder geaenderte Linien
  - Aenderungserkennung ueber `updatedAt` aus `list_lines.php` (Datei-MTime)
  - Linien-Downloads speichern `sourceUpdatedAt` lokal zum Vergleich
  - API-Requests bleiben `cache: no-store`, damit kurzfristige Umleitungen sofort erkannt werden

## V2.0.134 - 2026-06-07
- **"Sofort aktuelle Linien" umgesetzt (Umleitungen direkt in der App)**:
  - Startup-Refresh laedt jetzt immer alle verfuegbaren Linien neu
  - API-Fetches fuer Katalog und Linien auf `cache: no-store` gestellt
  - Dadurch kommen kurzfristige Aenderungen/Umleitungen ohne Alt-Cache in der App an

## V2.0.133 - 2026-06-07
- **Fix: Linien werden beim App-Start nicht mehr doppelt geladen**:
  - Startup-Auto-Download mit Session-Guard abgesichert (pro Version/Tab nur ein Durchlauf)
  - Verhindert zweiten Download nach SW-bedingtem Reload direkt nach dem ersten Start
  - Bei Fehler wird der Guard geloescht, damit ein spaeterer Retry weiterhin moeglich ist

## V2.0.132 - 2026-06-07
- **Fix: Landscape-Following greift jetzt auch auf groesseren Handys/Tablets**:
  - Starre Breiten-Grenze (`<= 950px`) fuer Landscape-Erkennung entfernt
  - Umschaltung jetzt auf `orientation: landscape` + Touch-/Tablet-Heuristik
  - Dadurch werden Strict-Follow und Landscape-Fokus-Anpassungen auf realen Geraeten konsistent angewendet

## V2.0.131 - 2026-06-07
- **Fix: Marker in Landscape jetzt konstant sichtbar (Strict-Follow)**:
  - In mobilem Querformat wird Navi-Following auf `jumpTo` umgestellt
  - Laufende Kamera-Animationen werden dabei konsequent gestoppt
  - Verhindert das sporadische "mal da, mal weg" des Positionspfeils

## V2.0.130 - 2026-06-07
- **Fix: SIM startet wieder sauber und bleibt nicht beim ersten Frame stehen**:
  - Kurze Pause-Input-Sperre direkt nach Navi-Start eingefuehrt
  - Verhindert Ghost-Taps/Rest-Clicks, die unmittelbar nach SIM-Start ungewollt auf "Pause" schalten
  - Ergebnis: SIM laeuft nach dem Start wieder kontinuierlich weiter

## V2.0.129 - 2026-06-07
- **Landscape-Fokus in Gegenrichtung angepasst (weiter weg)**:
  - Kamera im Querformat bewusst auf "weiter weg" umgestellt
  - Marker erscheint dadurch hoeher im Bild statt tiefer
  - Landscape-Feintuning: mehr Distanzwirkung durch angepasstes Zoom/Pitch/Padding

## V2.0.128 - 2026-06-07
- **Landscape-Fokus weiter nach vorne + stabilerer Marker-Fokuspunkt**:
  - Fahrerfokus im Querformat erweitert (mehr Sicht nach vorn, Marker tiefer im Bild)
  - Drift-Guard nutzt jetzt den echten Kamera-Sollpunkt aus den aktuellen Padding-Werten
  - Recenter-Schwellen weiter verschaerft, damit Abweichungen frueher korrigiert werden

## V2.0.127 - 2026-06-07
- **Fix: Positionspfeil nach Kurven deutlich strenger im Fokus gehalten**:
  - Drift-Guard-Schwellen klar verschaerft (frueheres Recenter)
  - Sollposition des Markers im Viewport nach unten verlagert (stabiler Fahrerfokus)
  - Vor jedem Follow-Update wird laufende Kamera-Animation gestoppt, um Animationsstau zu vermeiden
  - Kamera-Dauern weiter verkuerzt fuer direkteres Nachziehen

## V2.0.126 - 2026-06-07
- **Fix: Positionspfeil bleibt auch nach mehreren Kurven im Fokus**:
  - Kamera-Following um Drift-Guard erweitert
  - Bei starker Abweichung im Viewport wird hart re-zentriert (`jumpTo`) statt weiter weich animiert
  - Verhindert, dass der Pfeil nach Kurvenfolgen "irgendwo auf der Karte" landet

## V2.0.125 - 2026-06-07
- **Fix: Karte im Landscape wieder mittig/breit + Marker stabil sichtbar**:
  - Nav-Mode erzwingt jetzt volle Kartenbreite auch dann, wenn `panel-is-open` noch gesetzt ist
  - Split-Panel-State wird beim Start der Navigation aktiv zurueckgesetzt
  - `map.resize()` wird bei Panel/Nav-Layoutwechseln und beim Drehen des Geraets angestossen
  - Ziel: kein halbes Kartenfenster mehr und deutlich stabilerer Navi-Pfeil nach Rotate/Layoutwechsel

## V2.0.124 - 2026-06-07
- **Fix: Navi-Pfeil driftet nicht mehr weg / bleibt im Fahrerfokus**:
  - GPS-Navigation setzt Marker jetzt auf denselben gesnappten Trackpunkt wie die Kamera
  - Marker-Update und Kamera-Following nutzen damit konsistente Positionsdaten
  - Rohe GPS-Markerupdates werden im aktiven Navi-Modus unterdrueckt, um Auseinanderlaufen zu verhindern

## V2.0.123 - 2026-06-07
- **Mobile-Querformat verbessert (Drehen des Geraets)**:
  - Portrait-Regeln auf `orientation: portrait` begrenzt, damit sie Landscape nicht mehr ueberschreiben
  - Eigenes Landscape-Finetuning fuer Navi-HUD-Grid, Abstaende und Button-Groessen
  - Compact-Buttons im Landscape auf konsistente Touch-Groesse gesetzt
  - Sidebar-Position/ -Breite fuer kommende Stops im Landscape angepasst

## V2.0.122 - 2026-06-07
- **Fix: "Abbrechen" im Navi-Menue stoppt die Navigation nicht mehr**:
  - `navCancelBtn` schliesst jetzt nur noch das Menue
  - Navigation bleibt aktiv und laeuft direkt weiter
  - Kein Rueckfall mehr in den Routen-Eingabemodus

## V2.0.121 - 2026-06-07
- **Hotfix: alle drei Compact-Navi-Buttons wieder bedienbar**:
  - Einheitliches Tap-Handling fuer Menue, Pause und Stop eingefuehrt (`touchend` + Click-Fallback)
  - Blockierende `preventDefault`-Pfade entfernt
  - Compact-Button-Leiste mit hoehrem `z-index` abgesichert, damit keine HUD-Elemente die Touches ueberlagern

## V2.0.120 - 2026-06-07
- **Hotfix: Pausenbutton reagiert wieder zuverlaessig**:
  - Press-Handler von `pointerup` auf iOS-stabiles `touchend` + `click`-Fallback umgestellt
  - Doppeltrigger-Schutz bleibt aktiv, ohne die Ausloesung komplett zu blockieren
  - Ziel: erster Tap loest wieder sicher aus

## V2.0.119 - 2026-06-07
- **Pausenbutton reagiert jetzt deutlich zuverlaessiger beim ersten Tap**:
  - Pause-Buttons auf robustes Press-Handling umgestellt (`pointerup` + `click` mit Doppeltrigger-Schutz)
  - Verhindert Fehlausloesungen durch mobile Touch/Click-Eigenheiten
  - Touch-Flaeche im iPhone-Portrait fuer Compact-Buttons vergroessert (bessere Trefferquote)

## V2.0.118 - 2026-06-07
- **Pause bleibt jetzt wirklich aktiv bis erneut geklickt wird**:
  - GPS-Positionsupdates werden waehrend Pause nicht mehr verarbeitet
  - SIM-Ticks werden waehrend Pause nicht mehr weitergezaehlt
  - Fahrzeitanzeige im HUD laeuft waehrend Pause nicht weiter
  - Ergebnis: Navi bleibt stabil im Pausenstatus und startet nicht mehr nach ein paar Sekunden von selbst

## V2.0.117 - 2026-06-07
- **Start-Download jetzt als Vollbild-Popup statt Mini-Zeile**:
  - Neues Overlay fuer den App-Start eingefuehrt (gesamtbildschirmig, mit Spinner)
  - Fortschritt wird waehrend des Auto-Downloads als Zaehler `x/y` inkl. Linienname angezeigt
  - Bisheriger kleiner Topbar-Hinweis `Linien laden...` aus dem Flow entfernt
- **Pause-Button im kompakten Navi-HUD ergaenzt**:
  - Neuer Compact-Button zwischen Optionen (Menue) und Stop eingefuegt
  - Mit bestehender Pause-Logik verbunden (Pause/Fortsetzen inkl. Icon-Status)
  - Pause-Status wird bei Start/Stop der Navigation sauber zurueckgesetzt

## V2.0.116 - 2026-06-07
- **Fix: Neue Stände kamen teils nicht in der App an**:
  - Service-Worker-Registrierung von hartem `V2.0.42` auf dynamische Version (aus `versionBadge`) umgestellt
  - Damit zieht die App bei jedem Release verlässlich den passenden SW-Stand
  - Cache-/Asset-Versionen auf `V2.0.116` angehoben

## V2.0.115 - 2026-06-07
- **Kurvenrotation entruckelt und Geradeaus-Fokus verbessert**:
  - Ueberaggressive Turn-Boost-Werte reduziert (weniger harte Spruenge)
  - Kamera-Animationen bei Kurven weiterhin schnell, aber weicher abgestimmt
  - `map.stop()` nur noch bei sehr extremem Winkelsprung
  - Ziel: flüssiger in die kommende Gerade einpendeln statt ruckeliges Nachdrehen

## V2.0.114 - 2026-06-07
- **Kurvenrotation von "hart" auf "schnell + fluessig" umgestellt**:
  - Harte Bearing-Spruenge entfernt (weniger Ruckeln)
  - Kamera-Animation wird nicht mehr bei jedem Tick gestoppt, nur bei extremem Winkel
  - Schnelleres, weiches Einrasten auf die kommende Gerade nach dem Abbiegen
  - Ziel: deutlich fluessigeres Drehverhalten bei weiterhin hoher Reaktionsgeschwindigkeit

## V2.0.113 - 2026-06-07
- **Kurvenrotation nochmals stark beschleunigt**:
  - Bearing-Following deutlich aggressiver bei Richtungswechseln
  - Turn-Boost früher, länger und mit höherer Turn-Rate
  - Bei sehr großem Winkelfehler direkter Sprung auf Ziel-Bearing
  - Kamera-Dauer bei Kurven erneut reduziert für sofortigere Drehung

## V2.0.112 - 2026-06-07
- **Karte dreht schneller in Fahrtrichtung bei Abbiegen**:
  - Bearing-Catch-up in Kurven deutlich beschleunigt (höhere Turn-Rate + stärkere Annäherung)
  - Turn-Boost früher und länger aktiv
  - Kamera-Transitions bei Richtungswechseln merklich verkürzt
  - Ziel: schnellere, direktere Drehung beim Abbiegen

## V2.0.111 - 2026-06-07
- **Navi-Pfeil auf dunkleres Rot abgestimmt**:
  - Rotpalette deutlich dunkler gesetzt (Körper, Kern, Highlight)
  - Glow-Farbe auf den dunkleren Rotton angepasst
  - Ziel: kräftiger, weniger greller Pfeil auf heller Karte

## V2.0.110 - 2026-06-07
- **Navi-Pfeil komplett Rot**:
  - Pfeilkörper, Kern und Highlight vollständig auf Rottöne umgestellt
  - Weißanteile entfernt, Kontrast über dunklere Kontur und rote Abstufungen erhalten

## V2.0.109 - 2026-06-07
- **Navi-Pfeil Farbgebung umgekehrt**:
  - Hauptkörper jetzt Weiß mit roter Kontur
  - Pfeilkern jetzt Rot
  - Entspricht der gewünschten "andersrum" Rot/Weiß-Variante

## V2.0.108 - 2026-06-07
- **Navi-Pfeil auf Rot/Weiß umgestellt**:
  - Pfeilkörper von Blau auf Rot gewechselt
  - Kern/Outline auf Weiß für klare Lesbarkeit
  - Puls-Glow passend auf Rotton umgestellt

## V2.0.107 - 2026-06-07
- **Fahrzeugmarker auf Navi-Pfeil umgestellt**:
  - Bus-Symbol durch klaren Richtungs-Pfeil im Navi-Stil ersetzt
  - Eigene neutrale Vektorform (keine proprietäre 1:1-Grafik)
  - Heading-Offset auf Pfeil-Ausrichtung angepasst, damit die Spitze in Fahrtrichtung zeigt
  - Ziel: Richtung sofort erfassbar und stabiler als mit Bus-Form

## V2.0.106 - 2026-06-07
- **Bus-Ausrichtung in Fahrtrichtung korrigiert**:
  - Heading-Offset für Marker gesetzt, sodass die Bus-Front der tatsächlichen Fahrtrichtung folgt
  - Gilt konsistent für GPS und SIM
- **Seitliche Kippung reduziert**:
  - 3D-Neigung des Bus-Icons deutlich verringert, damit der Bus nicht "auf der Seite" wirkt

## V2.0.105 - 2026-06-07
- **Marker auf "Bus statt Kreis" umgestellt**:
  - Ring entfernt, nur noch Bus-Symbol als Fahrzeugmarker
  - Marker-Anchor explizit auf Zentrum gesetzt (GPS + SIM)
  - Ziel: Bus sitzt visuell zentral auf der Straße statt seitlich versetzt

## V2.0.104 - 2026-06-07
- **Bus-Marker drastisch vergrößert (300%)**:
  - Marker gegenüber V2.0.103 auf 300% skaliert
  - Ring und Bus-SVG proportional mit vergrößert
  - Ziel: maximale Sichtbarkeit während der Fahrt

## V2.0.103 - 2026-06-07
- **Bus-Marker +50% vergrößert**:
  - Marker-Fläche, Ring und Bus-SVG exakt um 50% skaliert
  - Ziel: deutlich bessere Sichtbarkeit auf dem Handy während der Fahrt

## V2.0.102 - 2026-06-07
- **Bus-Marker größer dargestellt**:
  - Marker-Größe auf der Karte erhöht für bessere Erkennbarkeit während der Fahrt
  - Ring und Bus-SVG proportional vergrößert, Positionierung beibehalten

## V2.0.101 - 2026-06-07
- **Bus-Marker Optik weiter verfeinert (weniger platt)**:
  - SVG-Form auf mehrschichtigen Bus mit Dach-, Seiten- und Schattenfläche umgestellt
  - Perspektivische Darstellung und stärkere Schattierung ergänzt
  - Ziel: deutlich räumlicherer Bus-Look auf der Karte

## V2.0.100 - 2026-06-07
- **Fahrzeugmarker Start-Sichtbarkeit + Bus-Optik**:
  - Marker in GPS und SIM auf gemeinsames SVG-Bus-Element umgestellt (klarere Bus-Form)
  - Marker-Ring ist ab erstem Frame sichtbar, statt nur über indirekte Pseudo-Elemente
  - Heading-Klasse wird bei fehlender Richtung wieder sauber entfernt, Rotation auf 0 gesetzt
  - Ziel: Fahrzeug beim Start der Linienführung stabil sichtbar und optisch eindeutig als Bus

## V2.0.99 - 2026-06-07
- **Feintuning Kurvenrotation (zusätzlicher Schritt)**:
  - Kurzzeitiger Turn-Boost nach erkannter Abbiegung eingeführt (schnelleres Nachführen der Kamera)
  - Bei sehr großem Richtungsfehler zusätzlicher schneller Catch-up-Schritt aktiviert
  - Ziel: Rest-„Seitwärtsfahren“ direkt nach Kurven weiter reduzieren

## V2.0.98 - 2026-06-07
- **Gegen-Fix bei seitlichem Nachziehen nach Abbiegen**:
  - Bearing-Regelung in Kurven deutlich reaktiver gemacht (höhere Turn-Rate und stärkere Annäherung bei großem Winkelfehler)
  - Niedriggeschwindigkeits-Ausreißerfilter präzisiert, damit echte langsame Abbiegungen nicht fälschlich geblockt werden
  - Ziel: schnelleres „Einfangen“ der neuen Fahrtrichtung direkt nach der Kurve

## V2.0.97 - 2026-06-07
- **Kurvenkamera beruhigt (Schritt 2)**:
  - Adaptive Kamera-Animation je nach Kurvenwinkel (stärkerer Turn = kürzere, direktere Transition)
  - Laufende Kamera-Animation wird vor dem nächsten Update beendet, um seitliches Nachziehen nach Abbiegen zu vermeiden
  - Zoom/Pitch/Padding im Fahrer-Modus werden geglättet statt sprunghaft gesetzt, für deutlich ruhigere Drehung

## V2.0.96 - 2026-06-07
- **Spur-Einrastung (Schritt 1, ohne Kamera-Änderung)**:
  - Snap-Radius erhöht (`85m` -> `120m`), damit die Fahrzeugposition seltener neben der Strecke liegt
  - Rejoin-Verhalten umgestellt: bei erneuter Routennähe sofortiges hartes Einrasten statt seitlichem Einblenden
  - Ziel: Marker bleibt sichtbar auf der Route, ohne das bisherige kameraseitige Verhalten mitzunehmen

## V2.0.95 - 2026-06-07
- **Robustere Manöver-Umschaltung (SIM + GPS)**:
  - Wechsel zur nächsten Richtungsänderung erst nach bestätigter Passage der aktuellen Kurve
  - Dynamischer Passage-Puffer: bei normalen Abständen späterer Wechsel, bei engen Doppelkurven schnellerer Wechsel
  - Ziel: kein zu frühes Umschalten vor der aktuellen Kurve, aber weiterhin Sichtbarkeit bei schnellen Folge-Manövern

## V2.0.94 - 2026-06-07
- **iPhone HUD Feinkorrektur**:
  - Navigationshinweise (Pfeil + Manövertext + Distanz) im Fahrbereich horizontal auf echte Bildschirmmitte korrigiert
  - Restliche HUD-Aufteilung unverändert belassen

## V2.0.93 - 2026-06-07
- **iPhone HUD Feintuning**:
  - `km/h` und `Fahrzeit` von der Mitte ganz nach links verschoben
  - Restliche HUD-Aufteilung unverändert belassen

## V2.0.92 - 2026-06-07
- **iPhone HUD Positionierung**:
  - `km/h` und `Fahrzeit` mittig unter der Zielkachel positioniert
  - Config/Stop-Buttons rechts separat belassen
  - Obere Zielkachel bleibt über die volle Breite
- **Richtungswechsel-Timing weiter beruhigt**:
  - Verzögerung nach Manöver erhöht (späterer Wechsel zur nächsten Anweisung)
  - Enge Doppelmanöver bleiben weiterhin sichtbar durch Nahbereich-Override

## V2.0.91 - 2026-06-07
- **HUD-Layout weiter vereinfacht (iPhone)**:
  - Obere Ziel-/Linienkachel jetzt über gesamte Breite
  - `km/h` und `Fahrzeit` im rechten Block weiter nach unten verschoben
  - Distanzzusatz in der oberen Kachel entfernt (nur Linie + Zielname)
  - Rechte Haltestellen-Sidebar bleibt deaktiviert (nur untere nächste Haltestelle sichtbar)
- **Abbiegungslogik verbessert**:
  - Nach einer Richtungsänderung wird die nächste Anweisung etwas später eingeblendet
  - Schutz für dicht aufeinanderfolgende Manöver bleibt aktiv (enge Doppelkurven weiterhin sichtbar)

## V2.0.90 - 2026-06-07
- **HUD vereinfacht und doppelte Haltestellenanzeige entfernt**:
  - Distanzangabe aus der oberen Linienkachel entfernt (kein `(in X.X Km)` mehr)
  - Rechte Sidebar mit "Nächste Haltestelle" deaktiviert (nur untere Haltestellenanzeige bleibt)
  - Unter der Geschwindigkeit wird jetzt die Fahrzeit angezeigt (`Fahrzeit mm:ss`)
  - Zeit/Speed-Block auf vertikale Darstellung angepasst (Speed oben, Fahrzeit darunter)

## V2.0.89 - 2026-06-07
- **iPhone HUD Lesbarkeit weiter verbessert**:
  - Rechte Nächste-Haltestelle weiter nach oben gesetzt
  - Stop-Karte rechts horizontal breiter statt vertikal höher gestaltet
  - Haltestellenname rechts auf eine Zeile mit Ellipsis optimiert
  - Fahranweisungstext (z. B. "Rechts abbiegen") deutlich vergrößert

## V2.0.88 - 2026-06-07
- **iPhone Lesbarkeit auf Distanz verbessert**:
  - Maneuver-Pfeil nochmals deutlich vergrößert (66px -> 78px)
  - Distanzanzeige unter dem Maneuver größer (30px -> 33px)
  - Rechte Nächste-Haltestelle größer dargestellt (Karte + Schrift)
  - Haltestellenname und Distanz rechts besser aus der Ferne lesbar

## V2.0.87 - 2026-06-07
- **iPhone HUD Feinschliff**:
  - Maneuver-Pfeil erneut deutlich vergrößert (52px -> 66px)
  - Distanzanzeige (`in XXX m`) weiter vergrößert (28px -> 30px)
  - Rechte Nächste-Haltestelle vertikal auf Höhe der Maneuver-Zeile verschoben
  - Stop-Karte rechts etwas kompakter für saubere Ausrichtung zur Fahrinfo

## V2.0.86 - 2026-06-07
- **Maneuver-Pfeile größer und mittig (iPhone)**:
  - Maneuver-Icon im iPhone-Layout deutlich vergrößert (38px -> 52px)
  - Fahrinfo-Zeile sauber zentriert über volle verfügbare Breite
  - Abbiege-Hinweistext leicht vergrößert und besser ausbalanciert
  - Distanzangabe größer (24px -> 28px) für bessere Erkennbarkeit

## V2.0.85 - 2026-06-07
- **Navigationspfeile auf standardisierte Maneuver-Symbole umgestellt**:
  - Statt generischer Font-Arrow jetzt konsistente Turn-by-Turn-Symbole (geradeaus, leicht, normal, scharf, Ziel)
  - Darstellung als SVG-Piktogramme im typischen Navi-Stil (klarere Lesbarkeit)
  - Einheitliches Verhalten auf iPhone-Layout und Desktop-HUD
- **Lizenzsicherheit**:
  - Verwendung eines offenen, frei nutzbaren Symbolansatzes (keine proprietären Navi-Assets kopiert)

## V2.0.84 - 2026-06-07
- **Fahrinfos zentriert und größer (iPhone)**:
  - Abbiegebereich jetzt mittig ausgerichtet statt linksbündig
  - Pfeil vergrößert (30px -> 38px)
  - Distanz vergrößert (18px -> 24px)
  - Hinweistext leicht vergrößert und zentriert
- **Rechter Bereich vereinfacht**:
  - Nur noch die nächste Haltestelle sichtbar
  - Zusätzliche Haltestellen-Karten auf iPhone ausgeblendet

## V2.0.83 - 2026-06-07
- **Obere Kacheln zusammengeführt** - Linie/Route und Ziel jetzt in einer einzigen Kachel:
  - Separate Zielkachel entfernt (Info in Linienkachel integriert)
  - Neues Format in der Hauptkachel: `Linie 1201/01 Technologiepark (in 17.3 Km)`
  - Linienkennung wird aus Linie + Route gebildet (z. B. `1201/01`)
  - HUD-Grid entsprechend vereinfacht und für iPhone-Layout angepasst

## V2.0.82 - 2026-06-07
- **iPhone HUD Cleanup (Portrait)** - deutlich aufgeraeumte Darstellung fuer kleine Displays:
  - Spezielles Layout fuer iPhone-Breite (<=430px) mit weniger visueller Last
  - Top-HUD neu gebuendelt: kompaktere Karten, weniger Zeilenumbrueche, klarere Hierarchie
  - Stadtzeile und Ziel-Label ausgeblendet, Fokus auf Linie, Zielname, Abbiegung und Distanz
  - Rechte Stop-Liste stark reduziert: schmaler, ohne Typ-Label, max. 3 Eintraege
  - Zeitanzeige oben rechts auf kleinen Displays ausgeblendet, Geschwindigkeit bleibt sichtbar

## V2.0.81 - 2026-06-07
- **Vollbild-Modus fürs Handy** - erster Aufräum-Schritt gegen überladene Ansicht:
  - Neuer Vollbild-Button (⛶) in der Topbar zum direkten Ein-/Ausschalten
  - Statusanzeige am Button wechselt zwischen Vollbild und Normalmodus
  - Automatische Erkennung von PWA-Standalone-Modus (Button wird dann ausgeblendet)
  - Fallback-Hinweis für Browser mit eingeschränktem Fullscreen-Support (z. B. iOS Safari)
  - Meta-Tag `mobile-web-app-capable` ergänzt

## V2.0.80 - 2026-06-07
- **Fix Fahrerposition im HUD** - Fahrzeug im Nav-Modus wieder im unteren Bildschirmbereich:
  - Kamerapadding in der Fahrersicht korrigiert (Top/Bottom-Logik neu ausbalanciert)
  - Fehlerursache beseitigt: harte Padding-Limits hatten die Position trotz Faktorwerten nach oben gedrückt
  - Geschwindigkeitsspezifische Fahrerposition jetzt stabil im unteren Bereich statt nahe Kopfzeile
  - Gilt fuer Live-GPS und SIM-Modus identisch

## V2.0.79 - 2026-06-07
- **Debug-Simulationsmodus in der App** - Navigation jetzt ohne reales GPS testbar:
  - Neuer SIM-Button in der App-Topbar startet/stopppt eine echte Nav-Simulation auf der geladenen Route
  - Simulation nutzt denselben HUD-Update-Pfad wie Live-GPS (Pfeile, Abbiegehinweise, Haltestellen, Distanzen)
  - Simulierte Fahrt laeuft entlang der Route mit stabiler Testgeschwindigkeit und automatischem Ziel-Ende
  - GPS wird waehrend Simulation blockiert, um Kollisionen zwischen Echt- und Sim-Daten zu vermeiden
- **Mobile HUD-Verbesserungen** - bessere Lesbarkeit auf dem Handy:
  - Neue Portrait-Optimierung fuer den Nav-HUD bis 900px Breite
  - Obere HUD-Zeile auf 2x2 Raster umgebaut (Linie/Ziel oben, Pfeil/Tempo unten)
  - Typografie jetzt viewport-skalierend mit clamp() fuer Linie, Ziel, Entfernung, Pfeil und Geschwindigkeit
  - Rechte Haltestellenliste auf mobile Breite angepasst fuer bessere Sichtbarkeit

## V2.0.78 - 2026-06-02
- **Enlarge Destination Box** – Make final destination more prominent and readable:
  - Increased Destination Box in top bar: fonts 10→11px (label), 12→16px (name), 12→14px (distance)
  - Padding enlarged: 10px 12px → 16px 14px for better spacing and tap targets
  - Border thickness: 1px → 1.5px for stronger visual definition
  - Border-radius: 8px → 10px for softer appearance
  - Removed destination from right-side upcoming stops list – now only shows next 4 stops
  - Destination now exclusively displayed in elegant orange box in top bar

## V2.0.77 - 2026-06-02
- **Add Destination Box to Top Bar** – Display final destination separately:
  - New elegant destination box next to line info with warm orange styling
  - Shows last stop name and total distance to destination
  - Top bar now 4 columns: Line (240px) | Destination (140px) | Arrow (1fr) | Time/Speed (130px)
  - Subtle orange gradient background with matching border for visual distinction
  - Destination distance dynamically calculated from route data

## V2.0.76 - 2026-06-02
- **Fix Stops List Readability** – Critical contrast fix for upcoming stops display:
  - Changed background from light transparent white to dark blue (rgba(15, 25, 60, 0.85))
  - White text now fully readable on dark background
  - Destination stops highlight with warm orange background (rgba(224, 140, 37, 0.25))
  - Blue borders on all stops for consistency with navigation theme

## V2.0.75 - 2026-06-02
- **Enhanced Line Info Styling** – Better contrast and complete text display:
  - Line info now has elegant blue gradient background (rgba(74, 158, 255, 0.15))
  - Full white text on blue background for superior readability
  - Removed text clipping - complete route description always visible
  - Increased top bar left column to 240px for full text accommodation
  - Subtle blue border around line info box for definition

## V2.0.74 - 2026-06-02
- **Improved Navigation HUD Readability** – Enhanced UI for quick at-a-glance information:
  - **Right Sidebar**: Expanded width (140px → 185px), larger fonts (11px → 13px)
  - **Upcoming Stops**: Better contrast with improved borders, 2px instead of 1px, hover effects
  - **Time/Speed Display**: Larger fonts (16px → 18-20px) for better visibility
  - **Buttons**: Increased size from 40px to 44px with thicker borders for easier tapping
  - Destination stops now have enhanced glow effect for visual prominence

## V2.0.73 - 2026-06-02
- **Enhanced Route Display** – Show complete route description in navigation HUD:
  - Extracts route name from `fileBase` (e.g., "Route 01 Cottbus Hauptbahnhof - Branitz Schloss")
  - Displays as "Linie X / Route Description" in top-left HUD
  - Supports special route info like diversions and notes
  - CSS: Improved line-clamp for long route names (max 2 lines with ellipsis)
  - Top bar grid expanded from 80px → 200px for line info column

## V2.0.72 - 2026-06-02
- **Major HUD Redesign: Centered Navigation Layout** – Complete restructuring of navigation interface for better readability:
  - **Top Bar**: New horizontal layout with 3 sections:
    - Left: Line information (e.g., "Linie 10" + "Cottbus")
    - Center: Large centered arrow + instruction + distance with "in" (e.g., "Rechts abbiegen in 200 m")
    - Right: Time display + speed + menu/end buttons (compact)
  - **Right Sidebar**: Upcoming stops now displayed vertically on the right side (scrollable) instead of bottom
  - **Bottom Bar**: Current/next stop information (unchanged location)
  - **Visual improvements**: Better use of screen space, more professional GPS app layout
- Result: Clearer hierarchy, easier to glance at critical info (arrow + instruction + distance), better stop visibility

## V2.0.71 - 2026-06-02
- **Feature: Comprehensive Navigation Menu (... button)** – New modal menu with tab-based interface during navigation. Includes:
  - **Pause/Resume & Cancel buttons** – Pause navigation while keeping it active, or cancel to end
  - **Route Info tab** – Displays total distance, distance traveled, remaining distance, and elapsed time
  - **Upcoming Stops tab** – Lists all stops on the route with distance to each
  - **Settings tab** – Future options for auto-zoom, sound notifications, screen-on settings
  - Modal opens from ... button in top-right of HUD, closes with X or by tapping overlay
  - Uses tab system for easy switching between info categories
- Result: Professional GPS app menu system with comprehensive route and stop information

## V2.0.70 - 2026-06-02
- **Fix: Restore Selection Interaction After HUD Redesign** – Z-index layering bug in V2.0.69 HUD prevented users from selecting cities and lines. Root cause: navHud grid overlay (z-index: 500) was covering selectionBar even when hidden. Solution: Added `#navHud.hidden { display: none; }` CSS rule and ensured pointer-events properly cascade. Now selectionBar is fully interactive when not in navigation mode. Service Worker cache version incremented to force refresh of cached assets.

## V2.0.69 - 2026-06-02
- **Major Redesign: Google Maps-Style Navigation HUD** – Complete restructuring of the navigation interface to match professional GPS apps like Google Maps. New layout:
  - **Top Center**: Large next-action display (arrow icon + street/instruction + distance to maneuver) - easier to read at a glance
  - **Top Right**: Clock and speed indicator (compact, monospace time display)
  - **Right Sidebar**: Vertical button stack (End Navigation + Menu) - no longer takes screen width
  - **Bottom**: Next stop info bar (station name + distance)
  - **Map**: Now full-screen minus HUD areas, better visibility of the route ahead
  - **Bonus**: Live clock updates every second during navigation
- Result: Professional appearance, better use of screen space, more information at a glance without UI clutter.

## V2.0.68 - 2026-06-02
- **Improve: Professional Navigation Icons** – Replaced unprofessional emoji arrows (⬆, ➡, ⬅, etc.) with clean Font Awesome vector icons. Icons are scalable, crisp, and match professional GPS navigation standards. Updated: arrow-up, arrow-right, arrow-left, arrow-up-right, arrow-up-left, flag-checkered (finish). Result: Modern, polished UI.
- **Cleanup: Remove Obsolete "Gespeicherte Offline-Routen" Section** – Deleted leftover UI from old local route storage system. With auto-download, this feature is no longer needed.

## V2.0.67 - 2026-06-02
- **Improve: Vehicle Position Lower on Screen** – Moved vehicle indicator to bottom third of screen (increased bottomFactor from 0.26-0.34 to 0.52-0.60). Driver now sees more of the route ahead, similar to professional GPS navigation apps. Better visibility and situational awareness.
- **Fix: GPS Smoothing Against Jitter** – Implemented exponential moving average (EMA, alpha=0.4) on raw GPS coordinates to eliminate jumping/stuttering movement. GPS noise is filtered out smoothly without reducing responsiveness. Result: Fluid, continuous movement instead of discrete jumps.

## V2.0.66 - 2026-06-01
- **Feature: Navigate to Route Start** – Added new button "📍 Zum Startpunkt" in route panel. When clicked, displays green dashed navigation line from current GPS position to the first point of the selected route. Shows blue marker for current position and orange marker for route start. Automatically fits map bounds to show both points. Displays distance to start point. Helps drivers quickly orient themselves and navigate to the beginning of their assigned route.

## V2.0.65 - 2026-06-01
- **Fix: Implement missing `downloadLineWithGPX()` function** – Auto-download was calling non-existent function, causing all 8 lines to fail. Implemented proper download logic: fetches line JSON from API via `/load_line.php`, stores in IndexedDB linesData, returns success/failure. Now auto-download completes successfully on app startup. Added missing HTML container for available lines display in Settings.

## V2.0.64 - 2026-06-01
- **Refactor: Replace "Route not saved" dialog with Available Lines display** – Removed confusing "Route noch nicht gespeichert" modal that told drivers to practice first. With auto-download, all 8 lines are ready on startup. Added new Settings section showing "✅ Verfügbare Offline-Linien" with visual list of all downloaded lines. Now when driver opens Settings, they see immediately which lines are cached and ready. Deleted: old offline-route-list code (~40 lines), clearAllOfflineRoutes function, showOfflineNotAvailableDialog logic. Result: Zero confusion, maximum transparency.
- **Refactor: Remove Simulation Mode** – Deleted all local simulation code ("Fahrt ▶" button, sim-speed settings, ~150 lines JS, ~50 lines CSS). With auto-download, drivers never need local practice—they select a line and immediately navigate with real GPS. Removed 3 modal buttons (now only "Navigate with GPS" remains). Result: Ultra-clean interface, one workflow, zero confusion.

## V2.0.62 - 2026-06-01
- **Refactor: Remove Download Center Modal** – Removed unnecessary download UI complexity. Auto-download now handles everything silently on startup. Deleted 116 lines of modal code, 150+ lines of CSS, and 8+ event handlers. Result: cleaner codebase, faster app. Drivers never touch download UI—lines are ready automatically when app starts.

## V2.0.61 - 2026-06-01
- **Fix: Auto-Download Now Actually Works!** – Auto-download was checking `linesCatalog` (metadata) instead of `linesData` (actual JSON files). Fixed to check the correct store. Now on app startup with empty cache, all 8 lines are correctly identified as "NEW" and downloaded in background. Progress indicator "⬇ Linien laden…" displays, all 8 lines download successfully (verified: 8/8 complete). Drivers get instant offline line availability without manual steps.

## V2.0.60 - 2026-06-01
- **Fix: Auto-Download Deduplication** – API returns duplicate lines when both new and old directory formats exist. Added automatic deduplication in `fetchAndCacheLinesCatalog()` to filter duplicate IDs before caching, ensuring exact line count matches available inventory. Fixes case where 13 lines displayed but only 8 were actually being downloaded due to ID collisions.

## V2.0.59 - 2026-06-01
- **Auto-Download Lines on Startup** – Lines are now automatically downloaded and cached when app starts, making all lines immediately available offline without user interaction. Driver opens app and all lines are ready to drive. Progress indicator ("⬇ Linien laden…") appears discretely in topbar during background downloads. 200ms delay between downloads prevents server overload.
- **Download Center Button** – Added permanent 📥 button in topbar for manual line management and selective downloads (backup/recovery use case).

## V2.0.55 - 2026-06-01
- **Offline Lines Download Center System** – Complete implementation in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/css/app.css](app/css/app.css):
  - **IndexedDB Schema Upgrade** (DB_VER 2): Added 4 new object stores (`linesCatalog`, `linesData`, `linesGPX`, plus existing `routes`), with 6 supporting database functions for complete offline lines persistence.
  - **Lines Catalog API Integration**: `fetchAndCacheLinesCatalog()` automatically fetches all available lines from `/api/list_lines.php` on app startup, stores metadata in IndexedDB, enabling offline-first downloads without network.
  - **Smart Update Notification Banner**: Top-of-screen alert (orange gradient, dismissible) appears when new lines detected, shows count of available updates, includes "Jetzt laden" button with persistent re-display on new line detection.
  - **Interactive Download Center Modal**: User-facing UI with:
    - Full list of available lines organized by city/route name
    - Real-time cached status indicator ("✓ Schon geladen") for previously downloaded lines
    - Checkboxes for selective download or "Select All" option
    - Live download progress bar showing X/Y lines loaded
    - Auto-saves complete JSON + GPX data per line to IndexedDB
  - **Auto-Fallback Cache Strategy**: Line loader (`loadAndShowRoute()`) now checks in priority order: (1) New `linesData` store for downloaded lines, (2) Old `routes` store for manually saved routes, (3) API fallback if not cached. Enables seamless offline use.
  - **Seamless Navigation Integration**: Auto-save on nav end now also writes to new `linesData` store, maintaining dual compatibility.
  - **Technical Details**:
    - Line IDs generated from city/lineFolder/fileName for consistent indexing
    - Download progress tracking with real-time UI feedback
    - Error handling for failed GPX downloads (JSON preserved)
    - CSS utility for banner with banner-aware layout offset (--banner-h variable)
    - LocalStorage version tracking for update detection

## V2.0.45 - 2026-06-01
- Enhanced road label coverage in [app/js/map.js](app/js/map.js): Expanded street name display filters for both online (OpenFreeMap) and PMTiles offline sources. Now shows all road types: motorway, trunk, primary, secondary, tertiary (main roads) PLUS residential, unclassified, living_street (small side streets). Drivers see complete street network for better navigation orientation.
- Enlarged bus marker from 52px to 68px in [app/css/app.css](app/css/app.css): Bus icon now 30% larger for better visibility on driver's screen, more prominent during navigation, easier to track on map.

## V2.0.44 - 2026-06-01
- Added 3D depth effect to bus marker in [app/css/app.css](app/css/app.css): Replaced flat gradient with multi-layered 5-color gradient (light-to-dark blue), inset box-shadows for internal structure (top/bottom/side highlights), and layered drop-shadows for realistic ground-level depth perception. Added subtle window details via overlay gradients and CSS perspective for 3D volume. Bus now appears as a rounded 3D object rather than a flat icon.

## V2.0.43 - 2026-06-01
- Simplified offline route warning dialog text in [app/index.html](app/index.html): Changed from technical jargon ("Offline-Inventar", "offline nutzen") to simple driver-friendly language ("Route kennst du noch nicht!", "musst sie erst fahren"). Button labels also simplified: "Zuhause Üben (kein GPS nötig)" and "Draußen fahren (mit GPS)" with clearer action verbs.

## V2.0.42 - 2026-06-01
- Enhanced offline route availability dialog in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): Now offers two immediate options in addition to "Später": (1) "🏠 Simulation (Zuhause)" starts a practice run at home without GPS, (2) "🚗 Echtes GPS (Draußen)" starts real GPS navigation on the road. Dialog text clarified to explain workflow: simulate at home to record + save, then use real GPS when driving.

## V2.0.41 - 2026-06-01
- Added offline route availability warning modal in [app/index.html](app/index.html) and [app/css/app.css](app/css/app.css); When user loads a route not yet in offline inventory, shows dialog with two options: "Jetzt abfahren & speichern" (start navigation immediately to record + auto-save) or "Später" (dismiss and view route info). Removes manual save button from UI since auto-save is now active.
- Updated [app/js/app.js](app/js/app.js) to detect offline availability and trigger modal display on route load.

## V2.0.40 - 2026-06-01
- Auto-save routes to offline storage when navigation ends in [app/js/app.js](app/js/app.js); Routes are now automatically saved after each completed navigation session, eliminating need for manual save button. Offline availability guaranteed without extra user action.

## V2.0.39 - 2026-06-01
- Added `.gps-dot` CSS class styling in [app/css/app.css](app/css/app.css): was missing, caused GPS marker to be invisible during navigation simulation. Now both real GPS and simulated GPS use the same 52px bus marker with proper styling.
- Ensures cache-busting forces full refresh of CSS on device.

## V2.0.38 - 2026-06-01
- Enlarged GPS bus marker in [app/css/app.css](app/css/app.css): increased from 34px to 52px for much better driver visibility with clearer colors and stronger shadow.
- Improved road label readability in [app/js/map.js](app/js/map.js): increased text size, switched to bold font, darkened color, and strengthened halo for better contrast on day map.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.37 - 2026-06-01
- Fixed map style filter error in [app/js/map.js](app/js/map.js): replaced invalid `in` expression in `road-name-main` with valid `any`/`==` checks for road classes.
- Resolves runtime error `layers[7].filter: Expected 2 arguments, but found 6 instead` and restores map rendering with street labels.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.36 - 2026-06-01
- Added subtle road names for main roads in [app/js/map.js](app/js/map.js) (`motorway`, `trunk`, `primary`, `secondary`, `tertiary`) with line placement and readable halo for driver use.
- Kept map focus clean: labels start at higher zoom and remain visually secondary to route and stops.
- Updated rollout revisions in [app/js/app.js](app/js/app.js), [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.35 - 2026-06-01
- Replaced the GPS point with a bus marker in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css), including heading-based rotation for a more realistic driving view.
- Updated service worker registration URL in [app/js/app.js](app/js/app.js) and rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.34 - 2026-06-01
- Updated map rendering in [app/js/map.js](app/js/map.js) to a clearer navigation-style day palette (higher contrast roads, lighter land/background, clearer water/buildings).
- Strengthened route visibility in [app/js/map.js](app/js/map.js) with a clearer casing and thicker main route line for faster driver recognition.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.33 - 2026-06-01
- Fixed map sprite 404 error in [app/js/map.js](app/js/map.js): removed unused `sprite`/`glyphs` style references from custom styles so MapLibre no longer requests missing OpenFreeMap sprite assets.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.32 - 2026-06-01
- Tuned driver camera in [app/js/map.js](app/js/map.js) to be closer to real navigation systems (less extreme pitch/zoom and reduced sky dominance).
- Changed default driver zoom in [app/index.html](app/index.html) from very close to a more practical level (`19 – Standard`).
- Improved update reliability in [app/js/app.js](app/js/app.js) and [app/sw.js](app/sw.js): service worker now forces fresh checks (`updateViaCache: none`), supports `SKIP_WAITING`, and reloads on controller switch.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.31 - 2026-06-01
- Reduced map clutter in [app/js/map.js](app/js/map.js): app now uses the minimal in-app style (`buildRasterStyle`) instead of the full Liberty style, removing unrelated map POIs/labels.
- Reduced PMTiles style clutter in [app/js/map.js](app/js/map.js): removed generic city/place labels so operational stop markers stay visually dominant.
- Tightened stop label focus in [app/js/map.js](app/js/map.js): during active navigation, only the nearest stop label remains visible on-map.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.30 - 2026-06-01
- Further stabilized driver camera bearing in [app/js/map.js](app/js/map.js) for real bus-seat behavior:
	- freeze bearing at standstill / very low speed,
	- require higher speed before trusting noisy device heading,
	- ignore large heading outliers at low speed,
	- cap per-tick rotation by time-based max turn rate.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.29 - 2026-06-01
- Added camera profile presets in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): `Standard`, `Extra Ruhig`, `Extra Dynamisch` (persisted locally).
- Improved low-speed camera stability in [app/js/map.js](app/js/map.js): stronger heading dead-zone and slower bearing interpolation to reduce wobble near stops.
- Added intelligent stop-label visibility in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css): labels auto-hide at low zoom and are limited to nearby POIs during navigation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.28 - 2026-05-31
- Added adaptive ultra-cockpit camera in [app/js/map.js](app/js/map.js): driver view now reacts to speed (slow approach / city / faster run) with different zoom, pitch, and forward framing.
- During low-speed stop approach, camera is intentionally less tilted for better readability and reduced motion stress.
- Navigation and simulation now pass speed data to camera updates in [app/js/app.js](app/js/app.js) for consistent profile switching.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.27 - 2026-05-31
- Tightened driver cockpit camera in [app/js/map.js](app/js/map.js): higher nav-mode zoom, stronger pitch, and more aggressive forward framing so the visible area is closer to the road ahead.
- Driver view now places the vehicle lower in frame during active navigation for a more realistic cockpit feel.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.26 - 2026-05-31
- Improved stop visibility on map in [app/js/map.js](app/js/map.js) and [app/css/app.css](app/css/app.css): stops are now rendered as POI markers with readable labels, not only plain dots.
- Improved navigation stop list in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css): HUD now shows destination stop plus the next 4 upcoming stops.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.25 - 2026-05-31
- Stabilized navigation camera heading in [app/js/map.js](app/js/map.js): reduced bearing jitter by smoothing heading updates and ignoring tiny oscillations.
- Added robust fallback in [app/js/map.js](app/js/map.js): if GPS heading is unavailable/unstable, camera direction follows movement course from recent GPS fixes.
- Camera bearing state is reset on GPS stop to avoid stale heading carry-over.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.24 - 2026-05-31
- Improved driver visibility in [app/js/map.js](app/js/map.js): active navigation now enforces forward-focused driver camera (no side-view mode switching while driving).
- Driver camera now uses stronger forward bias (higher pitch + dynamic bottom padding) so significantly more road ahead is visible.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.23 - 2026-05-31
- Improved driver focus layout in [app/css/app.css](app/css/app.css): during active navigation, non-essential UI (top bar, selection bar, panel) is hidden so the map and guidance remain central.
- Extended navigation HUD in [app/index.html](app/index.html) and [app/js/app.js](app/js/app.js): added dedicated in-HUD stop button and compact preview of the next three stops with distances.
- Navigation updates now render upcoming stop cards in [app/js/app.js](app/js/app.js) via safe DOM creation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.22 - 2026-05-31
- Fixed debug drive logging for simulation in [app/js/app.js](app/js/app.js): simulation now starts a recording session (`sim-start`) and writes samples on each simulation tick.
- This resolves empty exported logs when testing via `Fahrt ▶` without live GPS navigation.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.21 - 2026-05-31
- Added debug-only drive logger in [app/js/app.js](app/js/app.js): records raw GPS, snapped tracking point, route state (`ON/OFF/REJOIN`), snap distance, speed, heading, and nearest route index during navigation.
- Added debug HUD controls in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css): `REC`, `EXPORT`, `RESET` for field-session capture and JSON export.
- Recording starts automatically on navigation start and stops on nav/sim stop; export file includes thresholds and route metadata for post-analysis tuning.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.20 - 2026-05-31
- Tuned off-route/rejoin thresholds in [app/js/app.js](app/js/app.js) for a calmer Cottbus city profile:
	- `NAV_OFF_ROUTE_ENTER_M`: `130 -> 145`
	- `NAV_REJOIN_START_M`: `70 -> 78`
	- `NAV_REJOIN_BLEND_STEP`: `0.28 -> 0.20`
- Result: less OFF-route flicker in dense urban GPS drift, earlier but smoother rejoin back to route geometry.
- Updated rollout revisions in [app/index.html](app/index.html), [app/sw.js](app/sw.js), and [VERSION](VERSION).

## V2.0.19 - 2026-05-31
- Added off-route detection in [app/js/app.js](app/js/app.js): GPS is treated as off-route when deviation to route geometry exceeds a dedicated threshold.
- Added smooth rejoin flow in [app/js/app.js](app/js/app.js): when the vehicle approaches the route again, map position blends from raw GPS to snapped route position instead of jumping abruptly.
- Extended debug HUD in [app/js/app.js](app/js/app.js) with route state (`ON` / `OFF` / `REJOIN`) and current rejoin progress.
- Updated rollout cache revisions in [app/index.html](app/index.html) and [app/sw.js](app/sw.js) to ensure V2.0.19 assets are delivered.

## V2.0.18 - 2026-05-31
- Added route snapping for live navigation in [app/js/app.js](app/js/app.js): incoming GPS positions are projected onto nearby route segments (windowed map matching) and only applied when deviation is plausible.
- Reduced HUD work in simulation in [app/js/app.js](app/js/app.js) by reusing known route index (`step`) instead of nearest-point search on every tick.
- Extended debug HUD metrics in [app/js/app.js](app/js/app.js) with snap acceptance rate and latest snap distance.
- Updated cache-busting and service-worker shell revision in [app/index.html](app/index.html) and [app/sw.js](app/sw.js) for reliable rollout.

## V2.0.16 - 2026-05-31
- Added a hidden developer performance overlay for navigation HUD timing in [app/js/app.js](app/js/app.js) and [app/css/app.css](app/css/app.css).
- Overlay is strictly debug-only and remains invisible for drivers by default.
- Debug activation: `?debugHud=1` (URL-only, non-persistent), disable via `?debugHud=0`.

## V2.0.15 - 2026-05-31
- Improved DOM safety in [app/js/app.js](app/js/app.js): stop list and offline route list rendering now use explicit element creation with `textContent` instead of template-based `innerHTML` for dynamic values.
- Improved navigation runtime performance in [app/js/app.js](app/js/app.js): GPS HUD update now uses a hint-based nearest-point search window with global fallback only on edge hits, reducing per-tick computation on longer routes.

## V2.0.14 - 2026-05-31
- Improved runtime stability in [app/js/app.js](app/js/app.js): offline/online detection now uses a compatibility fallback when `AbortSignal.timeout` is unavailable.
- Prevents false offline state on browsers/devices with partial AbortSignal support.

## V2.0.13 - 2026-05-31
- Enforced strict write protection in [api/_auth.php](api/_auth.php): write APIs now require a configured server token (`LEHRFAHRER_API_TOKEN`) in all environments, including localhost.
- Removed localhost write bypass.
- Read endpoints remain open, so drivers can continue using the app without token for read/navigation only.

## V2.0.12 - 2026-05-31
- Fixed intermittent `withApiAuthHeaders is not defined` errors caused by mixed browser cache states.
- Added a defensive global API-token helper shim in [index.html](index.html) before local editor scripts load.
- Result: token actions and write-auth test remain functional even if script versions are temporarily mismatched in cache.

## V2.0.11 - 2026-05-31
- Added API token purpose tooltip in editor quickbar via [index.html](index.html), including a short explanation of write-protection scope and behavior.
- Added visual help icon styling for the tooltip in [editor.css](editor.css).

## V2.0.10 - 2026-05-31
- Fixed non-working "API-Token setzen" and "Neuen Ort anlegen" actions in environments where `prompt()` is unsupported.
- Added robust text-input fallback modal in [js/editor.main.js](js/editor.main.js) and input styling in [editor.css](editor.css).
- Result: server menu actions now open a working input dialog instead of silently failing.

## V2.0.9 - 2026-05-31
- Added visible API token status badge in editor quickbar via [index.html](index.html) (`API-Token: an/aus`).
- Added quickbar status styling in [editor.css](editor.css) for active/inactive token state.
- Added dynamic token status refresh in [js/editor.main.js](js/editor.main.js) on startup and after token set/clear actions.

## V2.0.8 - 2026-05-31
- Added editor-side API token management actions in [index.html](index.html) server menu:
	- Token setzen
	- Token testen
	- Token löschen
- Added token helper utilities in [js/editor.state.js](js/editor.state.js): `hasApiToken`, `setApiToken`, `clearApiToken`.
- Added token workflow functions in [js/editor.main.js](js/editor.main.js) including a write-auth probe against `create_city.php`.

## V2.0.7 - 2026-05-31
- Fixed editor city workflow regression by extending [api/list_cities.php](api/list_cities.php) with `includeEmpty=1` support.
- Updated [js/editor.main.js](js/editor.main.js) to request cities with `includeEmpty=1`, so newly created empty cities appear immediately in the editor.
- Added central write-auth guard in [api/_auth.php](api/_auth.php) and applied it to write/delete endpoints:
	[api/create_city.php](api/create_city.php), [api/save_line.php](api/save_line.php), [api/save_gpx.php](api/save_gpx.php), [api/delete_line.php](api/delete_line.php), [api/fetch_stops.php](api/fetch_stops.php), [api/save_catalog.php](api/save_catalog.php).
- Added optional `X-Api-Token` forwarding from editor requests via helper in [js/editor.state.js](js/editor.state.js), used by [js/editor.main.js](js/editor.main.js), [js/editor.api.js](js/editor.api.js), and [js/editor.fetchStops.js](js/editor.fetchStops.js).

## V2.0.6 - 2026-05-31
- Fixed root frontend path handling for localhost subfolder deployments in [index.html](index.html): script includes now use relative paths instead of absolute `/js` and `/data` paths.
- Fixed modular editor API calls in [js/editor.main.js](js/editor.main.js) and [js/editor.api.js](js/editor.api.js) to use relative `API_BASE` endpoints instead of absolute `/api/...`.
- Result: [http://localhost/lehrfahrer/](http://localhost/lehrfahrer/) now loads editor assets and city data correctly.

## V2.0.5 - 2026-05-31
- Fixed city listing in [api/list_cities.php](api/list_cities.php): technical folders like `backup`/`gpx` are excluded from the city selector.
- Added validation to return only cities that actually contain route JSON files (directly or in line subfolders).

## V2.0.4 - 2026-05-31
- Added one-click local startup script [start-local-apache.cmd](start-local-apache.cmd) for Apache/XAMPP.
- Script validates XAMPP path, creates the project junction in htdocs when missing, checks app availability, and opens the app URL.
- Added root [VERSION](VERSION) file for project version tracking.
