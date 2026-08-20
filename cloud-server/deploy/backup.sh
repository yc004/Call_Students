#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/banda-$timestamp.dump"
pg_dump --format=custom --no-owner --file="$target" "$DATABASE_URL"
find "$backup_dir" -type f -name 'banda-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
echo "$target"
