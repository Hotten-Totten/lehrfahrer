# Deploy Guide (GitHub -> Strato)

Dieser Stand ist eingerichtet und getestet.

## Ablauf

1. Lokal auf dem PC entwickeln.
2. Auf `main` committen und pushen.
3. GitHub Actions Workflow `Deploy to Strato` laeuft automatisch.
4. Inhalte werden per `rsync` auf Strato deployed.

## GitHub Secrets (Repository)

Pflicht:

- `STRATO_HOST` (z. B. `5576715.ssh.w1.strato.hosting`)
- `STRATO_PORT` (`22`)
- `STRATO_USER` (z. B. `stu354044142`)
- `STRATO_TARGET_PATH` (z. B. `htdocs` ohne fuehrenden Slash)
- `STRATO_PASSWORD` (Passwort des SFTP+SSH-Benutzers)

Optional:

- `STRATO_SSH_KEY` (wenn SSH-Key-Login genutzt wird)
- `STRATO_KNOWN_HOSTS` (wenn Host-Key fest vorgegeben werden soll)

## Wichtige Hinweise

- `STRATO_TARGET_PATH` ohne fuehrenden Slash setzen (also `htdocs`, nicht `/htdocs`).
- Der Workflow nutzt Strato-kompatible `rsync`-Optionen und versucht keine problematischen Rechte-/Owner-Aenderungen.
- Wenn ein Deploy fehlschlaegt, in GitHub Actions die letzte rote Zeile aus dem Job-Log pruefen.
