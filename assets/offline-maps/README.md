# Offline-Karte Cottbus und Umgebung

`cottbus-20261101.pmtiles` ist ein regionaler Auszug aus [OpenFreeMap](https://openfreemap.org/) mit OpenMapTiles und Daten von [OpenStreetMap-Mitwirkenden](https://www.openstreetmap.org/copyright). Die Kartendaten stehen unter der Open Database License (ODbL). Die Originalattribution steht auch in den Kartenmetadaten.

- Quelle: https://btrfs.openfreemap.com/areas/planet/20261101_080013_pt/tiles.pmtiles
- Ausschnitt: 13.95,51.55,14.68,51.95, Zoom 0–14
- Erzeugt und geprüft mit go-pmtiles 1.31.2
- Dateigröße: 21.713.833 Bytes
- SHA-256: 5bf328113984348f5ce8614753c1dc6cae34434c25b2e485bc122262219648e0

## Zusatzkarte Nord

`cottbus-nord-20261101.pmtiles` verwendet denselben OpenFreeMap-Stand und dieselbe Zoomstufe. Der Ausschnitt liegt bei 13.95,51.91,14.68,52.31 und überlappt die Zentrumskarte am Nordrand.

- Dateigröße: 16.754.067 Bytes
- SHA-256: bd0ea65b9a81817208b7cd5c120dfe7a1b0c1f031332cbba6c04e31599da9cac

## Zusatzkarten Ost, Süd und West

Alle drei verwenden den gleichen Datenstand und dieselben Zoomstufen wie Zentrum und Nord.

| Region | Ausschnitt (West, Süd, Ost, Nord) | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Ost | 14.60,51.55,15.33,51.95 | 13.737.613 | 86b368af5073bc397b76ec0df5c6fb0aec52272096953c56d72457c42167f0cf |
| Süd | 13.95,51.19,14.68,51.59 | 20.714.605 | e1332f03b43dfa0d7a18f1a3590696151a8205b2b0cbae9b37d95967f3c19a4c |
| West | 13.30,51.55,14.03,51.95 | 17.007.290 | 884c5155066e7aa6a108d9fb483629e8c087ce1dde7aa80a73e0a26b3703188b |
