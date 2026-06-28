# Entwicklungs-Workflow

## Normaler Workflow

1. Änderungen lokal prüfen.
2. Tests und Syntaxprüfungen ausführen.
3. Git-Status kontrollieren.
4. Änderungen committen und pushen.
5. GitHub-Actions-Ergebnis prüfen.

Das Deploy-Tool bietet ein Menü für Status, Commit und Push, Deployment-Überwachung und die letzten zehn Commits. Commit, Push und das Öffnen der Webseite erfolgen nur nach Bestätigung.

```powershell
powershell -ExecutionPolicy Bypass -File tools/push-lehrfahrer.ps1
```

Für die Deployment-Überwachung wird eine installierte und angemeldete GitHub CLI (`gh`) benötigt. Nach erfolgreichem Workflow kann das Tool optional `https://www.lehrfahrer.de` öffnen.
