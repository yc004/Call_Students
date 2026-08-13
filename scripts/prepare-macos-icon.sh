#!/usr/bin/env bash

set -euo pipefail

app_dir="${1:-.}"
app_dir="$(cd "$app_dir" && pwd)"
source_icon="$app_dir/icon.png"
build_dir="$app_dir/build"
output_icon="$build_dir/icon.icns"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[icon] macOS icon generation requires macOS" >&2
  exit 1
fi
if [[ ! -f "$source_icon" ]]; then
  echo "[icon] source icon is missing: $source_icon" >&2
  exit 1
fi

mkdir -p "$build_dir"
sips -s format icns "$source_icon" --out "$output_icon" >/dev/null
echo "[icon] generated $output_icon"
