#!/usr/bin/env bash
# Deploys the latest main branch to this server.
# Run by GitHub Actions through a restricted SSH key (forced command),
# or by hand: /opt/sms-sites/scripts/deploy.sh
#
# Live data (*.sqlite, public/uploads/, .env, ecosystem.config.js) is
# git-ignored, so the reset below never touches it.
set -euo pipefail

# Wrapped in a function so bash reads the whole script before running it;
# the git reset below may replace this file mid-run.
main() {

  APP_DIR=/opt/sms-sites
  APP_NAME=sms-sites

  # Non-interactive SSH sessions may not load the login PATH (nvm, global npm).
  export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null
  fi

  cd "$APP_DIR"

  # One deploy at a time.
  exec 9>"/tmp/${APP_NAME}-deploy.lock"
  flock -n 9 || { echo "Another deploy is already running."; exit 1; }

  before_lock=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)

  git fetch --quiet origin main
  git reset --hard --quiet origin/main

  after_lock=$(sha1sum package-lock.json | cut -d' ' -f1)
  if [ "$before_lock" != "$after_lock" ] || [ ! -d node_modules ]; then
    echo "Dependencies changed - installing."
    npm ci --omit=dev --no-audit --no-fund
  fi

  pm2 reload "$APP_NAME"
  pm2 save >/dev/null

  echo "Deployed $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
}

main "$@"
exit
