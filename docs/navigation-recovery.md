# Navigation: Wiedererkennung bei veraltetem Routenindex

Stand: 08.11.2026, ausschließlich Staging.

Die zwei bisher bekannten Fehler in `tools/navigation-off-route.test.js` sind
behoben. Die lokale Suche konnte einen späteren Routenabschnitt übersehen,
obwohl die tatsächliche GPS-Position bereits wieder auf der Route lag.

Die Wiedererkennung prüft die Routensegmente anhand genauer Raw-GPS-Messungen.
Ein entfernter späterer Abschnitt wird erst nach drei zusammenpassenden Fixes
übernommen. Wechselnde Kandidaten, Signalpausen, ungenaue Messungen und bereits
zurückgelegte Abschnitte bestätigen keinen Sprung. Die geglättete Anzeige kann
die bestätigte Position nicht auf den alten Abschnitt zurücksetzen. Kurze normale
Vorwärtsbewegungen bleiben auch bei dichter Geometrie und in der Simulation möglich.
Ein weiterhin passender lokaler Korridor hat Vorrang vor späteren Schleifen.

Die ursprünglichen Fehlerprüfungen bleiben erhalten; 14 zusätzliche Regressionen
decken diese Grenzen ab. Der Staging-Deploy führt die Suite nun verpflichtend aus.
App-Shell und Service-Worker erhalten den neuen Inhalts-Hash.

Lokale Prüfung: 750 Node-Tests, 741 bestanden, 9 übersprungen, 0 fehlgeschlagen.
Navigation/Offline gezielt: 136 Tests, 134 bestanden, 2 übersprungen, 0 Fehler.
Dies ersetzt keine praktische GPS-Abnahme auf einem Gerät.

Die Produktions-Anmeldung bleibt ein eigener offener Releasepunkt gemäß
`audit-v1-a8.md`; keine Live-Freigabe und keine Produktionsumschaltung.
