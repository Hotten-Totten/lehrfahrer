# Masterconfig und Gesellschafts-Provisioning

Die Masterconfig ist eine versionierte, serverseitige Systemvorlage. Sie ist
kein Datensatz in `companies`, besitzt keine Lizenz und kann sich weder anmelden
noch fachliche Daten halten. Version 1 liegt in
`api/_master_tenant_template.php`.

## Inhalt der Vorlage

Die Vorlage enthält ausschließlich:

- Template-Version,
- systemweite Standardrollen und Capabilities,
- neutrale Anzeige- und Betriebseinstellungen,
- Standard-Featureflags,
- die neun privaten Tenant-Bereiche.

Passwörter, Tokens, Secrets, Lizenznehmer- oder Bestandsdaten sind nicht Teil
der Vorlage. Die PHP-Datei erzeugt bei jedem Aufruf ein neues Array; das
Provisioning verändert die Vorlage nicht.

## Neue Gesellschaft

`lehrfahrer_create_company_from_template(PDO $pdo, array $input)` erwartet:

- `name`,
- `slug`,
- `license_status`,
- optional `license_id`,
- `admin_display_name`,
- `admin_login`,
- optional `admin_email`.

Der Service erzeugt innerhalb einer eigenen Datenbanktransaktion eine zufällige
`cmp_...`-ID, den Company-Datensatz, den ersten Admin, dessen ADMIN-Rolle, einen
Aktivierungsdatensatz, alle privaten Tenant-Verzeichnisse und die individuelle
`settings/company.json`. Doppelte Slugs werden abgewiesen. Schlägt ein Schritt
fehl, wird die Datenbanktransaktion zurückgerollt und ausschließlich der neu
angelegte, noch nicht bestätigte Tenant-Ordner bereinigt.

Rollen und Capabilities bleiben wie bisher systemweit normalisiert. Die
Masterconfig referenziert dieselben versionierten Definitionen; pro Gesellschaft
wird nur die Benutzer-Rollen-Zuordnung gespeichert.

Es gibt in dieser Phase bewusst keinen HTTP-Endpunkt und kein Admincockpit für
das Provisioning. Damit kann die Funktion noch keine Live-Gesellschaft
versehentlich über einen öffentlichen Request erzeugen.

## Erstadmin und Aktivierung

Der Admin startet deaktiviert und mit erzwungenem Passwortwechsel. Ein
kryptografisch zufälliger Aktivierungstoken wird einmalig vom Provisioning-
Service zurückgegeben. In `user_activation_tokens` liegen ausschließlich sein
SHA-256-Hash, die Zuordnung, Erzeugungszeit, Ablaufzeit und der optionale
Verwendungszeitpunkt. Der Token läuft nach 48 Stunden ab.

`lehrfahrer_activate_company_admin()` verbraucht den Token transaktional genau
einmal, setzt ausschließlich den Passwort-Hash und aktiviert den Admin. Ein
öffentlicher Aktivierungsdialog ist noch nicht Teil dieser Phase. Der
Klartexttoken darf nur einmal über einen vertrauenswürdigen Kanal ausgegeben
und niemals protokolliert oder dauerhaft gespeichert werden. Das Staging-CLI
aktiviert den Testadmin unmittelbar mit einem ausschließlich über die
Serverumgebung bereitgestellten Passwort und gibt weder Token noch Passwort aus.

## Tenant-Config und Updates

Die individuelle Config enthält Company-ID, Name, Slug, Lizenzdaten,
Erzeugungszeit, `version_created`, `version_current`, die zum Zeitpunkt der
Anlage kopierten Defaults sowie getrennte leere `overrides`-Objekte.

Künftige Template-Updates müssen `defaults` und `overrides` getrennt behandeln.
`version_current` bezeichnet dann die zuletzt bewusst angewandte
Default-Version. Kundenspezifische Overrides dürfen nicht durch einen neuen
Master-Default überschrieben werden. Ein automatisches Merge-System ist noch
nicht implementiert.

## Nullbestand

Beim Provisioning entstehen ausschließlich Verzeichnisse und
`settings/company.json`. Die Bereiche für Linien, Orte, Fahrer, Einweisungen,
Pakete, Dokumente, Kataloge und Importe bleiben leer. Es werden keine bestehenden
Fach- oder Live-Daten kopiert.
