// =========================
// HELP MODAL
// =========================
// Dieses Modul verwaltet das Hilfe-Fenster mit Kurzanleitung
// Zeigt Tastenkürzel und Editor-Funktionen

// Öffnet das Hilfe-Fenster und füllt den Hilfetext.
const HELP_DOCUMENTS = {
  handbook: {
    title: "Handbuch",
    path: "docs/handbuch.md"
  },
  vision: {
    title: "Vision",
    path: "VISION.md"
  },
  changelog: {
    title: "Changelog",
    path: "CHANGELOG.md"
  },
  development: {
    title: "Entwicklung",
    path: "DEPLOY.md"
  },
  gitWorkflow: {
    title: "Git-Workflow",
    path: "docs/development-workflow.md"
  },
  whatsNew: {
    title: "Was ist neu?",
    path: "CHANGELOG.md",
    render: renderLatestChanges
  },
  about: {
    title: "Über Lehrfahrer",
    load: loadAboutLehrfahrer
  },
  detourWizard: {
    title: "Umleitungs-Wizard Hilfe",
    path: "docs/handbuch.md",
    sectionHeading: "## 7. Umleitungen"
  },
  architecture: {
    title: "Architektur",
    path: "docs/architecture.md"
  },
  roadmap: {
    title: "Roadmap",
    path: "docs/roadmap.md"
  }
};

let helpDocumentRequestId = 0;

async function fetchHelpText(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractMarkdownSection(markdown, sectionHeading) {
  const lines = String(markdown || "").split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim() === sectionHeading);
  if (startIndex === -1) return null;

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function renderLatestChanges(markdown) {
  const content = String(markdown || "").trim();
  if (!content) {
    return "Hinweis:\nFür diese Version sind noch keine Änderungsinformationen vorhanden.";
  }

  const lines = content.split(/\r?\n/);
  const firstEntry = lines.findIndex(line => /^##\s+/.test(line));
  if (firstEntry === -1) {
    return "Hinweis:\nFür diese Version sind noch keine Änderungsinformationen vorhanden.";
  }

  const nextEntry = lines.findIndex((line, index) => index > firstEntry && /^##\s+/.test(line));
  return lines.slice(firstEntry, nextEntry === -1 ? lines.length : nextEntry).join("\n").trim();
}

async function loadOptionalCompanyName() {
  for (const path of ["company.json", "data/company.json"]) {
    try {
      const company = JSON.parse(await fetchHelpText(path));
      const name = String(company.companyName || company.name || company.company || "").trim();
      if (name) return name;
    } catch (err) {
      // Unternehmensbranding ist optional.
    }
  }
  return "";
}

async function loadAboutLehrfahrer() {
  let version = document.body?.dataset?.editorVersion || "unbekannt";
  try {
    version = String(await fetchHelpText("VERSION")).trim() || version;
  } catch (err) {
    // Der im Editor hinterlegte Versionsstand bleibt als Fallback sichtbar.
  }

  const companyName = await loadOptionalCompanyName();
  const companyLine = companyName ? `\nUnternehmen\n${companyName}\n` : "";
  return `Lehrfahrer®

Digitale Plattform zur Planung, Durchführung und Dokumentation von Streckeneinweisungen im öffentlichen Personennahverkehr.

Version
${version}

Copyright
© 2026 Frank Fudeus
${companyLine}
Projektseite
https://www.lehrfahrer.de

Lehrfahrer unterstützt Verkehrsunternehmen dabei, Streckeneinweisungen effizienter, nachvollziehbarer und wirtschaftlicher durchzuführen.`;
}

async function openHelpDocument(documentKey) {
  const documentConfig = HELP_DOCUMENTS[documentKey];
  if (!documentConfig) {
    setStatus("Unbekanntes Hilfedokument.", "warn");
    return;
  }

  const requestId = ++helpDocumentRequestId;
  helpModalTitle.textContent = documentConfig.title;
  helpModalBody.textContent = "Dokument wird geladen ...";
  helpModal.classList.remove("hidden");

  try {
    const markdown = documentConfig.load
      ? await documentConfig.load()
      : await fetchHelpText(documentConfig.path);
    if (requestId !== helpDocumentRequestId) return;

    if (documentConfig.render) {
      helpModalBody.textContent = documentConfig.render(markdown);
      return;
    }

    if (documentConfig.sectionHeading) {
      const section = extractMarkdownSection(markdown, documentConfig.sectionHeading);
      if (!section) {
        throw new Error(`Abschnitt ${documentConfig.sectionHeading} wurde nicht gefunden`);
      }
      helpModalBody.textContent = section;
      return;
    }

    helpModalBody.textContent = markdown;
  } catch (err) {
    if (requestId !== helpDocumentRequestId) return;
    helpModalBody.textContent = "Dokument noch nicht vorhanden.";
  }
}

function openHelpModal() {
  helpDocumentRequestId++;
  helpModalTitle.textContent = "Editor-Kurzhilfe";
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
  helpDocumentRequestId++;
  helpModal.classList.add("hidden");
}
