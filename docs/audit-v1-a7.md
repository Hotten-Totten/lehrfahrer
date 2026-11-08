# Audit V1 A7 – lesender Plattformzugang

## Autorisierung und Kontext

Eigene API `api/platform_audit_read.php` und Oberfläche `platform-audit.html`.
Jeder Seitenabruf prüft eine gültige Account-Sitzung und die aktuell zugewiesene
Capability `platform.audit.read`. Keine Legacy-/Token-Alternative, kein Vertrauen
in Benutzernummer, Anzeigename, Browserrollen oder mitgesendete Account-IDs.
Bestehende Ablauf-/Sperr-/Widerrufs-/MFA-Prüfungen gelten unverändert.

Der explizite Plattform-Lesekontext wird ausschließlich durch diese separate
API autorisiert; er ist kein vom Client auswählbarer Modus der A6-API.
Zugelassen: verifizierte PLATFORM-Sitzung oder eine verifizierte aktive TENANT-
Sitzung mit unabhängig vorhandener Plattformberechtigung (z. B. SysOp mit eigener
Firmenmitgliedschaft). TENANT allein, `audit.read` oder ADMIN reichen nicht aus.
PENDING und technische/fremde Kontexte sind ausgeschlossen. Der Besuch rotiert
keine Sitzung, ändert keine Firmenauswahl und erteilt keine Firmenrechte.
A6 bleibt strikt auf den eigenen Mandanten beschränkt; eine reine PLATFORM-
Sitzung erhält weiterhin keinen A6-/Editor-/Fachdatenzugriff.

Einstiege: Server → Verwaltung → Plattformprotokoll für entsprechend berechtigte
Accounts; außerdem auf der bestehenden Konto-Verwaltungsseite. Das Editor-Menü
öffnet die Plattformansicht separat, um den Editor-Arbeitsstand zu erhalten.
Reine Plattformkonten können auf der Kontoseite zum Protokoll gelangen, ohne eine
Firmenmitgliedschaft zu erfinden. Sichtbare Menüs ersetzen keine API-Autorisierung.

## Ausgabevertrag

Explizite SQL-Projektion: `event_id`, `occurred_at`, `context_type`, `company_id`,
`action`, `object_type`, `result`, `reason_code`. Keine Account-/Mitgliedschafts-/
Objektkennungen, Rollen-/Berechtigungssnapshots, IP-/Browserdaten, Hashwerte oder
globale Sequenznummern. Keine Namen, Notizen oder Fachdaten. Auch Konten-, Passkey-
und Sitzungsvorgänge liefern keine Zielkennungen. Protokoll- und Firmenkennungen
ermöglichen technische Zuordnung; der Umfang bleibt auf der Oberfläche erläutert.

Filter: UTC-Zeitraum, Katalogaktion, Ergebnis, Kontext (TENANT, PLATFORM, PREAUTH,
SYSTEM), optionale exakte Firmenkennung. Keine Suche nach ausgeblendeten Konto-
oder Objektkennungen, um deren Existenz nicht über Suchtreffer abfragbar zu machen.
Geschlossene Parameterauswahl, keine Arrays/SQL-Fragmente. Standard 25, maximal 50
Einträge; absteigende Keyset-Seiten über eine Protokoll-ID, die zum aktuellen
Filtersatz passen muss. Kein unbeschränkter Export oder globale Trefferzahl.

Nur GET, keine Änderungs-/Löschschnittstelle. `no-store, private`, `Vary: Cookie`.
Allgemeine 400/401/403/405/503-Antworten ohne Datenbankdetails. Keine neue Migration,
keine Änderung des Audit-Katalogs und keine Fachbestandsänderung. Die Leseansicht
behauptet keine vollständige Integritätsprüfung der Kette pro HTTP-Aufruf.

## Prüfungen und Status

Gezielt 53 Prüfungen bestanden, darunter 7 A7-API-/HTTP-Prüfungen. Geprüft:
firmenübergreifende bereinigte Projektion, alle Kontexte, Filter/Seiten/Cursor,
Firmenrechte ohne Plattformzugriff, separate Autorisierung aus gültiger
Firmensitzung bei unverändertem A6-Umfang, Rechteentzug, Pending, Kontosperre,
Sitzungswiderruf, echte SysOp-Zuweisung und bestehende MFA-Prüfung, Token-/Legacy-
Abwehr, Schreibmethoden und Ledger-Ausfall. Zusätzlich Menü-/Kontoeinstiege und
Regressionen für A6, Supportdiagnose und App-Cache. Lokale Browserprüfung mit
synthetischen Daten: Plattformkontexte, lesbare Darstellung und geschützte Details.

Vollständiger Node-Testsatz: 731 Tests, 720 bestanden, 9 übersprungen und nur die
beiden bekannten Fehler in `tools/navigation-off-route.test.js` (102/163).

## Staging-Abnahme am 08.11.2026

A7 ist fachlich und technisch abgenommen. Geprüfter Funktionsstand:
`61f23169ccba43d0aae82c4739b1ddb07f378b79`.

Gemeinsam praktisch geprüft: Einstieg mit dem berechtigten Plattformkonto,
25 Einträge auf der ersten Seite, bereinigte Details ohne Konto-/Mitgliedschafts-/
Objektkennungen, Kontextfilter „Anmeldeprüfung“ mit 12 passenden Einträgen,
Firmenfilter, kombinierter Firmen-/Kontextfilter mit leerem Ergebnis,
Seitennavigation bis zum Ende und Rückkehr zu den neuesten Einträgen.
Anschließend lädt das normale Firmen-Aktivitätenprotokoll weiterhin mit den
zugehörigen technischen Details der eigenen Firma. Die Firma wurde durch den
Plattformbesuch nicht gewechselt.

Deployment und Zugriffs-Nachprüfungen erfolgreich:
https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42498370539

Nachgewiesen: bestehender Account-/A6-Zugriff weiterhin erfolgreich;
Plattform-API ohne Anmeldung 401, für den gewöhnlichen Firmenadministrator 403,
Schreibanfrage 405; öffentlicher Live-Inhalt unverändert.

Abschließender rein lesender Servercheck auf separatem Diagnose-Branch,
ohne Deployment und mit READ ONLY-Datenbanktransaktion:
https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42499477039

Nachgewiesen: acht bereitgestellte A6-/A7-/Zugangsdateien stimmen per SHA-256
mit dem geprüften Git-Stand überein; SysOp-Account aktiv und Plattform-Auditrecht
vorhanden; reduzierte Plattformprojektion; gesamte Audit-Kette gültig; keine
offenen Dateijournale in den geprüften Mandantenverzeichnissen. Zusätzlich
bestehende A5-Abnahme geprüft: Testeinweisung archiviert und Linie abgeschlossen,
Testperson und Testpaket samt Artefakten entfernt, gewünschte Leitstellennummer
erhalten. Keine Fachbestandsänderung durch den Nachcheck.

Keine Live-Freigabe erteilt. A8 bleibt offen, einschließlich des Nachweises,
dass eine neue Firma mit einem leeren eigenen Fachbestand beginnt.
