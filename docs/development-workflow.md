# Entwicklungs-Workflow

## Normaler Workflow

1. Änderungen lokal prüfen.
2. Tests und Syntaxprüfungen ausführen.
3. Git-Status kontrollieren.
4. Änderungen committen und pushen.
5. GitHub-Actions-Ergebnis prüfen.

Das Hilfsskript fragt die Commit-Nachricht interaktiv ab, erstellt keinen Commit ohne Bestätigung und wartet bei installierter GitHub CLI auf den Workflow-Abschluss.

```powershell
powershell -ExecutionPolicy Bypass -File tools/push-lehrfahrer.ps1
```

Ist der Working Tree sauber, wird nur gepusht, wenn der aktuelle Branch gegenüber seinem Upstream voraus ist.
