# Audit V1 A8 – Sicherheits- und Mandantenprüfung

## Prüfauftrag und Grenzen

Staging-only, keine bestehenden Routen/Mandanten löschen oder als Testbestand
verwenden. Keine Änderung der Navigation, der Homepage oder der vorgemerkten
Dialogaufgaben. Live bleibt gesperrt bis zu einer gesonderten Freigabe und
Produktivvorbereitung. Die geschützten unversionierten Dateien bleiben unverändert.

## Behobene Befunde

1. Der bisherige interne Firmen-Provisioner erstellte nur den alten Benutzer.
   Im ACCOUNT_PRIMARY-Betrieb fehlten Account, Mitgliedschaft und globale Nummer;
   Aktivierung führte daher nicht zu einer nutzbaren neuen Account-Anmeldung.
   Im expliziten ACCOUNT_PRIMARY-Modus außerhalb von Produktion erstellt der
   vertrauenswürdige CLI-Vorgang jetzt atomar den deaktivierten Erstadmin-Account,
   seine inaktive eigene Mitgliedschaft, die ADMIN-Rolle und seine fortlaufende
   globale Nummer. Bestehende Accounts werden bei Login-Dubletten nicht verknüpft.
   Es gibt weiterhin keinen öffentlichen Firmenanlage-Endpunkt.
2. Aktivierung setzt Benutzer, zugeordneten Account und Mitgliedschaft zusammen
   frei, verbraucht den geprüften Einmaltoken und schreibt die kritischen Ereignisse
   AUTH_ACCOUNT_ACTIVATE/AUTH_MEMBERSHIP_ACTIVATE in derselben Transaktion.
   Anlage und Aktivierung beachten das bestehende Auth-Cutover-Gate. Audit-Ausfälle
   rollen auch Nummernvergabe, Rollen, Aktivierung und Tokenverbrauch zurück.
   Ein unklarer Commit darf keine möglicherweise bestätigten Tenant-Dateien löschen;
   Bereinigung erfolgt nur nach festgestellter Abwesenheit des Company-Datensatzes.
3. Die Kategorienprüfung hatte einen fehlerhaften Regex-Delimiter. Ungültige Namen
   mit Slash/Backslash wurden mit PHP-Warnung angenommen. Gültige Kategorien bleiben
   erhalten; Pfadseparatoren, verbotene Steuerzeichen, Überlänge und ungültiges UTF-8
   werden nun gezielt abgewiesen. Das behebt auch die früher beobachtete PHP-Warnung.

Keine Schemaänderung, kein Bestands-Backfill und kein automatisches Provisioning
von Firmen auf dem Staging-Server. Der Produktions-Anmeldemodus wird durch diese
Änderung nicht freigeschaltet. Neue Aktivierungsaktionen ergänzen nur den
bestehenden geschlossenen Audit-Katalog; alte Hashformate bleiben unverändert.

## Nachweis: neue Firma mit leerem eigenen Fachbestand

`tools/a8-new-company.test.php` legt in einem neuen privaten Testverzeichnis erst
Firma A an und füllt deren Fachbereiche sowie eine alte Legacy-Quelle mit
synthetischen Fremddaten/Notizen. Anschließend wird Firma B wirklich über den
internen Provisioner angelegt und aktiviert. Nachgewiesen:

- B enthält initial ausschließlich die eigene `settings/company.json` und leere
  Fachverzeichnisse; keine fremden Personen, Routen, Einweisungen, Pakete, PDFs,
  Kataloge, Importe, Bemerkungen oder Leitstellennummern.
- Administrator-Account und eigene ADMIN-Mitgliedschaft sind vorhanden, zunächst
  gesperrt/inaktiv; Standardrollen und acht Standardkategorien bleiben verfügbar.
- Nach Einmalaktivierung ist die Account-Anmeldung im eigenen Tenant nutzbar,
  ohne Plattformrechte. Aktivierung und Anmeldung kopieren keine Fachdaten.
- Globale Accountnummern bleiben eindeutig und fortlaufend. Firmenbezogene
  Einweisungsnummern beginnen bei `training_000001`, auch wenn A bereits 000999 hat.
- Audit-Ausfall an allen drei Account-Anlageereignissen und beiden Aktivierungs-
  ereignissen, Token-Replay, globale Login-Dublette, Auth-Sperre und HTTP-Aufruf
  des internen Provisioners hinterlassen keinen halbfertigen Zustand.
- Eine Bereinigung eines bereits bestätigten Tenants entfernt keine Dateien.

`tools/a8-empty-company.test.js` prüft den echten neuen Tenant mit Account-Cookie
über einen lokalen HTTP-Server: leere Listen für Personen, Routen, Orte,
Einweisungen, Pakete und Haltestellenkatalog; nur die notwendige eigene Anmeldung
im Audit, keine fremden Fachereignisse. Fehlende Sitzung, gültiger Legacy-Token
bei Account-Schreibaktionen, CSRF/Origin, manipulierte Firmen-/Akteurangaben,
Fremd-IDs und fremde Downloads werden geprüft. Eigene erste Person/Route/Einweisung
werden angelegt. Ein Audit-Ausfall bei einer Änderung erhält die vorherigen Bytes,
verhindert die Mutation und hinterlässt keine offenen Journale. A bleibt unverändert.

Die MariaDB-Variante läuft ausschließlich gegen eine frische Datenbank mit
`lf_a8_*`-Namen in einem kurzlebigen GitHub-Servicecontainer und neuem privatem
Testverzeichnis. Sie verlangt einen expliziten Isolationsmarker und eine leere
Datenbank. Keine Staging-/Live-Datenbankdaten oder -Zugangsdaten werden dafür benutzt.

## Lokale Prüfergebnisse

- 57 gezielte Node-Regressionen bestanden (A8-Neuanlage/HTTP, A4/A5-Dateijournal,
  A6/A7-Zugriff, Aktivierung und Auth-Cutover-Rennen).
- Vollständiger Node-Testsatz: 736 Tests, 725 bestanden, 9 übersprungen und nur die
  beiden unten aufgeführten vorbestehenden Navigationsfehler.
- Acht PHP-Suiten bestanden: Audit-Writer, SysOp-MFA, Kategorien, GTFS-Kandidat,
  GTFS-Routenerstellung, Vorschau, Auswahl und Servicevergleich; Zip-Erweiterung aktiv.
- Isolierte Account-Neuanlage/Leerbestand/Fehlersimulation lokal erfolgreich;
  keine bestehenden Projekt-Testdateien verändert.

## Offene Releasepunkte

Die zwei bekannten Fehler in `tools/navigation-off-route.test.js` (Testanfänge
102/163) sind weiterhin reproduzierbar. Sie betreffen Raw-GPS auf einem späteren
Routenabschnitt bei veraltetem Index und die Rückkehr auf die Route nach drei
Fixes. Der aktuelle Code beurteilt bewusst den lokalen Routenkorridor ohne
globalen Sprung; die Tests erwarten in diesen Fällen eine andere Wiedererkennung.
Die Tests werden nicht entfernt oder als bestanden ausgegeben. Eine belastbare
Bewertung/Behebung gehört zur separat vorgemerkten Navigation/Umleitungsarbeit.

Vor Live ist außerdem die Produktions-Anmeldung gesondert vorzubereiten:
`account-login.php`/`account_test.php` und die Account-Auflösung sind derzeit bewusst
auf die Staging-/Testspur begrenzt, während auditierte Schreibfunktionen einen
Account verlangen. Ein unverändertes Deployen des Staging-Codes nach Produktion
ist daher keine freigegebene Releaseprozedur. Notwendig sind ein geprüfter
Account-/Migrations-/MFA-/Konfigurationsplan, Sicherung und Rückweg sowie die
anschließende ausdrückliche Nutzerfreigabe. Keine Produktionsumschaltung in A8.

## Staging-Status

Staging-Deployment, isolierte MariaDB-Prüfung und abschließender rein lesender
Bestands-/Integritätsnachcheck sind nach ihren tatsächlichen Ergebnissen hier zu
ergänzen. A8 ist bis dahin nicht abschließend abgenommen; kein grüner Live-Release.
