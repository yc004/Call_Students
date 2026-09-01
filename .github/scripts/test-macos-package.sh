#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <app-path> <dmg-path> <executable-name> <expected-architecture>" >&2
  exit 2
fi

app_path="$1"
dmg_path="$2"
executable_name="$3"
expected_arch="$4"
executable_path="$app_path/Contents/MacOS/$executable_name"

for required_path in "$app_path" "$dmg_path" "$executable_path"; do
  if [[ ! -e "$required_path" ]]; then
    echo "[package] required output is missing: $required_path" >&2
    exit 1
  fi
done

if [[ ! -x "$executable_path" ]]; then
  echo "[package] application executable is not executable: $executable_path" >&2
  exit 1
fi
if ! file "$executable_path" | grep -q "$expected_arch"; then
  echo "[package] executable architecture does not match $expected_arch" >&2
  file "$executable_path" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1 || true)"
if [[ "${MACOS_SIGNING_ENABLED:-false}" == "true" ]]; then
  echo "$signature_details" | grep -q 'Authority=Developer ID Application:'
  xcrun stapler validate "$app_path"
  spctl --assess --type execute --verbose=2 "$app_path"
  echo "[package] Developer ID signature is valid"
else
  echo "$signature_details" | grep -q 'Signature=adhoc'
  echo "[package] ad-hoc signature is valid (not notarized)"
fi

temp_root="${RUNNER_TEMP:-$(mktemp -d)}"
stdout_log="$temp_root/${executable_name}-smoke.stdout.log"
stderr_log="$temp_root/${executable_name}-smoke.stderr.log"
export CLASSROOM_SMOKE_LOG="$temp_root/${executable_name}-classroom-smoke.log"

echo "[smoke] starting $executable_name"
"$executable_path" --ci-smoke-test --enable-logging >"$stdout_log" 2>"$stderr_log" &
app_pid=$!

for _ in {1..120}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if kill -0 "$app_pid" 2>/dev/null; then
  kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  echo "[smoke] application did not exit within 120 seconds" >&2
  cat "$stdout_log" "$stderr_log" "$CLASSROOM_SMOKE_LOG" 2>/dev/null || true
  exit 1
fi

if wait "$app_pid"; then
  echo "[smoke] $executable_name passed"
else
  exit_code=$?
  echo "[smoke] $executable_name failed with exit code $exit_code" >&2
  cat "$stdout_log" "$stderr_log" "$CLASSROOM_SMOKE_LOG" 2>/dev/null || true
  exit "$exit_code"
fi

hdiutil verify "$dmg_path"
mount_dir="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == "true" ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  rmdir "$mount_dir" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$dmg_path" >/dev/null
mounted=true
mounted_app="$(find "$mount_dir" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$mounted_app" || ! -x "$mounted_app/Contents/MacOS/$executable_name" ]]; then
  echo "[package] mounted DMG does not contain the expected application" >&2
  exit 1
fi

echo "[package] DMG verified and contains $executable_name"
