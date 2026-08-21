#!/bin/bash
# Automated SQLite database backup
# Usage: ./scripts/backup-db.sh
# Cron: 0 2 * * * /app/scripts/backup-db.sh

set -euo pipefail

DB_PATH="${DB_PATH:-./db/finex.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
MAX_BACKUPS="${MAX_BACKUPS:-30}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/finex_$TIMESTAMP.db"

# Create backup using SQLite .backup command
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>/dev/null || cp "$DB_PATH" "$BACKUP_FILE"

# Compress
if command -v gzip &> /dev/null; then
  gzip "$BACKUP_FILE"
  BACKUP_FILE="$BACKUP_FILE.gz"
fi

# Rotate old backups
ls -t "$BACKUP_DIR"/finex_*.db.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null || true
ls -t "$BACKUP_DIR"/finex_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null || true

echo "Backup created: $BACKUP_FILE"
