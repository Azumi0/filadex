#!/bin/sh
set -e

# Decide dialect from DATABASE_URL scheme (defaults to Postgres)
case "${DATABASE_URL}" in
  file:*|sqlite:*)
    MIGRATOR="dist/migrate.sqlite.js"
    SEEDER="dist/seed.sqlite.js"
    APP="dist/index.sqlite.js"
    ;;
  *)
    MIGRATOR="dist/migrate.pg.js"
    SEEDER="dist/seed.pg.js"
    APP="dist/index.pg.js"
    ;;
esac

# If the command is to start the server (default), run migrations and optional seed
if [ "$#" -eq 0 ] || [ "$1" = "node" -a "$2" = "dist/index.js" ] || [ "$1" = "node" -a "$2" = "dist/index.pg.js" ] || [ "$1" = "node" -a "$2" = "dist/index.sqlite.js" ]; then
  echo "Applying database migrations..."
  node "${MIGRATOR}"

  if [ "${INIT_SAMPLE_DATA}" = "true" ]; then
    echo "Seeding starter data..."
    node "${SEEDER}" --starter
  fi

  echo "Starting application..."
  exec node "${APP}"
fi

exec "$@"
