#!/bin/sh
# ============================================================
# FINEX Indonesia — Docker Entrypoint
# Initializes database and starts the application
# ============================================================
set -e

DATA_DIR="/app/data"
SCHEMA_DIR="/app/prisma"
DB_PATH="$DATA_DIR/custom.db"

# Ensure data directory exists with correct permissions
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown nextjs:nodejs "$DATA_DIR" 2>/dev/null || true
fi
mkdir -p "$DATA_DIR"

# Initialize database if it doesn't exist or is empty
if [ ! -f "$DB_PATH" ] || [ ! -s "$DB_PATH" ]; then
  echo "[entrypoint] Initializing database..."
  if command -v npx > /dev/null 2>&1; then
    npx prisma db push --skip-generate 2>&1 || echo "[entrypoint] WARNING: prisma db push failed, will retry on next start"
  elif command -v bun > /dev/null 2>&1; then
    bunx prisma db push --skip-generate 2>&1 || echo "[entrypoint] WARNING: prisma db push failed, will retry on next start"
  else
    echo "[entrypoint] WARNING: No package manager found to run prisma db push"
  fi
else
  echo "[entrypoint] Database exists, running schema sync..."
  if command -v bun > /dev/null 2>&1; then
    bunx prisma db push --skip-generate --accept-data-loss 2>&1 || true
  fi
fi

echo "[entrypoint] Starting FINEX Indonesia..."

# Execute the main process (CMD from Dockerfile)
exec "$@"