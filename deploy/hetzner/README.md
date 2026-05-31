# Hetzner Git Deploy (Staging)

## 1) Server user and folders
Create a dedicated deploy user and folders:

- /srv/git/lehrfahrer-staging.git (bare repo)
- /var/www/lehrfahrer-staging (web root)

## 2) Initialize bare repository
Run on server:

sudo -u deploy git init --bare /srv/git/lehrfahrer-staging.git

## 3) Install post-receive hook
Copy post-receive.sample.sh to:

/srv/git/lehrfahrer-staging.git/hooks/post-receive

Then make it executable:

sudo chmod +x /srv/git/lehrfahrer-staging.git/hooks/post-receive

## 4) Add remote locally
Run in your local project:

git remote add staging deploy@YOUR_SERVER:/srv/git/lehrfahrer-staging.git

## 5) Push staging branch

git push staging staging

This triggers auto-deploy to /var/www/lehrfahrer-staging.

## 6) Nginx root
Set web root to:

/var/www/lehrfahrer-staging/app

## 7) API path
The app uses ../api from app/js/app.js.
So expose the repository root under the same vhost, or map /api to /var/www/lehrfahrer-staging/api.
