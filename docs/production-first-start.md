# Geschützter Erststart

Der Betreiber bereitet eine leere, eindeutig zugeordnete MariaDB und ein neues
leeres privates Verzeichnis vor. `tools/first-start-prepare.php` ist der einzige
Vorbereitungsschritt mit Schemaanlage. Er läuft ausschließlich per CLI und setzt
die Freigabe in der geprüften Datenbank. Das Formular verwendet eine direkte
Verbindung zur vorbereiteten Datenbank.

Für den geplanten Wartungszugang werden die üblichen Produktionswerte für DB,
privaten Speicher, HTTPS-Origin und Passkey-Domain gesetzt. Zusätzlich braucht
der Erststart folgende Werte:

| Einstellung | Wert |
| --- | --- |
| LEHRFAHRER_FIRST_START_ENABLED | `1` während der Einrichtung |
| LEHRFAHRER_FIRST_START_DATABASE | Erwarteter Name der neuen Datenbank |
| LEHRFAHRER_FIRST_START_HASH | SHA-256 eines zufälligen URL-sicheren Codes aus 32 Bytes |
| LEHRFAHRER_FIRST_START_EXPIRES | Unix-Zeitpunkt höchstens eine Stunde in der Zukunft |
| LEHRFAHRER_FIRST_START_PREPARE | `1` ausschließlich im CLI-Prozess zur Vorbereitung |

Den Einrichtungscode getrennt und privat übergeben. Die Laufzeitkonfiguration
enthält seinen Hash. Nach der Vorbereitung ruft Frank `first-start.php` auf,
gibt den Code ein und bestätigt die Vorgaben Cottbusverkehr GmbH und Frank Fudeus.
Anmeldename und Passwort werden im Formular festgelegt. Die erste Firma erhält
den Lizenzstatus aktiv und leere Fachbereiche aus der neutralen Vorlage.

Die Anlage erfolgt unter der gemeinsamen Auth-Sperre in einer Transaktion mit
Audit. Ein Account erhält die Firmen-ADMIN-Mitgliedschaft und eine eigenständige
SysOp-Zuordnung mit reservierter Benutzernummer 00001. Ein Auditfehler rollt die
Datenbank zurück und bereinigt den ausschließlich für diesen Versuch erzeugten
Firmenordner. Ein vorhandener Firmenordner oder Altbestand blockiert den Start.

Nach Abschluss zeigt das Formular einmal den zehn Minuten gültigen Passkey-Code.
Frank gibt ihn bei der Account-Anmeldung zusätzlich zum Passwort ein und
registriert den ersten Schlüssel. Die Anmeldung erfolgt danach erneut mit
Passkey. Im Wartungsfenster folgt die Prüfung eines zweiten unabhängigen Schlüssels.
Bei Verlust des ersten Codes ist der bestehende administrative MFA-Rückweg zu
verwenden. Die Einrichtungsfreigabe wird nach Abschluss in der Datenbank verbraucht.
Anschließend werden die temporären Erststart-Einstellungen aus der Laufzeit entfernt.

## Prüfung

Der isolierte Test bereitet eine frische MariaDB vor und führt das Formular per
HTTP aus. Geprüft werden insbesondere falsche und abgelaufene Codes, fremder Origin,
Vorgaben erst nach Code-Eingabe, Audit-Rollback, leere Fachbereiche, Rollen,
Wiederholschutz und der auf Passkey-Einrichtung begrenzte Anmeldestatus. Die
reguläre Staging-Bereitstellung prüft den Code mit deaktivierter Erststart-Freigabe.
