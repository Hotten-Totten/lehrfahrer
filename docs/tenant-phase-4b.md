# Phase 4B: Tenant-Fachdaten (vorbereitend)

**PREPARATORY / NOT DEPLOYABLE UNTIL PHASE 4E**

Phase 4B liest und schreibt Städte, Linien, JSON, GPX, PDF und Stadteinstellungen
nur unter dem privaten Root `LEHRFAHRER_PRIVATE_DATA_DIR/companies/{company_id}/`:

- `cities/{city}/`: Existenz der Stadt
- `lines/{city}/{lineFolder}/{categoryFolder}/`: Routen-Dateien
- `settings/city_settings.json`: Einstellungen der eigenen Städte

Die `company_id` kommt ausschließlich aus der serverseitigen Session. Für
den bestehenden API-Token muss `LEHRFAHRER_LEGACY_COMPANY_ID` serverseitig auf
die aktive, festgelegte Startgesellschaft (`cmp_` + 32 Hex-Zeichen) gesetzt
werden. Ohne diese Konfiguration liefert der Linien-/Städte-Legacy-Zugriff
503; ein Request-Parameter oder die erste Gesellschaft in der Datenbank
werden niemals als Ersatz verwendet. Andere bestehende Legacy-APIs werden
in Phase 4B nicht umgestellt.

JSON und GPX werden über `download_line_json.php` und
`download_line_gpx.php`, PDF weiterhin über `download_line_pdf.php`
authentifiziert ausgeliefert. Editor-Downloads verwenden diese Endpunkte.
Die Fahrer-App kann Linien über `list_lines.php` und `load_line.php` laden;
der `jsonPath`-Fallback zeigt ebenfalls auf eine API, nicht auf eine
statische Tenant-Datei. Die Dateien selbst liegen außerhalb des Webroots.

`pdf/preview_v2.php` rendert nur eine feste Demo-Vorschau und liest keine
Linien- oder Stadtdaten; dort ist kein Tenant-Dateipfad umzustellen.

Es findet **keine Bestandsmigration** statt. Bestehende öffentliche
`linien/`-Dateien und `data/city_settings.json` bleiben unangetastet,
werden aber nicht als Tenant-Daten gelesen. Deshalb ist dieser Commit
allein **nicht deploybar**: Vor einer Produktivumschaltung muss Phase 4E
die Bestandsdaten einer explizit zugeordneten Startgesellschaft sicher
übernehmen, statische Altpfade sperren und die Live-Kompatibilität prüfen.
Bis dahin kein Deploy von Phase 4B–4D.
