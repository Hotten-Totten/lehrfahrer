#!/usr/bin/env bash
set -euo pipefail

# Usage (on server as root):
# SERVER_DOMAIN=staging.example.com \
# APP_NAME=lehrfahrer-staging \
# bash deploy/hetzner/bootstrap-ubuntu.sh

APP_NAME="${APP_NAME:-lehrfahrer-staging}"
SERVER_DOMAIN="${SERVER_DOMAIN:-staging.example.com}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
WWW_USER="${WWW_USER:-www-data}"
GIT_BARE="/srv/git/${APP_NAME}.git"
WEB_ROOT="/var/www/${APP_NAME}"

if [ "$EUID" -ne 0 ]; then
  echo "Bitte als root ausfuehren."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx git php-fpm php-cli php-json php-mbstring certbot python3-certbot-nginx ufw

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi

mkdir -p /srv/git "$WEB_ROOT"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" /srv/git "$WEB_ROOT"

if [ ! -d "$GIT_BARE" ]; then
  sudo -u "$DEPLOY_USER" git init --bare "$GIT_BARE"
fi

# Base permissions
find "$WEB_ROOT" -type d -exec chmod 755 {} \;

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<EOF

Bootstrap abgeschlossen.

Naechste Schritte:
1) post-receive Hook installieren (siehe deploy/hetzner/README.md)
2) Nginx Konfiguration aktivieren
3) TLS-Zertifikat holen:
   certbot --nginx -d ${SERVER_DOMAIN}

EOF
