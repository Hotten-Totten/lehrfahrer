# Live-Dateibestand und Sicherungsbedarf

Lesender Lauf am 08.11.2026 erfolgreich:
https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42523706437
Geprüfter Werkzeugstand: 5dee0ea. Live weiterhin V2.1.063.

| Bereich | Dateien | Bytes | Umfang |
| --- | ---: | ---: | --- |
| Öffentliche Anwendung und Daten | 3.610 | 634.980.288 | Code, Assets und aktive öffentliche Daten |
| Alte Kopien im öffentlichen Bestand | 3.426 | 865.491.057 | WorkingSystem und bekannte Backupbereiche |
| Privater Altbestand | 12 | 47.846 | Vollständig unter der bestätigten konventionellen privaten Wurzel gelesen |
| Gesamt | 7.048 | 1.500.519.191 | Rund 1,50 GB dezimal bzw. 1,40 GiB |

Beide Wurzeln vollständig durchlaufen: 1.491 öffentliche und 6 private
Verzeichnisse einschließlich der jeweiligen Wurzel. Keine unlesbaren Dateien,
Symlinks oder besonderen Dateitypen gefunden. Keine Änderung an den geprüften
Dateimetadaten während ihres jeweiligen Lesevorgangs erkannt. Der öffentliche
Scan dauerte rund 63 Sekunden. Die privaten Bereiche companies und control
existieren weiterhin nicht; keine Control-DB automatisch erzeugt oder verbunden.

Das Werkzeug behandelt Staging-Wurzeln ausdrücklich als ausgeschlossen. In
diesen beiden geprüften Live-Wurzeln wurden keine solchen Unterwurzeln angetroffen.
Individuelle Namen, relative Dateipfade und Inhalts-Hashes bleiben im Prozess-
speicher. Im CI-Bericht stehen nur Summen und zusammengefasste Manifest-Hashes:

- Öffentlich: 3413a745206254700b092d27fb79d079e80c25fd03abd4ad030fe079640e750b
- Privat: f9fe49f23ab5a5e984b8c6048f9f4f6b5cd054d0d0aab27006f8f0642b80736e

Es wurde noch kein dauerhaftes Einzeldatei-Manifest und kein Sicherungsarchiv
angelegt. Die Erfassung erfolgte im laufenden Betrieb ohne Schreibstopp und ist
deshalb ausdrücklich **keine konsistente Rückwegsicherung**. Auch das Fehlen
erkannter Einzeldateiänderungen beweist keine globale Momentaufnahme.

## Platz und Sicherungsziel

Eine zusätzliche unkomprimierte vollständige Kopie benötigt mindestens
1.500.519.191 Bytes zuzüglich Metadaten/Formatreserve. Zwei Kopien benötigen
zusammen mindestens 3.001.038.382 Bytes zuzüglich Reserve. Kompressionsgewinn
wird nicht vorausgesetzt; insbesondere Archive/Medien können wenig schrumpfen.
Eine Wiederherstellungsprobe braucht zusätzlich geeigneten getrennten Zielplatz.

Die vom Hoster gemeldete freie Dateisystemkapazität von rund 6,82 TB ist eine
gemeinsame Dateisystemangabe, kein bestätigtes Kontingent dieses Hosting-Vertrags.
Darauf wird keine Backup-Anlage oder Kapazitätsfreigabe gestützt. Provider-Quote,
unabhängiger Speicher und Schutz der Sicherungsdateien bleiben zu bestätigen.

Als separates lokales Ziel wurde dem Nutzer ein neuer Ordner
`K:\001 Projekte\Lehrfahrer-Backups` vorgeschlagen; seine Auswahl steht beim
Erstellen dieses Berichts noch aus. Der Ordner wurde nicht angelegt. Nach Auswahl
Kapazität und Zugriffs-/Verschlüsselungsschutz prüfen und den konkreten Kopierweg
ohne Klartext-Geheimnisse in Logs oder CI-Artefakten festlegen.

## Status und nächste Arbeit

Der bestätigte Nutzerwunsch ist ein leerer Produktiv-Neustart für Cottbusverkehr
GmbH mit Frank Fudeus als Firmenadmin und SysOp. Keine Alt-Datenübernahme.
Maßgeblicher Ablauf: `production-clean-start-plan.md`; der alte Übernahmeplan
ist dort und im ursprünglichen Dokument als abgelöst gekennzeichnet.

Sechs lokale Schutz-/Scannerprüfungen, PHP-Syntax und Diff-Prüfung bestanden.
Deployment-Job beim Live-Lauf übersprungen; öffentliche VERSION vor/nach identisch.
Keine Anwendungsdateien oder Geschäftsdaten auf Live geschrieben, keine Löschung,
keine Datenbankanlage, kein Start des Einrichtungsassistenten.

Nächste Arbeit: bestätigtes Backupziel prüfen und konkreten Sicherungs-/Wartungs-
und Restore-Ablauf vorbereiten. Erst die erfolgreiche Rückwegsicherung und
Wiederherstellungsprobe erlauben die spätere Bereinigung des Alt-Fachbestands.
