# Offline-Karten (PMTiles)

Hier kommen die PMTiles-Dateien für die Offline-Kartennutzung rein.

## Was ist PMTiles?

PMTiles ist ein einzelnes kompaktes Dateiformat für Vektorkacheln.
Einmal heruntergeladen läuft die Karte komplett offline – nur GPS wird benötigt.

## Datei herunterladen

1. Gehe zu: https://maps.protomaps.com/builds/
2. Wähle deine Region (z.B. `germany.pmtiles` oder kleiner wie `thuringia.pmtiles`)
3. Lade die Datei herunter (Größen: Region ~300 MB, Deutschland ~2 GB)

## Datei einbinden

**Option A – über die App (empfohlen):**
Öffne die App → ⚙ Einstellungen → „PMTiles-Datei vom Gerät laden"
Die Datei wird dauerhaft im Browser-Speicher abgelegt.

**Option B – auf dem Server:**
Benenne die Datei in `region.pmtiles` um und lege sie in diesen Ordner.
Die App erkennt sie automatisch beim Start.

## Größenhinweis

| Region            | Größe ca. |
|-------------------|-----------|
| Brandenburg       | ~180 MB   |
| Berlin+Brandenburg| ~250 MB   |
| Deutschland       | ~2,0 GB   |

Die Datei wird einmalig per WLAN geladen – danach komplett offline nutzbar.
