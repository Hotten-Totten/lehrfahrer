#!/bin/sh
set -eu

# Adjust these paths for your server
BRANCH="staging"
TARGET="/var/www/lehrfahrer-staging"
WEB_USER="www-data"

read oldrev newrev refname

if [ "$refname" = "refs/heads/$BRANCH" ]; then
  mkdir -p "$TARGET"
  GIT_WORK_TREE="$TARGET" git checkout -f "$BRANCH"

  # Small deployment marker for quick troubleshooting
  printf '%s\n' "branch=$BRANCH" "commit=$newrev" "time=$(date -u +%FT%TZ)" > "$TARGET/.deploy-info"

  # Optional: tighten permissions
  find "$TARGET" -type d -exec chmod 755 {} \;
  find "$TARGET" -type f -exec chmod 644 {} \;
  chown -R "$WEB_USER":"$WEB_USER" "$TARGET"

  echo "Deployed branch $BRANCH to $TARGET"
else
  echo "No deploy: pushed $refname (deploy branch is $BRANCH)"
fi
