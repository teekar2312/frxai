#!/bin/sh
# ============================================================
# FINEX Indonesia — Docker Entrypoint (PostgreSQL mode)
# Runs Prisma migrations against PostgreSQL before starting the app
# ============================================================
set -e

SCHEMA_FILE="prisma/${PRISMA_SCHEMA:-schema.postgres.prisma}"

# Wait for PostgreSQL to be reachable (handles compose dependency timing)
if [ -n "$DATABASE_URL" ]; then
  # Extract host from DATABASE_URL for pg_isready
  # Expected format: postgresql://user:pass@host:5432/db?...
  PGHOST="$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')"
  PGPORT="$(echo "$DATABASE_URL" | sed -n 's|.*@[^:]*:\([0-9]*\).*|\1|p')"

  echo "[entrypoint-pg] Waiting for PostgreSQL at ${PGHOST}:${PGPORT:-5432}..."
  
  MAX_RETRIES=30
  RETRY=0
  while [ $RETRY -lt $MAX_RETRIES ]; do
    if command -v pg_isready > /dev/null 2>&1; then
      if pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -q 2>/dev/null; then
        echo "[entrypoint-pg] PostgreSQL is ready."
        break
      fi
    else
      # Fallback: try connecting with a simple TCP check
      if (echo > "/dev/tcp/${PGHOST:-postgres}/${PGPORT:-5432}") 2>/dev/null; then
        echo "[entrypoint-pg] PostgreSQL is reachable."
        break
      fi
    fi
    RETRY=$((RETRY + 1))
    echo "[entrypoint-pg] Waiting... (${RETRY}/${MAX_RETRIES})"
    sleep 1
  done

  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "[entrypoint-pg] WARNING: PostgreSQL not reachable after ${MAX_RETRIES}s, starting anyway..."
  fi

  # Run Prisma schema push (idempotent, safe for re-runs)
  echo "[entrypoint-pg] Syncing Prisma schema (${SCHEMA_FILE})..."
  if command -v bun > /dev/null 2>&1; then
    bunx prisma db push --schema="$SCHEMA_FILE" --skip-generate --accept-data-loss 2>&1 || \
      echo "[entrypoint-pg] WARNING: prisma db push failed, will retry on next start"
  elif command -v npx > /dev/null 2>&1; then
    npx prisma db push --schema="$SCHEMA_FILE" --skip-generate --accept-data-loss 2>&1 || \
      echo "[entrypoint-pg] WARNING: prisma db push failed, will retry on next start"
  else
    echo "[entrypoint-pg] WARNING: No package manager found to run prisma db push"
  fi
else
  echo "[entrypoint-pg] WARNING: DATABASE_URL not set, skipping migration"
fi

echo "[entrypoint-pg] Starting FINEX Indonesia (PostgreSQL mode)..."

# Execute the main process (CMD from Dockerfile)
exec "$@"
