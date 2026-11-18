#!/bin/sh
# Production start for hosting (Railway / any Docker host).
# The database lives on a persistent volume at $DATA_DIR (default /data) so it survives redeploys.
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
export DATABASE_URL="file:$DATA_DIR/crm.db"

if [ ! -f "$DATA_DIR/crm.db" ]; then
  echo "First start: copying the starting database onto the volume"
  cp seed/initial.db "$DATA_DIR/crm.db"
  npx prisma db push --skip-generate
  node_modules/.bin/tsx scripts/set-passwords.ts
else
  npx prisma db push --skip-generate
fi

# One-off password reset: set PASSWORD_RESET to any new value (e.g. 2026-11-06) and the three
# logins are reset from ADMIN/SETTER/TEAM_PASSWORD on the next start. It runs once per value,
# so passwords changed in the app afterwards are kept on later restarts.
if [ -n "$PASSWORD_RESET" ] && [ ! -f "$DATA_DIR/.password-reset-$PASSWORD_RESET" ]; then
  echo "Resetting login passwords (PASSWORD_RESET=$PASSWORD_RESET)"
  node_modules/.bin/tsx scripts/set-passwords.ts
  touch "$DATA_DIR/.password-reset-$PASSWORD_RESET"
fi

if [ -n "$GROSS_MARGIN_GOAL" ] && [ ! -f "$DATA_DIR/.gm-goal-$GROSS_MARGIN_GOAL" ]; then
  echo "Setting gross margin goal to $GROSS_MARGIN_GOAL%"
  node_modules/.bin/tsx scripts/set-gm-goal.ts && touch "$DATA_DIR/.gm-goal-$GROSS_MARGIN_GOAL"
fi

# One-off: load the Hecho Robina (898) WIP example when WIP_SEED_EXAMPLE=1 (skips itself if job 898 exists).
if [ "$WIP_SEED_EXAMPLE" = "1" ] && [ ! -f "$DATA_DIR/.wip-seeded" ]; then
  node_modules/.bin/tsx scripts/seed-wip-example.ts && touch "$DATA_DIR/.wip-seeded"
fi

node_modules/.bin/tsx scripts/ensure-users.ts

exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3100}"
