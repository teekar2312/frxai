#!/usr/bin/env bash
# ============================================================
# FINEX AI TRADING SYSTEM — Backup database SQLite
#
# Backup online (aman dijalankan saat aplikasi masih berjalan)
# memakai API .backup milik sqlite3, lalu dikompres gzip -9.
# Backup lama otomatis dipangkas (default: simpan 14 terbaru).
#
# Pemakaian:
#   bash scripts/backup-db.sh
#   bun run db:backup                      (alias di package.json)
#
# Konfigurasi via environment:
#   DB_PATH     lokasi file database   (default: ./db/custom.db)
#   BACKUP_DIR  folder output backup   (default: ./backups)
#   KEEP        jumlah backup disimpan (default: 14)
#
# Contoh:
#   DB_PATH=/opt/frxai/db/custom.db BACKUP_DIR=/var/backups/frxai \
#   KEEP=30 bash scripts/backup-db.sh
# ============================================================
set -euo pipefail

DB_PATH="${DB_PATH:-./db/custom.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"

# --- Validasi dependensi & input -------------------------------------------

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: perintah 'sqlite3' tidak ditemukan." >&2
  echo "  Ubuntu/Debian : sudo apt-get install -y sqlite3" >&2
  echo "  Alpine        : apk add --no-cache sqlite" >&2
  echo "  macOS         : brew install sqlite" >&2
  echo "  Windows (Git Bash): pakai WSL atau unduh sqlite-tools dari sqlite.org" >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database tidak ditemukan: $DB_PATH" >&2
  echo "  Set DB_PATH ke lokasi file .db yang benar, contoh:" >&2
  echo "  DB_PATH=/opt/frxai/db/custom.db bash scripts/backup-db.sh" >&2
  exit 1
fi

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || [ "$KEEP" -lt 1 ]; then
  echo "ERROR: KEEP harus angka >= 1 (diterima: '$KEEP')." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# --- Backup -----------------------------------------------------------------

STAMP="$(date +%Y%m%d-%H%M%S)"
TMPFILE="$BACKUP_DIR/custom-$STAMP.db.tmp"
OUTFILE="$BACKUP_DIR/custom-$STAMP.db.gz"

# .backup memakai SQLite Online Backup API — konsisten walau DB sedang ditulis
sqlite3 "$DB_PATH" ".backup '$TMPFILE'"

gzip -9 -c "$TMPFILE" > "$OUTFILE"
rm -f "$TMPFILE"

# --- Pangkas backup lama (simpan KEEP terbaru) ------------------------------
# Pola: ls -1t ... | tail -n +$((KEEP+1)) | rm
# Memakai while-read (bukan xargs) agar aman untuk nama file yang mengandung spasi.
ls -1t "$BACKUP_DIR"/custom-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
  [ -f "$old" ] && rm -f -- "$old" && echo "Backup lama dihapus : $old"
done

# --- Ringkasan --------------------------------------------------------------

COUNT="$(ls -1 "$BACKUP_DIR"/custom-*.db.gz 2>/dev/null | wc -l | tr -d ' ')"
SIZE="$(du -h "$OUTFILE" | cut -f1)"

echo "Backup sukses"
echo "  File   : $OUTFILE ($SIZE)"
echo "  Sumber : $DB_PATH"
echo "  Total  : $COUNT backup di $BACKUP_DIR (maks $KEEP disimpan)"
