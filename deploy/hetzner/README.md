# Hetzner Testserver per Git-Push deployen

Diese Anleitung ist fuer einen neuen Staging-Server gedacht.
Empfohlenes Ziel: Push auf Branch `staging` loest automatisches Deploy aus.

## 1) Neuen Server in Hetzner Cloud anlegen
1. Image: Ubuntu 24.04 LTS
2. Typ: kleiner Shared vCPU reicht fuer Staging
3. SSH-Key hinterlegen (kein Passwort-Login)
4. Servernamen z. B. `lehrfahrer-staging`
5. Optional Domain vorbereiten: `staging.deine-domain.tld` auf Server-IP zeigen lassen

## 2) Basis auf dem Server installieren
Per SSH als root verbinden und im Projektordner ausfuehren:

```bash
SERVER_DOMAIN=staging.deine-domain.tld APP_NAME=lehrfahrer-staging bash deploy/hetzner/bootstrap-ubuntu.sh
```

Hinweis:
- Das Skript installiert Nginx, PHP-FPM, Git, UFW und legt Benutzer/Ordner an.
- Bare-Repo: `/srv/git/lehrfahrer-staging.git`
- Zielverzeichnis: `/var/www/lehrfahrer-staging`

## 3) Git Hook fuer Auto-Deploy aktivieren
```bash
cp deploy/hetzner/post-receive.sample.sh /srv/git/lehrfahrer-staging.git/hooks/post-receive
chmod +x /srv/git/lehrfahrer-staging.git/hooks/post-receive
chown deploy:deploy /srv/git/lehrfahrer-staging.git/hooks/post-receive
```

## 4) Nginx Site aktivieren
```bash
cp deploy/hetzner/nginx-staging.conf /etc/nginx/sites-available/lehrfahrer-staging.conf
sed -i 's/staging.example.com/staging.deine-domain.tld/g' /etc/nginx/sites-available/lehrfahrer-staging.conf
ln -s /etc/nginx/sites-available/lehrfahrer-staging.conf /etc/nginx/sites-enabled/lehrfahrer-staging.conf
nginx -t
systemctl reload nginx
```

## 5) TLS (Lets Encrypt)
```bash
certbot --nginx -d staging.deine-domain.tld
```

## 6) Lokalen Remote setzen
Im lokalen Projekt:

```bash
git remote add staging deploy@SERVER_IP:/srv/git/lehrfahrer-staging.git
```

Falls `staging` schon existiert:

```bash
git remote set-url staging deploy@SERVER_IP:/srv/git/lehrfahrer-staging.git
```

## 7) Erstes Deploy ausloesen
```bash
git checkout staging
git push staging staging
```

Danach sollte die App unter `https://staging.deine-domain.tld/app/` laufen.

## 8) Schnelltests
1. `https://staging.deine-domain.tld/api/list_cities.php`
2. `https://staging.deine-domain.tld/app/`
3. In der App Stadt/Linie laden, Navigation und Simulation pruefen

## 9) Rollback
Einen frueheren Commit direkt auf den Staging-Branch pushen:

```bash
git push --force-with-lease staging <commit>:staging
```

Nur auf Staging erzwingen, niemals auf Produktion.
