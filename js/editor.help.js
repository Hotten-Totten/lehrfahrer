// =========================
// HELP MODAL
// =========================
// Dieses Modul verwaltet das Hilfe-Fenster mit Kurzanleitung
// Zeigt Tastenkürzel und Editor-Funktionen

// Öffnet das Hilfe-Fenster und füllt den Hilfetext.
function openHelpModal() {
  helpModalBody.textContent = `LINIENEDITOR – KURZHILFE (ELI15)

1) Haltestelle aus Karte
Klick auf eine vorhandene Katalog-Haltestelle.
Sie wird direkt zur Linie hinzugefügt.

2) Freie Haltestelle
Klick auf die Karte.
Erstellt eine eigene Haltestelle, wenn im Katalog nichts Passendes da ist.

2a) Trasse 2 Stops
Neue Linie
Haltestelle 1 setzen
Haltestelle 2 setzen
Beide Haltestellen anklicken, bis beide in der Reihenfolge grün sind
Trasse 2 Stops klicken
Jetzt ein paar Klicks auf die Karte
dabei müssen sofort lila Punkte / lila Linie erscheinen
Trasse fertig klicken
Danach sollte die Route automatisch gebaut werden

3) Route zeichnen
Klick auf die Karte.
Setzt manuelle Routenpunkte.

4) Straßenroute erzeugen
Berechnet die Route automatisch über Straßen zwischen den Haltestellen.

5) Teilstrecke neu berechnen
Zuerst 2 Routenpunkte auswählen.
Dann nur diesen Abschnitt neu berechnen.

6) Route glätten
Macht die Linie ruhiger und sauberer.

7) Route vereinfachen
Erstellt eine sparsamere Zusatzroute für Vorschau oder spätere App.

8) Original anzeigen
Zeigt die echte Route mit allen Punkten.

9) Vereinfachte anzeigen
Zeigt die reduzierte Vorschau-Route.

10) Auswählen
Damit bearbeitest du vorhandene Punkte statt neue zu setzen.

11) STRG + Klick
Mehrere Routenpunkte einzeln auswählen.

12) SHIFT + Ziehen
Rahmenauswahl für viele Punkte gleichzeitig.

13) ALT + Klick auf Linie
Fügt einen neuen Routenpunkt direkt auf der bestehenden Linie ein.

14) Punkte löschen
Markierte Routenpunkte löschen.

15) JSON exportieren
Speichert die Linie als Datei für die spätere Lehrfahrer-App.

16) Debug
Zeigt interne Meldungen direkt im Editor.`;

  helpModal.classList.remove("hidden");
}

// Schließt das Hilfe-Fenster
function closeHelpModal() {
  helpModal.classList.add("hidden");
}