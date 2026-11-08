# Sauberer Produktiv-Neustart

Nutzerentscheidung: Die bisherigen Live-Daten werden nicht übernommen. Sie dürfen
für den Neustart gelöscht werden; der Nutzer legt die fachlichen Daten neu an.
Dies ersetzt den bisherigen Übernahmeplan. Noch keine Löschung oder Live-Umstellung
ausgeführt; der Erststart-Assistent ist weiterhin geplant, nicht implementiert.

## Bestätigtes Ziel

- Erste Firma: Cottbusverkehr GmbH.
- Firmenadmin und Plattform-SysOp: Frank Fudeus.
- Anmeldename, Passwort und Passkeys werden im geschützten Erststart-Assistenten
  festgelegt. Keine Übernahme von Staging-Accounts, Sitzungen oder Passkeys.
- Neue Firma mit neutralen Rollen-/Systemgrunddaten und leeren Fachbereichen.
  Keine Übernahme bisheriger Linien, Personen, Einweisungen, Pakete, Dokumente
  oder individueller Betriebseinstellungen. Fachpersonen erzeugen keine Konten.

## Geplanter Ablauf

1. Den tatsächlichen Altbestand und die exakten betroffenen Pfade lesend erfassen.
   Vor Bereinigung eine vollständige private Sicherung mit Manifest/Prüfsummen
   erstellen und Wiederherstellung auf getrenntem Ziel prüfen. Die Sicherung ist
   Rückwegmaterial und wird nicht als Fachbestand der neuen Firma importiert.
2. Produktionsfähigen Erststart-Assistenten sowie Erstaufbau-Koordinator entwickeln.
   Einmalige administrative Freigabe, eindeutige Sperre gegen parallele Einrichtung,
   atomare Anlage mit Audit, kontrollierte MFA-Ersteinrichtung und dauerhafte
   Sperrung des abgeschlossenen Assistenten isoliert und auf Staging prüfen.
3. Konkrete Produktions-DB, privaten Speicher, Domain und Deployment zuordnen.
   Neue Zielstruktur getrennt vorbereiten; keine Staging-Datenbank kopieren.
4. Vor Ausführung einen konkreten Bereinigungs-/Umschaltplan mit exakten absoluten
   Quell-/Zielpfaden, bestätigter Sicherung, Wartungsfenster und Rückweg vorlegen.
   Die erteilte Zustimmung zur Entfernung alter Live-Fachdaten gilt; unklare oder
   außerhalb dieses Umfangs liegende Ziele werden nicht daraus abgeleitet.
5. Unter Wartung bisherigen Schreibweg sperren, letzte konsistente Sicherung
   erstellen, getesteten neuen Stand aktivieren und geschützte Ersteinrichtung
   ausführen. Alte Fachbereiche aus dem aktiven Betrieb entfernen; keine pauschale
   rekursive Löschung eines Webroots, privaten Gesamtspeichers oder Hostkontos.
6. Prüfen: Firma korrekt, nur gewünschte Accounts/Rollen vorhanden, Fachbereiche
   leer, Admin-/SysOp-Anmeldung und Passkeys funktionieren, alte Token-Zugänge
   abgewiesen, Audit gültig. Erst dann regulären Zugriff öffnen.

## Grenzen der Bereinigung

Die Löschzustimmung betrifft bisherige Live-Fachdaten für diesen Neustart. Sie
umfasst keine lokalen Projektdateien, Anhänge, Tests, andere Firmen/Staging,
Hostkonfiguration, Code, Systemvorlagen, Zugangsschlüssel oder Rückwegsicherungen.
Systemweite Referenz-/Importdaten müssen beim konkreten Inventar gesondert
klassifiziert werden. Unklare Datenbank-/Dateizuordnungen bleiben ein Abbruchgrund.

Die bestehende Live-Installation besitzt noch keine bestätigte Control-DB-
Zuordnung. Ein leeres Verzeichnis ist deshalb keine Freigabe für einen öffentlichen
Bootstrap; die Einrichtung erfordert die administrative Einmalfreigabe.

Der Rückweg stellt den zusammenpassenden alten Code-/Konfigurations-/Dateistand
und gegebenenfalls eine bestätigte alte DB wieder her. Nach Öffnung neu angelegte
Geschäftsdaten müssen vor jedem Rückweg separat gesichert und berücksichtigt
werden. Keine blinde Rücksicherung über neue Daten.

Nächster technischer Schritt: vollständigen lesenden Datei-/Platzbedarfscheck für
die Sicherung vorbereiten; anschließend Sicherung/Restore-Probe und Implementierung
des geschützten Erststarts. Die praktische GPS-Abnahme bleibt vorgemerkt.
