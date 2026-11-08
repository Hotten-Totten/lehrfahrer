# Live-Sicherung, Erstaufbau und Übernahme

> Durch Nutzerentscheidung abgelöst: Der bisherige Live-Fachbestand soll nicht
> übernommen werden und darf für den Neustart entfernt werden. Maßgeblicher Plan:
> `production-clean-start-plan.md`. Die folgenden Übernahmeabschnitte bleiben nur
> als verworfener Entwurf erhalten; sie sind kein aktueller Ausführungsauftrag.

Stand: 08.11.2026. Entwurf auf Grundlage des tatsächlichen Live-Bestands.
Auftrag dieser Arbeit: planen. Keine Sicherung, Datenbankanlage, Übernahme oder
Produktionsumschaltung durch diesen Plan autorisiert oder ausgeführt.

Belegter Ausgangspunkt: `production-live-inventory-2026-11-08.md` und
https://github.com/Hotten-Totten/lehrfahrer/actions/runs/42522652192.
Live V2.1.063 verwendet den alten Schreibschutz; die neue Account-/Control-DB-
Infrastruktur ist dort nicht installiert. Vorhandene Dateikopien sind kein
bestätigter vollständiger Wiederherstellungspunkt. Eine anderweitig betriebene
Datenbank oder Provider-Sicherung ist weder bestätigt noch ausgeschlossen.

## Noch erforderliche Entscheidungen

| Entscheidung | Stand / Vorgabe |
| --- | --- |
| Fachliche Eigentümerschaft | Offen: Gehören alle bisherigen Live-Daten einer Firma? Bei mehreren Firmen braucht jeder Datensatz eine eindeutige Zuordnung |
| Erste Firma | Bestätigt: Cottbusverkehr GmbH. Im geschützten Erststart-Assistenten vorbelegen und bestätigen lassen; Slug, Lizenzstatus und gegebenenfalls Lizenzkennung noch festlegen |
| Erstadmin und SysOp | Bestätigt: Frank Fudeus übernimmt beide Aufgaben. Anmeldename und Passwort werden im geschützten Assistenten festgelegt; Vorschlag: ein Account mit Firmen-ADMIN-Mitgliedschaft und unabhängiger SysOp-Zuordnung, keine automatische Doppelanlage |
| Aktivierung | Sicheren Übergabeweg für Einmalaktivierung und MFA-Freigabecode festlegen; keine Passwörter im Chat oder Repository |
| Weitere Benutzer | Tatsächlich benötigte Anmeldekonten und Rollen benennen; keine automatische Kontoanlage aus Fahrer-/Personenstammdaten |
| Sicherung | Privaten Zielort, unabhängige zweite Kopie, ausreichenden Platz und berechtigten Betreiber bestätigen |
| Wartung | Zeitfenster, erreichbaren Verantwortlichen, spätesten Abbruchzeitpunkt und zulässige Ausfallzeit nach der Probe bestimmen |
| Umgang mit Altbeständen | Standardvorschlag: vollständig sichern und Originale behalten. Keine automatische Löschung, Zusammenführung oder Testdatenbereinigung |

Solange die restlichen Punkte offen sind, bleibt das Zielschema ein Plan.
Cottbusverkehr GmbH ist die bestätigte erste Firma; die Eigentümerschaft sämtlicher
Altdateien ist damit noch nicht pauschal bestätigt. Für mehrere Firmen darf
unklarer gemeinsamer Bestand nicht einem beliebigen Zielkonto zugewiesen werden.

## Geschützter Einrichtungsassistent beim ersten Start

Nutzerwunsch: Firma und verantwortliche Zugänge beim ersten Start eingeben bzw.
bestätigen können. Vorgaben: Cottbusverkehr GmbH; Firmenadmin Frank Fudeus;
Plattform-SysOp Frank Fudeus. Der Assistent ist hier geplant, noch nicht implementiert.

1. Der Betreiber bereitet die Installation administrativ vor und gibt eine einmalige,
   kurz gültige Einrichtungsfreigabe über einen vertrauenswürdigen Weg aus. Die
   öffentliche Startseite allein erlaubt keine Firma-/SysOp-Anlage. Leere Tabellen
   oder eine fehlende Konfiguration dürfen diese Freigabe nicht ersetzen.
2. Nach dieser Freigabe zeigt der Assistent die vorbelegten Firmendaten sowie
   getrennt Firmenadmin und Plattform-SysOp. Er macht sichtbar, dass Frank Fudeus
   beide Rollen übernehmen soll. Anmeldename, nötige Kontaktdaten und Passwort
   werden direkt dort festgelegt, niemals im Chat, in URLs oder in Logs.
3. Die Oberfläche bestätigt die Zuordnung des geprüften Altbestands zur Firma
   anhand des freigegebenen Übernahmemanifests. Es gibt keine pauschale Kopieraktion
   über unbekannte Ordner und keine Löschoption. Die Firmeneingabe allein startet
   weder Sicherung noch Datenübernahme oder Live-Umschaltung.
4. Ein gemeinsamer Account für Frank kann beide Rollen besitzen: Firmenrechte
   ausschließlich über die Mitgliedschaft, Plattformrechte über die gesonderte
   SysOp-Zuordnung. Keine weiteren Plattformrechte für normale Firmenadmins.
   Die bereits vorhandene SysOp-MFA-Pflicht gilt für diesen Account auch beim
   Firmenzugang; beide Rollen werden deshalb ausdrücklich bestätigt.
5. Konto-/Firmenanlage und Audit müssen atomar und gegen parallele Erstaufrufe
   geschützt sein. Ein Wiederaufruf setzt einen unvollständigen Vorgang kontrolliert
   fort oder stoppt; keine doppelten Accounts/Firmen oder zweite SysOp-Zuweisung.
6. Vor einer vollwertigen privilegierten Sitzung erfolgt die kontrollierte
   Passkey-Ersteinrichtung auf der endgültigen Domain. PENDING/ENROLL erhält
   keine vollständigen Plattformrechte. Zweiten unabhängigen Schlüssel und
   Wiederherstellungsweg anschließend prüfen.
7. Nach erfolgreicher Abnahme wird die Erststart-Freigabe dauerhaft verbraucht;
   der Assistent ist gesperrt. Passwort-/Passkey-Verlust, eine beschädigte DB oder
   gelöschte Dateien dürfen ihn nicht automatisch erneut öffentlich freischalten.

Technische Voraussetzungen und Bedrohungs-/Fehlertests dieses Assistenten sind
vor Umsetzung zu spezifizieren und zunächst isoliert sowie auf Staging abzunehmen.
Der vorhandene interne CLI-Provisioner darf dafür nicht ungeprüft als öffentlicher
Endpunkt freigegeben werden. Backup- und Übernahmefreigaben bleiben eigenständige
Schritte des folgenden Plans.

## 1. Vollständiges Inventar vor jeder Sicherung

Ein weiterer lesender Lauf erstellt ein privates Manifest über den tatsächlichen
öffentlichen und privaten Dateibestand. Pro Datei: relativer Pfad, Typ, Größe,
Zeitstempel, Rechte und SHA-256; zusätzlich Ordner, gegebenenfalls ACL und geprüfte
Symlink-/Mount-Grenzen. Das Manifest enthält sensible Dateinamen und bleibt privat.
Im normalen Prüfbericht stehen nur Summen, Gesamtgröße und feste Befundcodes.

Erfassen: vollständiger Code und ausgelieferte Assets, VERSION, .htaccess,
vorhandene Host-/PHP-Konfiguration, API-Geheimnisdatei und private Datenbereiche.
Bekannte Bereiche personnel, trainings und fahrerunterlagen einschließen; auch
bisher unbekannte Bereiche erfassen. Das derzeit nicht geprüfte Verzeichnis
`companies` explizit mit prüfen: Der neue Tenant-Speicher verwendet
`<private>/companies/<cmp_id>/`, nicht `<private>/tenants/`.

WorkingSystem, backup und backup_liniendaten separat als Alt-/Sicherungskopien
inventarisieren und erhalten. Sie sind ohne Freigabe weder Datenquelle der neuen
Firma noch Löschziel. Keine unbekannten Symlinks verfolgen; externe Speicherziele
erst zuordnen und separat sichern. Keine Dateien wegen ihres Namens als Testdaten
aussortieren. Unsynchronisierte Änderungen auf Geräten sind nicht Bestandteil der
Serversicherung; betroffene Anwender müssen sie vorher sichern oder kontrolliert
abschließen können.

Falls eine bestehende Datenbank oder eine andere Konfigurationsquelle auftaucht,
zunächst deren Identität und Umgebung bestätigen. Nicht neben einem unklaren
Bestand automatisch eine neue Control-DB anlegen.

Ergebnis: abgegrenzter Sicherungsumfang, Datenmenge/Platzbedarf, offene Zuordnungen
und Liste aller Schreiber. Ohne diese Grundlage keine belastbare Zeitplanung.

## 2. Konsistente Sicherung und unabhängige Kopie

1. Einen vorbereitenden Kopierlauf gegebenenfalls als ausdrücklich noch nicht
   konsistente Vorabkopie anlegen. Das ist noch kein freigegebener Rückweg.
2. Im vereinbarten Wartungsfenster Änderungen unterbinden und laufende Vorgänge
   auslaufen lassen. Der alte Live-Stand besitzt das neue Auth-Gate noch nicht:
   Deshalb muss der wirksame Schreibstopp bereits am bisherigen Server-/Zugangsweg
   greifen. Alle Web-Schreibzugriffe, direkten Schnittstellen, Import-/Zeitjobs
   und sonstigen Dateischreiber berücksichtigen; eine Wartungsanzeige allein reicht nicht.
3. Unter dieser Sperre den vollständigen Code-/Datei-/Konfigurationsstand sichern.
   Falls eine bestehende Datenbank bestätigt wurde: konsistenten vollständigen
   Dump einschließlich benötigter DB-Objekte erstellen. Gibt es nachweislich keine
   alte DB, diesen Befund festhalten; keine leere DB als vermeintliche Sicherung ausgeben.
4. Eine Sicherungs-ID bindet Dateimanifest, Archive, eventuellen Dump, Buildstand,
   Zeitfenster und Sperrnachweis zusammen. Quell-/Archiv-Prüfsummen vergleichen.
   Das Sicherungsziel liegt außerhalb der Quellwurzeln und des Webroots; keine
   Rekursion in das eigene Sicherungsarchiv und kein öffentlich erreichbarer Download.
5. Geschützte Kopie auf ein unabhängiges Speichermedium bzw. getrenntes Ziel
   übertragen und dort prüfen. Sensible Archive verschlüsseln; Schlüssel und
   erforderlichen Wiederherstellungszugang getrennt verfügbar halten.

Echte Produktionsarchive, Geheimnisdateien und personenbezogene Manifeste nicht
als GitHub-Artefakt, Support-ZIP, Repository-Datei oder Konsolenausgabe behandeln.
Die Restore-Probe muss auch versteckte Dateien und Rechte abdecken. Sicherungen
nicht entfernen, bevor neue Abnahme, unabhängige Kopie und Aufbewahrung geklärt sind.

## 3. Wiederherstellung zunächst auf getrenntem Ziel

Die gesicherte alte Anwendung zuerst in einer abgeschotteten Umgebung wiederherstellen.
Diese Probe darf wegen echter Produktionsdaten nicht im öffentlichen Staging oder
in allgemein zugänglichen CI-Artefakten stattfinden. Fremdzugriff und ausgehende
Integrationen sperren. Vor jeder Anwendungsausführung Live-DB-/Dienstverbindungen
unterbinden und die Test-Konfiguration gezielt abtrennen; die versiegelte
Originalsicherung unverändert lassen.

Dateiliste, Inhalte/Hashes, relative Pfade und Rechte mit dem Manifest vergleichen.
Gegebenenfalls leere isolierte DB aus dem Dump herstellen und Schema, Daten,
Beziehungen und notwendige DB-Objekte prüfen. Nicht in einen bestehenden Bestand
restaurieren. Die alte Oberfläche und repräsentative Routen/Exporte auf der Kopie
prüfen. Gemessene Dauer, benötigte Werkzeuge und Abweichungen protokollieren.

Erst diese erfolgreiche Probe macht den geplanten Rückweg belastbar. Aus ihrer
Dauer werden Wartungsfenster und Abbruchzeitpunkt abgeleitet, nicht geschätzt.

## 4. Neue Zielstruktur isoliert aufbauen

Aus einem festgehaltenen, getesteten Code-Commit eine getrennte Zielinstallation
aufbauen. Neue, ausdrücklich zugeordnete Control-DB mit Schema-/Umgebungsbindung,
privatem Speicher und kanonischem HTTPS-Origin vorbereiten. Kein Kopieren der
Staging-Datenbank, Staging-Accounts, Passkeys, Sitzungen oder Geschäfts-Testdaten.

Die bestätigte erste Firma aus der neutralen Mastervorlage erstellen. Ziel-
Company-ID und Account-IDs neu erzeugen und im Übernahmemanifest festhalten.
Erstadmin deaktiviert mit Einmalaktivierung anlegen; Rolle und Firmenmitgliedschaft
gezielt zuweisen. Eindeutigen SysOp separat zuordnen und Nummernregister prüfen.
Es gibt keinen Benutzerbestand, der allein durch das Vorhandensein von Fahrerdateien
als migriert gelten könnte. Identitäten nur aus ausdrücklich bestätigten Angaben anlegen.

Für diesen Erstaufbau fehlt noch ein eigener produktionsgeeigneter, isoliert
geprüfter Koordinator. Bestehende Account-Migration verlangt Staging und zwei
Altbenutzer/Firmen; SysOp-Bootstrap setzt konkrete Staging-Logins und Nummern voraus.
Diese Werkzeuge nicht durch umbenannte Umgebungen oder abgeschaltete Guards überlisten.

## 5. Übernahmemanifest und fachliche Zuordnung

Alle Zielpfade unten sind relativ zu `<private>/companies/<neue_cmp_id>/`.
Quellpfade müssen vor Umsetzung durch das vollständige Inventar bestätigt werden.

| Altbestand / Quelle | Vorgesehener Zielbereich | Erhalt und Prüfpunkt |
| --- | --- | --- |
| Produktive Linien unter public/linien/<ort>/... | lines/<ort>/... plus passende Ortsregistrierung | JSON, GPX und PDF zusammen erfassen; Linien-/Kategorie-/Ortsmetadaten und Dateibasis abgleichen |
| private/personnel/drivers.json | drivers/drivers.json | Personen und Kennungen bewahren; keine automatische Anlage von Anmeldekonten |
| private/trainings/... | trainings/... | Status, Abschlüsse, Zeitpunkte und Verweise erhalten; Nummern nicht neu bei 1 beginnen, wenn solche Kennungen übernommen werden |
| private/fahrerunterlagen/... | packages/... und documents/... nach tatsächlichem Format | Paketmetadaten und Dokumente getrennt zuordnen; bestehende Links/IDs auflösen, PDFs nicht stillschweigend neu erzeugen |
| Orts-/Betriebseinstellungen, zum Beispiel data/city_settings.json | settings/... | Tatsächliche Werte einschließlich gewünschter Telefonnummern erhalten; Vorlage darf sie nicht überschreiben |
| Kataloge, Haltestellenbezüge, Import-/GTFS-Dateien | catalogs/... und imports/... | Alle referenzierten Kennungen und tatsächlich verwendete Datenstände prüfen; keine unbeabsichtigte Datenaktualisierung während der Übernahme |
| WorkingSystem, Backups, sonstige Kopien | Separater erhaltener Archivbestand | Keine automatische Beimischung in produktive Linien/Personen |
| Unbekannte oder widersprüchliche Dateien | Entscheidung offen | Gesichert erhalten, Übernahme blockieren statt unbemerkt auslassen |

Das Manifest enthält für jedes Objekt Quellpfad/-Hash, Eigentümerfirma, Zielpfad,
Kennung und Entscheidung. Jede Format-/ID-Transformation wird ausdrücklich
protokolliert; unveränderte Dokumente müssen bytegleich bleiben. Kein Ziel darf
von zwei verschiedenen Quellen beschrieben werden. Bei kollidierenden Kennungen
oder widersprüchlichen Referenzen stoppen, nicht still umnummerieren oder zusammenführen.

Die bisherigen Cottbus-Skripte sind nur technische Referenz. Sie enthalten unter
anderem feste Ausschlüsse training_000001 bis training_000003, bestimmte Route-/
Personen-/Paketannahmen sowie Staging-Bereinigungen. Keine dieser Regeln ist eine
Freigabe zum Auslassen realer Live-Daten. Der neue Import muss alle tatsächlich
freigegebenen Orte und Objekte aus dem Manifest verarbeiten.

## 6. Isolierte Generalprobe und Abnahme

Auf der wiederhergestellten Kopie den neuen Erstaufbau und Import durchführen.
Quelle bleibt unverändert; erneuter Lauf erkennt denselben bereits übernommenen
Stand oder bricht eindeutig ab. Keine doppelten Accounts/Objekte oder Überschreibungen.

| Nachweis | Voraussetzung für Freigabe |
| --- | --- |
| Vollständigkeit | Jede Quelle ist übernommen, bewusst archiviert oder ausdrücklich entschieden; keine offenen MANUAL-/Fehlerfälle |
| Fachbeziehungen | Alle Linien-/Personen-/Einweisungs-/Paket-/Dokumentverweise auflösbar; Status, Zähler und Einstellungen erhalten |
| Inhalt | Anzahl/Hashes bzw. genehmigte Transformationen stimmen mit dem Manifest überein |
| Rechte | Richtige Firma, Rollen und Mitgliedschaften; fremde Kennungen, fehlendes CSRF und alte Token-Ausweichwege abgewiesen |
| Anmeldung/MFA | Admin-Aktivierung, kontrollierter SysOp-Erstzugang, erneute Passkey-Anmeldung und unabhängiger zweiter Schlüssel geprüft |
| Fehler/Rückweg | Audit-Ausfall und Abbruch hinterlassen keine Teilmutation/offenen Journale; Rückkehr zum geprüften Altstand demonstriert |
| Bedienung | Editor, Fahrer-App, Laden, Speichern, bestehende Dokumentdownloads und Firmen-/Offline-Grenzen geprüft |

Die isolierten automatisierten Tests und die geschützte Generalprobe mit dem
tatsächlichen Backup sind getrennte Nachweise. Persönliche Produktivdaten bleiben
aus gewöhnlichen Testfixtures heraus. Die praktische GPS-Abnahme bleibt ein eigener
offener Abnahmepunkt; ihre Erledigung wird nicht aus Unit-Tests abgeleitet.

## 7. Konkrete Live-Freigabe und Umschaltung

Erst nach erfolgreicher Generalprobe legt der Betreiber einen ausführbaren Plan
mit exakten Zielpfaden, Datenbankidentität, Release-Commit, Backup-ID, Manifest-Hash,
Firma/Accounts, Wartungsfenster und Rückweg zur ausdrücklichen Freigabe vor.

Nach dieser Freigabe: alten Schreibweg sperren, laufende Vorgänge beenden, frische
konsistente Sicherung erzeugen und vor Beginn Quelle gegen das freigegebene
Manifest prüfen. Bei Änderungen seit der Generalprobe neu bewerten und Probe
wiederholen, soweit die Änderungen sie betreffen. Zielaufbau und Import unter
geschlossener Sperre durchführen; keine parallel beschreibbaren Alt-/Neupfade.

Den neuen Code/konfigurierten Account-primary-Zugang erst gemeinsam mit geprüfter
DB und vollständig zugeordneten privaten Dateien aktivieren. Bestehende Alt-Tokens
und Sitzungen bleiben als Rückwegmaterial nur in der privaten Sicherung; der neue
Betrieb akzeptiert sie nicht. Offline wartende Alt-Anfragen dürfen nicht automatisch
unter einer beliebigen Firma abgearbeitet werden. Frische Anmeldung/Zuordnung prüfen.

Unter Wartung Admin, SysOp-MFA, Rechte, Audit, Geschäftsdaten und Downloads erneut
prüfen. Erst danach öffnen und Zeitpunkt/ersten neuen Schreibvorgang dokumentieren.
Keine bestehenden Fachobjekte als spontane Schreibtests verändern; vorgesehene
Abnahmeobjekte vorher benennen und ihren Umgang festlegen.

## 8. Rückweg und Abbruchregeln

Vor Öffnung bei unklarer Identität, fehlender Sicherung, Inhaltsabweichung,
offenen Importfällen, nicht funktionierendem MFA oder fehlerhaftem Audit abbrechen.
Sperre geschlossen lassen. Zusammenpassenden Alt-Code, Konfiguration und Dateien
sowie gegebenenfalls alte DB aus der geprüften Sicherung herstellen; neue Ziel-DB
und neue Firmenordner unangetastet isolieren statt pauschal löschen. Neu erzeugte
Credentials/Sitzungen dürfen im Rückweg keine Rechte behalten. Alten Zustand unter
Wartung prüfen und erst dann gezielt wieder freigeben. Kein bloßes Auth-Modus-Flag
oder Code-Rollback gegen eine andere Datenstruktur.

Nach Öffnung und neuen Geschäftsvorgängen gilt: keine blinde Rücksicherung über
neue Daten. Sofort Schreibstopp, neuen Stand separat sichern und gezielten Abgleich/
Rückweg mit dem Verantwortlichen abstimmen. Diese zweite Situation braucht einen
eigenen getesteten Ablauf und ist vor der Live-Freigabe zu berücksichtigen.

## Nächste ausführbare Arbeit

Nach Klärung der oben angefragten Firmen-/Accountzuordnung: einen rein lesenden,
vollständigen Manifest- und Platzbedarfscheck entwickeln und isoliert testen.
Danach die konkrete Backup-Erstellung samt abgeschotteter Wiederherstellungsprobe
vorbereiten. Die tatsächliche Erstellung privater Kopien und spätere Übernahme
sind eigene Schritte; dieser Entwurf startet keinen davon.
