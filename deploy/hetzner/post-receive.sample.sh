#!/bin/sh
set -eu

# Adjust these paths for your server
BRANCH="staging"
TARGET="/var/www/lehrfahrer-staging"

read oldrev newrev refname

if [ "$refname" = "refs/heads/$BRANCH" ]; then
  mkdir -p "$TARGET"
  GIT_WORK_TREE="$TARGET" git checkout -f "$BRANCH"

  # Optional: tighten permissions
  find "$TARGET" -type d -exec chmod 755 {} \;
  find "$TARGET" -type f -exec chmod 644 {} \;

  echo "Deployed branch $BRANCH to $TARGET"
else
  echo "No deploy: pushed $refname (deploy branch is $BRANCH)"
fi
