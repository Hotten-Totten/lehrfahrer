# Produktionsfähige Auth-/MFA-Spur – Staging-Abnahme

Stand 08.11.2026. Kein Produktionsdeploy, keine Änderung realer Accounts/Passkeys.
Die vorherigen Befunde in production-login-infrastructure-review.md beschreiben
den Ausgangsstand; die hier genannten Code-Lücken sind mit dieser Änderung bearbeitet.
Produktionsmigration, tatsächlicher Infrastrukturcheck und vollständiger
DB-/Datei-Restore-Nachweis bleiben gesonderte Releasevoraussetzungen.

## Konfiguration und Sitzungen

`api/_account_configuration.php` erhält Staging unverändert mit eigener RP-ID.
Produktion ist standardmäßig deaktiviert und verlangt gleichzeitig:

- LEHRFAHRER_ENV exakt production, LEHRFAHRER_ACCOUNT_LOGIN_ENABLED exakt 1.
- LEHRFAHRER_PUBLIC_ORIGIN als kanonischen HTTPS-Origin ohne Port und ohne
  Pfad/Query/Benutzerinformationen; keine Staging-Domain, IP oder localhost.
- LEHRFAHRER_PASSKEY_RP_ID exakt gleich dem geprüften Origin-Host.

Keine Ableitung aus Request-Headern. Ungültige Konfiguration öffnet keinen Zugang.
Der Cookie-Name __Host-lehrfahrer_account_test bleibt absichtlich erhalten, um
keinen zweiten, unkontrollierten Cookie-Übergang einzuführen. Die Hosts trennen
Staging und Produktion. Existing Secure/HttpOnly/SameSite=Strict bleibt bestehen.

Produktive Accounts werden nur mit expliziter Konfiguration aufgelöst. Im
ACCOUNT_PRIMARY-Modus werden alte Sitzungen und der Legacy-Token-Ausweichpfad
auch dann abgewiesen, wenn die neue Freischaltung wieder deaktiviert wurde.
Editor und alte Login-Seite führen bei freigegebener Account-Spur zum neuen Login.
Verifizierte Rollen/Mitgliedschaften und CSRF-Prüfungen bleiben serverseitig.
Neue Firmen können in freigegebenem produktivem ACCOUNT_PRIMARY ebenfalls den
bisher getesteten Account-/Aktivierungspfad nutzen; keine Bestandsmigration dadurch.

## Umstellungssperre

Das Auth-Mutation-Gate wird in production nicht mehr umgangen. Derselbe benannte
MariaDB-Lock schützt Anmeldung, Aktivierung und die bestehenden Auth-Mutationen.
Produktive Konfiguration verlangt explizite DB-Metadaten environment=production,
auth_mode und auth_cutover_lock. LOCKED sperrt Account-Auflösung und Auth-Mutationen.
Eine Produktionssperre kann nur im CLI-Kontext mit gültiger Konfiguration und
eindeutigem numerischem Vorgangseigentümer gesetzt/geöffnet werden. Auch
ACCOUNT_PRIMARY ist für MFA-Wartung erlaubt. Falscher Eigentümer öffnet nicht;
bei Fehlern bleibt die Sperre geschlossen. Kein Timer und keine automatische Öffnung.
Dies ist keine allgemeine Wartungssperre für sämtliche Fach-/Hintergrundschreiber.

## Kontrollierter Erstzugang und MFA-Recovery

Produktive SysOp-Anmeldung verlangt MFA auch ohne bisher vorhandenen Schlüssel.
Eine reine Passwortsitzung erhält keine SysOp-Rechte. Zur ersten Registrierung
wird zusätzlich ein zufälliger, kontogebundener Einmalcode benötigt. In der DB
steht nur dessen Hash mit zehn Minuten Gültigkeit. Er wird atomar beim Erstellen
genau einer ENROLL-Prüfung verbraucht; Replay, Ablauf oder fremdes Konto scheitern.
PENDING/ENROLL erhält keine volle Sitzung. Nach Registrierung muss erneut mit
Passwort plus signiertem Passkey angemeldet werden. Schlüsselverwaltung und alle
Sitzungswiderrufe verwenden jetzt die tatsächliche Umgebung bzw. deren RP-ID.

Administratives Werkzeug: `tools/production-mfa-maintenance.php`.
Es ist ausschließlich für den vorbereiteten, genehmigten Produktions-Wartungszugang:

- Expliziter Marker LEHRFAHRER_MFA_MAINTENANCE=APPROVED; erwarteter DB-Name über
  LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE. Direkte PDO-Verbindung ohne Schemaanlage.
- Aktionen über `--action=prepare`, `--action=recover` oder `--action=open`.
  Eigentümer `--owner` hat das Format Zahlen-Zahlen. prepare/recover benötigen
  `--account` als zuvor unabhängig bestätigte technische SysOp-Account-ID.
- `--restore-point` bezeichnet einen vorhandenen privaten DB-Restore-Punkt.
  Dump-Hash, Größe, verifiziertes Manifest, Schema sowie Server-/DB-Identität
  müssen zur laufenden Verbindung passen. Das ersetzt keinen vollständigen
  DB-/Datei-Restore-Drill; die vorhandene Backup-Erzeugung bleibt stagingbeschränkt.
- `--output` ist eine neue Datei innerhalb des bereits vorhandenen privaten
  Verzeichnisses. Exklusive Anlage und Modus 0600; kein Code in stdout oder Audit.
  Die Datei wird bei prepare/recover vor Datenbankänderungen reserviert.
- prepare verweigert bereits vorhandene produktive Passkeys. recover widerruft
  nur Passkeys des exakten SysOp für die produktive RP, dessen offene produktive
  MFA-Prüfungen und dessen produktive Sitzungen. Rollen, Nummern und fremde
  Accounts bleiben unverändert. Alle Änderungen plus Audit laufen atomar.
- Der Einmalcode wird über einen separaten vertrauenswürdigen Weg übergeben und
  im neuen Login-Feld eingegeben; nicht per URL, Browser-Speicher oder Log.
  Das Feld wird nach jedem Anmeldeversuch geleert. Die private Codedatei ist nach
  Verwendung vom Betreiber zu entfernen. Ein verlorener Code öffnet keinen Zugang.
- Nach prepare/recover bleibt LOCKED bestehen. Erst nach Prüfung/Übergabe des
  Codes öffnet der Betreiber mit derselben Owner-ID ausdrücklich. Bei Schreib-
  oder Auditfehlern wird nicht automatisch geöffnet. Der Ablauf setzt vorhandene
  aktive SysOp-Zuordnung und ACCOUNT_PRIMARY voraus, legt keinen SysOp an.

Neue kritische Auditaktionen AUTH_MFA_ENROLL_AUTHORIZE und AUTH_MFA_RECOVERY
enthalten SYSTEM als Betreiberkontext und die technische Ziel-Account-ID, keinen
Freigabecode. Deutsche Anzeigenamen sind im Aktivitäten-/Plattformprotokoll ergänzt.

## Prüfung

Lokaler Gesamtlauf: 761 Node-Tests, 752 bestanden, 9 übersprungen, keine Fehler.
Staging-MFA- und Audit-Writer-PHP-Suiten bestanden; PHP-Syntaxprüfungen bestanden.

- Produktionskonfiguration: deaktivierter Standard, explizite Umgebung,
  HTTPS/RP-Bindung und Abweisung falscher Konfiguration.
- Bestehende signierte MFA-Suite auch mit produktivem Origin und synthetischem
  SysOp: Erstregistrierung, Folgelogin, zweiter Schlüssel, Replays, Origin/RP,
  CSRF, Widerruf, Recovery, Einmalcode/Ablauf, fremde Accounts und Auditkette.
- Produktions-Recovery bei Audit-Ausfall rollt Schlüssel und Sitzungen zurück.
  Falscher Sperreneigentümer und gewöhnliches Firmenkonto werden abgewiesen.
- Dieselbe Suite auf separater lokaler MariaDB 10.4.32 bestanden, einschließlich
  zweitem gleichzeitigem Login-Prozess am benannten Cutover-Lock. Kein Login
  überschreitet die Sperrgrenze; keine Sitzung wird dabei angelegt.
- Der öffentliche synthetische Schlüssel in tools/fixtures/p256-leading-zero-test.pem
  prüft eine führende Null in einer P-256-Koordinate. COSE-Testfelder werden auf
  die vorgeschriebenen 32 Byte aufgefüllt; die Runtime-Prüfung bleibt unverändert.
  Dies ist ausschließlich Testmaterial, niemals ein Produktionsschlüssel.
- Reproduzierbare MariaDB-11.4-Prüfung in
  `.github/workflows/production-login-preflight-isolated.yml`, ohne Projekt-Secrets
  oder Deployment. Staging-Deploy führt Produktions- und Staging-MFA-Regressionen
  mit synthetischen lokalen Fixtures verpflichtend aus.

Eine echte Passkey-Bedienung auf der endgültigen Produktionsdomain und eine
reale Produktionsumstellung sind damit noch nicht freigegeben. Die praktische
GPS-Abnahme bleibt separat vorgemerkt.

## Abgeschlossene automatisierte Staging-Abnahme

Funktionsstand: c9b1d3306c7a779fd20d24070312b22b4f868c73.

- Isolierte MariaDB 11.4, Inventar und Produktions-MFA einschließlich Recovery,
  Audit-Rollback und konkurrierendem Login erfolgreich:
  https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42521368044
- Staging-Deployment mit PHP-/Node-Regressionen, HTTP-/Runtime-/Anmelde-/Session-
  und Account-primary-Prüfung erfolgreich; öffentlicher Live-Inhalt unverändert:
  https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42521368054
- Firmenanlage/Aktivierung in isolierter MariaDB nach der gemeinsamen
  Auth-/Provisioning-Anpassung erfolgreich:
  https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42520772711

Keine bestehenden SysOp-Passkeys zurückgesetzt, keine Produktiv-Freischaltung,
keine Produktionsdatenmigration. Offen bleiben tatsächliche Produktionsbindung,
Bestandsmigration und vollständiger Sicherungs-/Restore-Nachweis samt Freigabe.
