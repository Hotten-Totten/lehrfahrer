# Tatsächlicher Live-Bestand – lesender Nachweis

Stand: 08.11.2026. Erfolgreicher Nur-Lese-Lauf:
https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42522652192

## Ergebnis

| Bereich | Tatsächlich festgestellt |
| --- | --- |
| Domain/Ziel | lehrfahrer.de und www.lehrfahrer.de liefern denselben VERSION-Inhalt wie das über den bestehenden Produktions-Zielpfad geprüfte Serververzeichnis; SSH-Hostschlüssel gegen den bereits lokal bekannten Schlüssel fest gepinnt |
| Live-Version | V2.1.063; öffentliche VERSION vor/nach Prüfung unverändert |
| Prüfumgebung | PHP 8.1.34 CLI; dies belegt den verwendeten SSH-Interpreter, nicht die PHP-Version des Webservers |
| Neue Auth-Infrastruktur | index.php, api/_account_auth.php, api/_control_database.php, api/_session_auth.php, account-login.php, login.html sowie api/auth/login.php und runtime.php fehlen im geprüften Live-Ziel |
| Alter Schreibschutz | api/_auth.php und api/_secret.php vorhanden; Auth-Quelltext enthält API-Token-Leser und Schreibschutzfunktion. Geheimnisdatei nur auf Existenz geprüft, nicht ausgelesen |
| Laufzeitkonfiguration | Keine .user.ini und kein darüber zugeordnetes runtime-env; keine explizite production-/DB-Konfiguration im geprüften SSH-Prozess erkennbar |
| Privater Speicher | Zum bisherigen Deployment passendes Geschwisterverzeichnis lehrfahrer-private außerhalb des Webroots vorhanden, Modus 0700. Zuordnung beruht auf der dokumentierten Deployment-Konvention, nicht auf bestätigter neuer Account-Konfiguration |
| Private Bereiche | personnel, trainings und fahrerunterlagen vorhanden, jeweils 0700; control, tenants und backups nicht vorhanden |
| Identitätsdateien | An den fünf geprüften festen Kandidatenpfaden keine users.json, companies.json oder Control-SQLite-Datei gefunden |
| Bekannte Dateikopien | WorkingSystem vorhanden (31 Einträge auf oberster Ebene), backup leer, backup_liniendaten mit einem Eintrag; backups im öffentlichen Root nicht vorhanden |
| DB-Sicherungen | Kein privater Control-DB-Backupbereich bzw. dazugehöriger geprüfter Restore-Punkt gefunden |
| Vollständiger Rückweg | Nicht nachgewiesen. Die vorhandenen Dateikopien sind kein bestätigter vollständiger Datenbank-/Datei-Wiederherstellungspunkt. Provider-Snapshots wurden nicht geprüft |

## Konkrete Lücke

Der aktuelle Live-Stand besitzt nicht die neue Account-/Firmen-Infrastruktur,
die auf Staging entwickelt und abgenommen wurde. Eine eindeutig bestätigte
Produktions-Control-DB ist über die vorhandene Live-Konfiguration nicht zugeordnet.
Die Bestandsprüfung hat deshalb KEINE Datenbankverbindung hergestellt und keine
Schemaanlage/Migration versucht.

Benutzer, Firmen, Rollen und Login-Dubletten sind damit **nicht belastbar zählbar**.
Dies bedeutet ausdrücklich nicht null Benutzer oder einen leeren Geschäftsbestand:
private Fachverzeichnisse und alte Anwendungsdateien sind vorhanden. Es wurde auch
nicht behauptet, dass außerhalb der geprüften Pfade keine Datenbank oder Sicherung
existiert. Insbesondere kann ein separat administrierter Provider-Backupbestand
ohne entsprechenden Nachweis weder bestätigt noch ausgeschlossen werden.

## Konsequenz für den Releaseplan

Kein einfacher Wechsel eines Auth-Modus und keine unveränderte Übernahme der
Staging-Datenbank. Vor Live sind nun konkret erforderlich:

1. Vollständigen konsistenten Sicherungsumfang für diesen alten Dateibestand,
   Code und private Konfiguration festlegen; gegebenenfalls vorhandene Provider-
   Sicherungen zuordnen und den Restore auf einem getrennten Ziel praktisch prüfen.
2. Produktions-Control-DB und explizite Runtime-Konfiguration als neue Zielstruktur
   planen bzw. einen außerhalb des geprüften Systems vorhandenen Bestand zunächst
   eindeutig bestätigen. Keine automatische Erstellung im lesenden Preflight.
3. Gewünschte erste Firma, verantwortlichen Admin/SysOp und Zuordnung der bisher
   gemeinsam gespeicherten Routen/Personen/Einweisungen/Dokumente bestimmen.
   Bestehende Dateien nicht als leere Testfirma behandeln oder überschreiben.
4. Daraus einen isoliert geprobten Erstinitialisierungs-/Übernahmeplan erstellen;
   anschließend konkrete Live-Freigabe einholen. Reale Passkey-Einrichtung auf der
   endgültigen Domain und praktische GPS-Abnahme bleiben offen.

## Umfang und Schutz der Prüfung

Separater Workflow-Modus inspect_live_readonly=true; deploy-staging wurde
übersprungen. Keine Ausführung des Produktions-Deploy-Workflows, keine rsync-
Übertragung, keine Hilfsdatei auf dem Server, keine Anmelde-/Runtime-HTTP-Endpunkte.
Nur öffentliche statische VERSION-Abfragen, lesende Dateimetadaten/Quellprüfung
und sichere Zuordnungschecks. Das Prüfprogramm wurde über SSH im Speicher
ausgeführt und hat vorhandene Runtime-PHP-Dateien nicht eingebunden.
Bericht nur mit Summen, Präsenzmerkmalen und Hashes, ohne Namen, Zugangsdaten,
Tokens oder absolute private Serverpfade. Vier isolierte lokale Schutztests sowie
PHP-Syntax-/Diff-Prüfung bestanden. Die anfänglichen Aufrufprobleme betrafen nur
den CGI-/CLI-Eingabeweg; der oben verlinkte abschließende Lauf ist erfolgreich.
