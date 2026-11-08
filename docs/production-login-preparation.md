# Vorbereitung der Produktiv-Anmeldung

Stand: 08.11.2026. Quellstand: staging, e4aa39c.
Status: Vorbereitung, NICHT zur Live-Ausführung freigegeben.
Auth-/MFA-Nacharbeit: siehe `production-auth-implementation.md` für die neue
explizite Konfiguration, Sperre, Einmalcode und administrative Recovery.
Keine Produktionsdatenbank und keine Produktionskonfiguration geprüft oder geändert.

## Ergebnis der Quellenprüfung

Vertiefte Infrastruktur-/MFA-/Sicherungsprüfung und konkrete Restlücken:
siehe `production-login-infrastructure-review.md`. Die lokale Quellen- und
Regressionstestprüfung bestätigt noch keine reale Produktionskonfiguration.

Ein unverändertes Übernehmen von Staging ist keine sichere Umstellung.
Die folgenden Sperren müssen gemeinsam bearbeitet werden; einzelne
Staging-Abfragen zu entfernen würde keinen vollständigen Produktivbetrieb ergeben.

| Bereich | Nachgewiesener Iststand | Erforderlicher Nachweis vor Live |
| --- | --- | --- |
| Einstieg/API | account-login.php und lehrfahrer_account_test_only() in api/_account_auth.php sperren Produktion; account_test.php, account_mfa.php und account_passkeys.php hängen daran | Explizit freigegebener Produktivmodus; deaktiviert/fehlkonfiguriert bleibt geschlossen; bestehende Staging-Spur bleibt getrennt |
| Sessionauflösung | api/_session_auth.php bindet ACCOUNT_PRIMARY an staging | Produktive Account-Auflösung, Rechte und Ausschluss alter Sitzungen gemeinsam prüfen |
| Schreibsperre | api/_auth_cutover_gate.php umgeht das Mutation-Gate in production und verbietet dort die Cutover-Sperre | Gemeinsame Sperre für Anmeldung, Aktivierung, Passwort-/Passkey-Änderung und Umstellung; keine konkurrierende Mutation |
| MFA | api/_sysop_mfa.php verlangt SysOp-MFA nur auf Staging; RP-ID und Origin sind staging.lehrfahrer.de | Produktiv-Domain explizit konfigurieren/validieren; SysOp-MFA vor Rechtefreigabe erzwingen; Passkeys am Produktiv-Origin neu registrieren |
| Migration | tools/control-account-migrate.php verlangt Staging-Metadaten und genau zwei Altbenutzer/zwei Firmen | Allgemeine lesende Bestandsprüfung und daraus abgeleitete Migration; keine Übernahme dieser festen Testannahmen |
| Cutover | tools/control-account-cutover-staging.php ist ausdrücklich staginggebunden | Eigener geprüfter Produktionsablauf mit Sicherungsbindung, Sperre, Wiederanlauf und Rückweg |
| Firmenanlage | api/_company_account_provisioning.php schließt production aus | Neue Firmen müssen nach dem Wechsel funktionsfähige Accounts/Mitgliedschaften erhalten; Aktivierung atomar auditieren |
| Bereitstellung | .github/workflows/deploy-strato.yml reagiert auf main-Push | Kein main-Push als Vorbereitung; Release erst mit verbindlichen Auth-/Migrationsprüfungen und ausdrücklicher Freigabe |

Die Cookiebezeichnung __Host-lehrfahrer_account_test ist ebenfalls Bestandteil
des Übergangsplans: Beibehalten oder gezielt ablösen, aber keine unbemerkte
Parallel-Anmeldung schaffen. Cookies bleiben Secure, HttpOnly und hostgebunden.

## Noch zu erhebender Produktionsbestand

Zunächst ein ausschließlich lesender, administrativer Preflight mit Ausgabe
fester Statuscodes und Summen, ohne Zugangsdaten oder personenbezogene Listen.
Er muss Umgebung, tatsächliche Domain/Origin, privaten Datenpfad, Datenbankbindung,
Schema/Migrationen und aktuellen Auth-Modus eindeutig zuordnen. Zusätzlich:

- Benutzer, Firmen, Rollen, bestehende Accounts/Mitgliedschaften und verwaiste
  Verknüpfungen zählen; globale normalisierte Login-Dubletten als Blocker melden.
  Identitäten niemals allein aufgrund gleicher E-Mail-Adressen zusammenführen.
- Passwort-Hashes, Aktivierungszustände, Sperren, offene Aktivierungen und gültige
  Sitzungen auf Migrationsfähigkeit prüfen. Keine Klartextpasswörter exportieren.
- SysOp-Zuordnung, produktive MFA-Einrichtung und kontrollierten Erstzugang klären.
  Staging-Schlüssel und Staging-Passkeys nicht als Produktionsnachweis verwenden.
- Audit-Speicherung, Wiederherstellbarkeit, private Sicherungsablage und
  Schreibschutz-/Wartungsmechanismus prüfen; kein Testschreiben im Live-Bestand.

Ein erster Identitäts-Bestandscheck ist jetzt unter
`tools/production-login-preflight.php` implementiert. Er verwendet eine eigene
Verbindung ohne automatische Schemaanlage, aktiviert Datenbank-Schreibschutz
und liest innerhalb einer anschließend zurückgerollten Transaktion. Er verlangt
Produktions-Metadaten sowie explizit PARALLEL/OPEN; teilweise belegte Zieltabellen
blockieren. Ausgabe nur als Summen und feste Befundcodes, ohne Betroffenenlisten.
`releaseReady` bleibt immer false. Noch kein vollständiger Infrastrukturcheck.

Der CLI-Einstieg verlangt PHP-CLI ohne HTTP-Kontext, LEHRFAHRER_ENV=production,
LEHRFAHRER_DB_DRIVER=mysql, LEHRFAHRER_PRODUCTION_PREFLIGHT=READ_ONLY und
LEHRFAHRER_PREFLIGHT_EXPECTED_DATABASE mit dem zuvor unabhängig geprüften
Datenbanknamen. Die tatsächliche SELECT DATABASE()-Antwort muss dazu passen.
Verbindungsdaten kommen aus der bestehenden privaten DB-Konfiguration; für den
späteren Betrieb ist ein dedizierter Nur-SELECT-Datenbankbenutzer vorzusehen.
Keine Zugangsdaten in Kommandozeilen, Berichte oder Versionsverwaltung schreiben.
Exit 0 bedeutet nur konfliktfreies Inventar; 1 blockiertes Inventar; 2 verweigerten
Ausführungskontext/Verbindungsfehler. Kein automatischer Start durch Deployment.

Isolierte lokale Prüfung: sieben neue Tests plus elf vorhandene Bestandsprüfungen
bestanden; PHP-Syntax und Diff-Prüfung bestanden. Vier synthetische Firmen statt
fester Zwei-Firmen-Annahme, Dubletten, falsche Umgebung, falscher Auth-Modus,
abweichendes Schema und teilbelegte Accounts geprüft. Datei-Hashes vor/nach dem
Check identisch und anschließende Schreibversuche über dieselbe Verbindung
abgewiesen. Diese erste Testreihe verwendet SQLite; die MariaDB-Transaktion und der vollständige
CLI-Verbindungsweg wurden anschließend separat abgenommen (siehe unten). Ein echter
Produktionslauf ist damit noch nicht freigegeben. Es wurde keine Live-Verbindung hergestellt.
Bestehende Staging-Werkzeuge nicht durch falsche Umgebungsvariablen überlisten.

## Geplanter Umstellungsablauf

1. Produktionsfähige Auth-Konfiguration, Gate, MFA, Firmenanlage und Werkzeuge
   zunächst isoliert implementieren. Fehlende/abweichende Konfiguration sperrt
   die Anmeldung; Rechte bleiben serverseitig an Account und Mitgliedschaft gebunden.
2. In einer frischen isolierten MariaDB mit synthetischen Daten Migration,
   Login, Firmenwechsel, SysOp-MFA und Fehler-/Rückweg prüfen. Mehr als zwei
   Benutzer/Firmen, Dubletten, deaktivierte Identitäten und teilweise migrierte
   Bestände einschließen. Anschließend bestehende Staging-Abnahmen wiederholen.
3. Nur lesenden Produktions-Preflight ausführen und seine tatsächlichen Befunde
   mit dem vorgesehenen Release, Wartungsfenster und Rückweg zur Freigabe vorlegen.
4. Nach ausdrücklicher Live-Freigabe: Schreibzugriffe kontrolliert sperren,
   laufende Vorgänge auslaufen lassen und konsistente Sicherung von Datenbank,
   privaten Dateien und bisherigem Code/Konfiguration erstellen. Wiederherstellung
   vorher in Isolation nachweisen. Preflight unter Sperre erneut ausführen.
5. Geprüfte Migration mit eindeutiger Altbenutzer-Zuordnung und Rollenprüfung
   ausführen. Alt-/Account-Sitzungen widerrufen, Auth-Modus und Code abgestimmt
   wechseln; keine automatisch wiederöffnende Zeitsperre verwenden.
6. Unter Wartung Produktiv-Anmeldung, SysOp-MFA, Rollen-/Mandantengrenzen,
   CSRF, Abmeldung, Audit und Fahrerzugang prüfen. Neuen Firmenzugang nur an
   ausdrücklich vorgesehenen Abnahmeobjekten prüfen. Erst dann öffnen.

## Abbruch und Rückweg

Bei unklarer Datenbankbindung, Dubletten, unvollständiger Migration, fehlendem
MFA-Erstzugang oder ungültiger Sicherung vor jeder Mutation abbrechen.
Bei Fehlern nach Beginn bleibt die Wartungssperre geschlossen. Kein isolierter
Wechsel zurück auf PARALLEL und kein reines Code-Rollback gegen migrierte Daten.
Code, Konfiguration, Datenbank und betroffene private Dateien nur als zueinander
passenden geprüften Stand wiederherstellen; Sitzungen widerrufen und Anmeldung
erneut abnehmen. Nach Wiederöffnung entstandene Geschäftsdaten dürfen durch
Rücksicherung nicht verloren gehen: dafür ist eine gesonderte Abstimmung nötig.

## Abnahmekriterien

- Korrekte Anmeldung für eine/mehrere Firmen; inaktive Konten, Mitgliedschaften
  und Firmen abgewiesen; unberechtigter Plattformzugang ausgeschlossen.
- SysOp ohne erfolgreiche produktive MFA erhält keine privilegierte Sitzung;
  fremder Origin/RP, Replay und widerrufene Passkeys werden abgewiesen.
- ACCOUNT_PRIMARY akzeptiert keine Alt-Sitzung oder Token-Ausweichanmeldung.
- Fehlendes CSRF, fremde Firmenkennungen und Audit-Ausfall erzeugen keine Mutation.
- Sperre verhindert Rennen zwischen Anmeldung, Aktivierung und Migration;
  Abbruch/Wiederanlauf erzeugt keine doppelten Accounts oder veränderten Rollen.
- Editor/Fahrer-App, Firmenanlage/Aktivierung und Offline-Mandantengrenze
  funktionieren; bestehende Fachbestände bleiben erhalten.
- Geprüfter Rückweg, benannter Verantwortlicher und ausdrückliche Live-Freigabe
  liegen vor. Die ergänzende praktische GPS-Abnahme bleibt separat vorgemerkt.

### Isolierte MariaDB-Abnahme

Am 08.11.2026 auf separater lokaler MariaDB 10.4.32 erfolgreich ausgeführt:
`tools/production-login-preflight-mariadb.test.php`. Neuer temporärer Datenpfad,
Loopback-Port 43379, leere Datenbank mit reserviertem Fixture-Namen; kein Zugriff
auf Staging/Live. Der Test erzwingt Isolationsmarker, Loopback, Fixture-Namensraum
und leeres Schema vor jeder Anlage. Das Testprogramm erzeugt synthetische Daten;
das eigentliche Prüfprogramm bleibt rein lesend.

- Vollständiger CLI-Aufruf mit echtem Nur-SELECT-Benutzer erfolgreich.
- Zusätzlich Schreibversuch mit privilegierter Verbindung nach dem Check in einer
  neuen Transaktion abgewiesen: der Datenbank-Schreibschutz bleibt aktiv.
- Sämtliche Tabelleninhalte vor/nach jedem Prüfaufruf per Fingerprint unverändert.
- Falscher erwarteter Datenbankname, falsche Umgebung, LOCKED-Zustand, globale
  Login-Dublette, teilbelegte Accounts und falsches Schema geschlossen abgewiesen.
- Bericht ohne Namen/Logins/Passwörter; releaseReady bleibt false.

Für reproduzierbare MariaDB-11.4-Abnahme liegt zusätzlich der ausschließlich
manuell auslösbare Workflow `production-login-preflight-isolated.yml` vor.
Er verwendet einen frischen Service ohne Deployment oder Projekt-Secrets.
Dieser Workflow wurde noch nicht auf GitHub ausgeführt; die tatsächliche lokale
MariaDB-Abnahme ist oben separat ausgewiesen. Der lokale Testserver wurde nach
der Prüfung beendet; synthetische Dateien verbleiben im temporären Verzeichnis.

Nächster Umsetzungsschritt: Ergänzung der Infrastruktur-/MFA-/Sicherungsnachweise.
Erst anschließend einen
konkreten lesenden Produktionslauf vorbereiten; dessen tatsächliche Befunde sind
Grundlage des Migrationsplans. Keine Produktionsfreigabe durch lokale Tests.
