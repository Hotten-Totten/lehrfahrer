# Phase 4D: Kataloge und Importe

**PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E.** Kein Bestandsimport,
keine Live-Umschaltung und keine Entfernung vorhandener öffentlicher Dateien.

Der Haltestellenkatalog liegt als `catalogs/haltestellen.json` im privaten
Gesellschaftsverzeichnis. Der Editor lädt ihn ausschließlich über
`api/load_catalog.php` mit Authentifizierung; `fetch_stops.php` und
`save_catalog.php` schreiben nur in denselben Tenant-Katalog. Beim Wechsel
des Legacy-Tokens wird der im Editor gehaltene Katalog geleert und neu geladen.

GTFS-Uploads werden nach Annahme durch PHP in
`imports/gtfs/sessions/{random-token}/` kopiert. Die serverseitige
`latest.zip`, Arbeitsdateien und SQLite-Indizes liegen unter
`imports/gtfs/` derselben Gesellschaft. Token, Sessiondateien und Indizes
werden über Phase-4A-Pfade geprüft; A und B besitzen getrennte Arbeits- und
Sperrdateien. PHP legt den anfänglichen Multipart-Upload vor Ausführung des
Skripts in seinem konfigurierten System-Tempverzeichnis ab und entfernt ihn
nach der Anfrage. Vor Phase 4E muss die Hosting-Konfiguration für diesen
kurzlebigen PHP-Tempbereich geprüft werden. SQLite kann bei großen Imports
zusätzlich interne temporäre Dateien nach Serverkonfiguration verwenden;
auch das ist vor Produktion zu verifizieren.

VBB erzeugt keine Serverdateien, sondern liefert eine Editor-Linie. Der
angeforderte Zielort muss im aktuellen Tenant existieren; dauerhaft speichern
kann anschließend nur der bereits tenantgebundene Phase-4B-Linienendpunkt.

Gesellschaftsspezifische Einstellungen: `settings/city_settings.json`
einschließlich Leitstellennummer ist bereits seit Phase 4B getrennt. Weitere
persistente betriebliche API-Einstellungen wurden nicht gefunden. Systemweit
bleiben technische Konfigurationen wie VBB-API-Basis/Zugang, öffentlicher
Origin, Control-Datenbank und privater Storage-Root. Browserseitige
Editor-/VBB-Präferenzen sind kein serverseitiger Fachdatenspeicher. Die
optionale PDF-Branding-Vorlage unter `assets/company` ist derzeit nicht
bestückt und wird in Phase 4D nicht als bestehende Mandanteneinstellung
interpretiert.

Alte Katalog-, GTFS- und Einstellungsdateien bleiben bis Phase 4E unverändert,
werden von den neuen Tenant-Endpunkten jedoch nicht als Fallback gelesen.
