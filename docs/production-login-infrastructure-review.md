# Produktiv-Anmeldung: Infrastruktur, Erstzugang und Rückweg

Nacharbeit: Die hier beschriebenen Auth-/MFA-Code-Lücken werden durch
`production-auth-implementation.md` abgelöst. Die tatsächlichen Produktions-
Infrastruktur- und vollständigen Sicherungsnachweise bleiben offen.

Stand: 08.11.2026. Quellenprüfung am lokalen Staging-Stand e4aa39c einschließlich
der uncommitteten Preflight-Arbeit. Keine Produktionsverbindung, kein Deployment,
keine reale Sicherung oder Wiederherstellung ausgeführt. Dies ist keine Live-Freigabe.

## Infrastruktur

| Gegenstand | Quellenbefund | Noch erforderlicher Produktionsnachweis |
| --- | --- | --- |
| Origin/HTTPS | api/_runtime_info.php verlangt außerhalb dev einen expliziten HTTPS-Origin; Same-Origin-Prüfung in api/_session_auth.php vorhanden | Tatsächliche kanonische Domain, gültiges Zertifikat und Weiterleitungen prüfen; keine Host-Header-Ableitung für MFA |
| Cookies | Secure, HttpOnly, SameSite=Strict, Pfad / und __Host-Präfix vorhanden | Anmeldung/Abmeldung im tatsächlichen Browser auf der endgültigen Domain; keine kollidierende Alt-Anmeldung |
| Umgebung | Leere LEHRFAHRER_ENV wird als production interpretiert | Im freigegebenen Release explizite Produktionsbindung verlangen; nicht allein auf Default verlassen |
| Datenbank | Konfiguration kann TLS mit CA und Serverzertifikatsprüfung erzwingen | Tatsächlichen Server/DB-Namen und erforderlichen Transport feststellen; TLS-Konfiguration nicht bloß aus einem Flag als bewiesen ansehen; Nur-SELECT-Konto für Inventar, getrennte Betriebs-/Migrationsrechte |
| Privater Speicher | api/_private_storage.php prüft Pfade, erzeugt Verzeichnisse und setzt Rechte | Lesende Prüfung real aufgelöster Pfade außerhalb des Webroots, einschließlich Symlinks/Elternpfaden und tatsächlicher POSIX-Rechte; diesen schreibenden Helper nicht als Nur-Lese-Prüfung aufrufen |
| Deployment | main-Push löst deploy-strato.yml aus; Workflow enthält nach Übertragung auch Migration sensibler Altdateien | Bestehenden Workflow nicht als lesenden Infrastrukturcheck starten; Konfigurations-/DB-/Dateipfade und Wiederanlauf vor Release getrennt prüfen |
| Schreibstopp | Auth-Gate wird in production derzeit umgangen | Produktionsfähiges Gate plus Sperre aller betroffenen Fachschreiber und Hintergrundprozesse; geschlossene Dateijournale und keine laufenden Schreibvorgänge vor konsistenter Sicherung |

Die reale Produktionskonfiguration und ihre Berechtigungen sind NICHT bestätigt.
Private Konfigurationen/Passwörter werden nicht in diese Dokumentation kopiert.

## MFA-Erstzugang

Belegt durch api/_sysop_mfa.php und die isolierte Suite tools/sysop-mfa.test.php:
Richtiges Passwort öffnet zunächst nur ENROLL/PENDING. Erstregistrierung liefert
keine vollwertige Sitzung; anschließend ist Passwort plus signierter Passkey
nötig. Origin/RP, Challenge-Ablauf, Replay und fremde Credentials werden geprüft.
Weitere Schlüssel erfordern eine bereits MFA-geprüfte Sitzung; der letzte aktive
Schlüssel ist gegen normale Löschung geschützt. Die wirkliche SysOp-Zuordnung,
nicht allein Nummer 00001, bestimmt die Berechtigung.

Produktionsblocker:

- MFA-Pflicht, Origin, RP-ID und Anzeigename sind weiterhin staginggebunden.
- Bei Erstregistrierung widerruft der Code bestehende Sitzungen mit dem festen
  Umgebungswert staging. Eine bloße Freischaltung für production ließe diese
  Revocation unvollständig; Produktionsbindung muss gemeinsam angepasst werden.
- Wer ohne vorhandenen Passkey das SysOp-Passwort besitzt, kann im bisherigen
  Erstzugang eine Registrierung beginnen. Der produktive erste Schlüssel muss
  deshalb unter kontrolliertem, für andere gesperrtem Erstzugang registriert
  werden. Diese Sperre ist vor Öffnung nachzuweisen.
- tools/control-sysop-bootstrap-staging.php enthält eine konkrete Staging-Ziel-
  und Nummernzuordnung. Dies ist kein allgemeines Produktions-Bootstrap-Werkzeug.

Vorgesehene Abnahme nach Implementierung, zunächst isoliert:

1. Eindeutige aktive SysOp-Identität/Rolle und produktiven Origin feststellen;
   Verantwortlichen und autorisierten Wartungszugang benennen. Keine Übernahme
   eines Staging-Passkeys als gültigen Produktivschlüssel.
2. Während gesperrtem Erstzugang frischen Passkey auf der endgültigen Domain
   registrieren; beweisen, dass PENDING/ENROLL keine Plattformrechte hat und alle
   alten Ziel-Sitzungen der richtigen Umgebung widerrufen werden.
3. Erneut mit Passwort plus Passkey anmelden; danach zweiten unabhängig verfügbaren
   Schlüssel registrieren und beide getrennt testen. Ein zweiter Eintrag allein
   beweist keine unabhängige Wiederherstellungsmöglichkeit.
4. Abmeldung, Replay, fremden Origin/RP, widerrufenen Schlüssel und Zugriff ohne
   MFA abweisen. Erst nach bestätigtem Erstzugang die Wartungssperre öffnen.

Die bestehende docs/sysop-mfa-recovery.md gilt ausdrücklich nur für Staging.
Für Produktion muss ein überprüfter Betreiber im Wartungszugang die exakte
sysop_assignment-Zuordnung bestätigen, dann unter Sperre nur dessen Credentials,
offene MFA-Challenges und Sitzungen atomar widerrufen, Audit und übrige Accounts
prüfen und kontrolliert neu registrieren lassen. Keine Browser-Reset-URL, keine
automatische Entsperrung und kein pauschales Abschalten von MFA. Der ausführbare
Produktionsweg und die Rollen-/Audit-Abnahme dafür fehlen noch.

## Sicherung und Rückweg

Vorhandene Werkzeuge:

- tools/_control-db-restore-point.php erzeugt private Dumps mit Manifest,
  SHA-256, Größe, Schema und DB-Bindung; reguläre Ausführung ist stagingbeschränkt.
- tools/control-db-recovery-drill.php verlangt Staging und PARALLEL/OPEN;
  isolierter Restore und Fingerprints sind vorgesehen.
- tools/control-db-live-recovery.php heißt zwar live-recovery, erlaubt tatsächlich
  ausschließlich Staging. Nicht gegen Produktion einsetzen oder Schutz umgehen.
- Die ausgeführten Recovery-Regressionen belegen Guards/Quellstruktur; sie sind
  kein frisch ausgeführter vollständiger Dump-/Restore-Nachweis auf Produktion.

Ein freigegebener Wiederherstellungspunkt muss gemeinsam umfassen:

| Bestandteil | Zu prüfender Nachweis |
| --- | --- |
| Control-DB einschließlich Auth/Audit | Vollständiges Schema, Daten und benötigte DB-Objekte; tatsächlichen Dump-Umfang prüfen, nicht nur Tabellenliste; Import in leere isolierte DB und Inhalts-/Auditvergleich |
| Private Firmendaten | Alle betroffenen privaten Speicherbereiche, Dokumente und Journale; Inventar und Hashes, Rechte, Pfadbindung und Restore in getrenntem Verzeichnis |
| Code und Konfiguration | Exakter Git-/Buildstand, PHP-Erweiterungen, private Konfiguration/Schlüssel und Versionen; Geheimnisse privat gesichert, kein Upload als CI-Artefakt |
| Konsistenz | Gemeinsamer Zeitpunkt unter wirksamem Schreibstopp; DB-Transaktion allein synchronisiert keine Dateischreiber |
| Verfügbarkeit | Lesbare geschützte Kopie außerhalb des Deploy-Ziels, Platzbedarf, Berechtigungen, Verantwortlicher und Zugriff im Störungsfall |

Rückweg vor Öffnung: Sperre geschlossen lassen, Fehlerphase und Zeitpunkt
festhalten, zusammenpassenden Code-/Konfigurations-/DB-/Dateistand zurückholen,
Sitzungen widerrufen und Auth-/Rechte-/Audit-/Dateijournalprüfung wiederholen.
Kein alleiniger Wechsel auf PARALLEL gegen migrierte Daten. Nach Wiederöffnung
müssen neue Geschäftsdaten berücksichtigt werden; keine blinde Rücksicherung über
diese Daten. Eine maximale Wiederherstellungsdauer ist noch nicht praktisch gemessen.

## Aktuelle Prüfergebnisse und nächste Arbeit

- 20 Node-Tests für Recovery-Guards, SysOp-Bootstrap und Ergebnisvalidierung bestanden.
- PHP-MFA-Suite vollständig bestanden: Registrierung, erneute Anmeldung,
  Schlüsselverwaltung, Sperrfälle, Recovery-Simulation und Audit-Kette.
- Tests ausschließlich mit synthetischen lokalen Daten; keine Produktions-MFA,
  keine reale Produktionssicherung und kein aktueller vollständiger Restore-Drill.

Nächste technische Arbeit ist die gemeinsame produktionsfähige Umsetzung von
Auth-Gate, MFA-Konfiguration, umgebungsgebundenem Sitzungswiderruf und kontrolliertem
Erstzugang; anschließend isolierte Abnahme und eigener Produktions-Recovery-Weg.
Die bereits belegten Sicherheitslücken dürfen nicht durch einzelne entfernte
Staging-Abfragen übergangen werden. Vor echtem Live-Zugriff bleiben tatsächliche
Infrastruktur-/Sicherungsnachweise und ausdrückliche Releasefreigabe erforderlich.
Die praktische GPS-Abnahme bleibt unabhängig davon vorgemerkt.
