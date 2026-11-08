# Support-Diagnose (Staging)

Die Diagnose ist im Editor unter Hilfe, in der Fahrer-App unter Einstellungen,
auf der Aktivitätenprotokoll-Seite und auf beiden Anmeldeseiten erreichbar.
Sie bereitet lokal ein ZIP mit `HINWEISE.txt` und `diagnose.json` vor. Der
JSON-Inhalt wird vollständig vor dem Download angezeigt und für diesen Download
eingefroren. Kein Upload, kein automatischer E-Mail-Versand, kein Supportkonto
und keine neue Berechtigung oder serverseitige Lese-/Schreibschnittstelle.

Erfasst werden maximal 200 technische Hinweise im aktuellen Browser-Tab:
Seitenbereich, UTC-Zeit, bekannte API-Endpunkte ohne URL-Parameter, HTTP-Methode,
Status und Dauer, Netzwerk-/JSON-/Anwendungsfehler (`ok=false`), JavaScript-
Fehlertyp und nach Möglichkeit bekannte Quelldatei/Zeile, Konsolen-Warn-/Fehler-
Hinweise ohne Freitext sowie Online-/Offline-Wechsel. Erfolgreiche externe
Karten-/Bibliotheksabrufe werden nicht gesammelt, damit sie die Hinweise nicht
verdrängen. Warnungen und Fehler verändern die ursprünglichen Rückgabewerte
oder Ausnahmen nicht. JSON wird nur bei einem Aufruf durch die Anwendung und
ohne Kopie des Antwortinhalts auf das Erfolgsflag geprüft.

Keine Passwörter, Cookies, Token, Request-/Response-Inhalte, Formularwerte,
DOM-/Konsolen-Freitexte, Namen, Bemerkungen, Routen, Koordinaten oder vollständigen
URLs. Dateinamen und API-Endpunkte stammen aus geschlossenen Listen. Unbekannte
Quellen werden ausgelassen; fremde Dienste erscheinen nur als `external`.
Auch aus dem Browserspeicher geladene Hinweise durchlaufen dieselbe Positivliste.

Der bereinigte Verlauf liegt im Session-Speicher des Tabs; bei gesperrtem Speicher
nur im Arbeitsspeicher. Er übersteht normale Seitenwechsel/Neuladen, ist über
„Lokalen Verlauf leeren“ löschbar und wird normalerweise mit Schließen des Tabs
verworfen (Browser können Sitzungen wiederherstellen). Er enthält keine Account-
oder Mandantenidentität und wird nicht zwischen Benutzern/Tabs serverseitig geteilt.
Die Version wird erst beim Öffnen über die vorhandene Runtime-API abgefragt,
mit Zeitbegrenzung und strenger Feldauswahl. Bei Ausfall bleibt der lokale Download
verfügbar. Browserfamilie und Hauptversion statt vollständigem User-Agent.

Grenzen: kein vollständiges Server-/Auditprotokoll, kein rückwirkender Fehlernachweis,
keine GPS-/Navigationsdiagnose und keine Garantie, dass jeder Fehler erfasst wurde.
Für den Support muss der Anwender den Auslöser und das unerwartete Verhalten in der
E-Mail selbst beschreiben. Weitere Fachdaten nur gezielt nach gesonderter Entscheidung.

Technik: gemeinsames frühes Browserskript, isolierter nativer Dialog, ZIP im
Browser ohne externe Bibliothek. Die Fahrer-App nimmt die statischen Dateien in
ihre bestehende Offline-App-Shell auf; neuer Cache-Name ohne Änderung der
Navigation oder Offline-Fachdaten. Lokale Browserprüfung: Öffnen, Vorschau,
Download und Leeren erfolgreich; tatsächliches Download-ZIP mit Standardbibliothek
geöffnet und JSON geprüft. Automatische Prüfungen testen Reduktion privater Angaben,
Fetch-/JSON-Verhalten, Speicherfehler und ZIP-Lesbarkeit. Staging-Abnahme separat.
