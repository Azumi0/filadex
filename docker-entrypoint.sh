#!/bin/sh
set -e

# Wait for database readiness
echo "Waiting for the database..."
MAX_RETRIES=30
RETRY_COUNT=0

# Check if all required environment variables are set
echo "Checking DB environment variables..."
echo "PGHOST: ${PGHOST:-not set}"
echo "PGPORT: ${PGPORT:-not set}"
echo "PGUSER: ${PGUSER:-not set}"
echo "PGDATABASE: ${PGDATABASE:-not set}"
echo "DATABASE_URL: ${DATABASE_URL:-not set}"

# Test connection with nc
while ! nc -z ${PGHOST:-db} ${PGPORT:-5432}; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "Timeout waiting for the database!"
    exit 1
  fi
  echo "Waiting for the database... Attempt $RETRY_COUNT of $MAX_RETRIES"
  sleep 1
done
echo "Database is accessible!"

# Check the environment variables for the database
echo "Database connection: $PGHOST:$PGPORT $PGDATABASE"

# Explicitly export PGHOST and other PG* variables
export PGHOST=${PGHOST:-db}
export PGPORT=${PGPORT:-5432}
export PGUSER=${PGUSER:-filadex}
export PGPASSWORD=${PGPASSWORD:-filadex}
export PGDATABASE=${PGDATABASE:-filadex}

# Try to see if the database exists
echo "Checking if database $PGDATABASE exists..."
DB_EXISTS=$(PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" postgres)
if [ -z "$DB_EXISTS" ]; then
  echo "Database $PGDATABASE does not exist, trying to create..."
  PGPASSWORD=$PGPASSWORD createdb -h $PGHOST -p $PGPORT -U $PGUSER "$PGDATABASE" || echo "Could not create database, trying to continue anyway..."
else
  echo "Database $PGDATABASE already exists."
fi

# Report what we are connected as before touching anything - this image has a
# history of ownership and permission problems (see the "owner-tolerant"
# migration work), and knowing this up front makes those failures readable.
CURRENT_DB=$(PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -tAc "SELECT current_database()" $PGDATABASE)
HAS_PERMISSION=$(PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -tAc "SELECT has_schema_privilege(current_user, 'public', 'CREATE')" $PGDATABASE)
echo "Connected to database: $CURRENT_DB (target: $PGDATABASE), CREATE on public: $HAS_PERMISSION"

# Bring the schema up to date.
#
# This replaces the CREATE TABLE block and the chain of individual migration
# scripts that used to live here. scripts/migrate.ts decides what a database
# needs: a fresh one gets the schema from the generated migrations, an existing
# one is caught up on the old scripts once and then recorded as being at the
# migration baseline, and after that only new migrations run.
#
# Not allowed to fail silently: a non-zero exit aborts startup rather than
# leaving the app running against a partially-migrated database (see GH issue
# #5 - a missing tsconfig.json in this image used to make migrations fail with
# ERR_MODULE_NOT_FOUND, silently, because of an `|| echo ... continuing`
# fallback that used to be here).
echo "Applying database migrations..."
if ! npx tsx scripts/migrate.ts; then
  echo "Database migration failed" >&2
  exit 1
fi

# Insert sample data, but only if explicitly requested via INIT_SAMPLE_DATA environment variable
echo "Checking for existing data..."

# Create a lock file to prevent data from being initialized multiple times
LOCK_FILE="/app/.init_done"

if [ -f "$LOCK_FILE" ]; then
  echo "Initialization already completed (lock file exists). Skipping data insertion."
else
  COUNT=$(PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d "$PGDATABASE" -t -c "SELECT COUNT(*) FROM public.manufacturers" 2>/dev/null | tr -d ' ' || echo "0")

  if [ "$COUNT" = "0" ]; then
    # Only add sample data if INIT_SAMPLE_DATA is set to "true"
    if [ "${INIT_SAMPLE_DATA}" = "true" ]; then
      echo "INIT_SAMPLE_DATA is set to true. Adding sample data..."
      PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d "$PGDATABASE" -v ON_ERROR_STOP=0 -c "
        INSERT INTO public.manufacturers (name) VALUES ('Bambu Lab') ON CONFLICT DO NOTHING;
        INSERT INTO public.materials (name) VALUES ('PLA') ON CONFLICT DO NOTHING;
        INSERT INTO public.materials (name) VALUES ('PETG') ON CONFLICT DO NOTHING;
        INSERT INTO public.materials (name) VALUES ('ABS') ON CONFLICT DO NOTHING;
        INSERT INTO public.materials (name) VALUES ('TPU') ON CONFLICT DO NOTHING;
        INSERT INTO public.diameters (value) VALUES ('1.75') ON CONFLICT DO NOTHING;
        INSERT INTO public.storage_locations (name) VALUES ('Keller') ON CONFLICT DO NOTHING;
      "
      echo "Basic data inserted!"

      echo "Adding sample colors..."
      PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d "$PGDATABASE" -v ON_ERROR_STOP=0 -c "
        INSERT INTO public.colors (name, code) VALUES ('Dark Gray (Bambu Lab)', '#545454') ON CONFLICT DO NOTHING;
        INSERT INTO public.colors (name, code) VALUES ('Black (Bambu Lab)', '#000000') ON CONFLICT DO NOTHING;
        INSERT INTO public.colors (name, code) VALUES ('White (Bambu Lab)', '#FFFFFF') ON CONFLICT DO NOTHING;
        INSERT INTO public.colors (name, code) VALUES ('Red (Bambu Lab)', '#C12E1F') ON CONFLICT DO NOTHING;
        INSERT INTO public.colors (name, code) VALUES ('Blue (Bambu Lab)', '#0A2989') ON CONFLICT DO NOTHING;
      "
      echo "Sample colors inserted!"
    else
      echo "INIT_SAMPLE_DATA is not set to true. Skipping sample data insertion."
    fi

    # Create the lock file after initialization
    touch "$LOCK_FILE"
    echo "Initialization completed and lock file created."
  else
    echo "Data already exists, skipping initialization."
    touch "$LOCK_FILE"
  fi
fi

# Start the application
echo "Starting application..."
exec "$@"
