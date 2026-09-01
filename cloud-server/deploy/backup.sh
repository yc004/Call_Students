#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi
if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
  echo "BACKUP_AGE_RECIPIENT is required; unencrypted backups are not permitted" >&2
  exit 1
fi
if [ -z "${UPLOADS_DIR:-}" ] || [ ! -d "$UPLOADS_DIR" ]; then
  echo "UPLOADS_DIR must point to the mounted uploads directory" >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
pg_dump --format=custom --no-owner --file="$work_dir/database.dump" "$DATABASE_URL"
pg_restore --list "$work_dir/database.dump" >/dev/null
tar -C "$UPLOADS_DIR" -czf "$work_dir/uploads.tar.gz" .
tar -C "$work_dir" -cf "$work_dir/banda-backup.tar" database.dump uploads.tar.gz
target="$backup_dir/banda-$timestamp.tar.age"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$target" "$work_dir/banda-backup.tar"
sha256sum "$target" > "$target.sha256"
find "$backup_dir" -type f \( -name 'banda-*.tar.age' -o -name 'banda-*.tar.age.sha256' \) -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
echo "$target"
