#!/usr/bin/env bash

set -euo pipefail

version="${1:-1.18.0}"
requested_arch="${2:-$(uname -m)}"

case "$requested_arch" in
  arm64|aarch64)
    package_arch="arm64"
    expected_machine="arm64"
    ;;
  x64|x86_64|amd64)
    package_arch="x86_64"
    expected_machine="x86_64"
    ;;
  *)
    echo "[onnxruntime] unsupported macOS architecture: $requested_arch" >&2
    exit 1
    ;;
esac

runner_arch="$(uname -m)"
if [[ "$runner_arch" != "$expected_machine" ]]; then
  echo "[onnxruntime] runner is $runner_arch but $expected_machine was requested" >&2
  echo "[onnxruntime] native face packages must be built on a matching macOS runner" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"
classroom_dir="$root_dir/classroom-app"
cache_dir="$classroom_dir/.cache/onnxruntime"
deps_dir="$classroom_dir/native/deps/onnxruntime"
archive_name="onnxruntime-osx-${package_arch}-${version}.tgz"
archive_path="$cache_dir/$archive_name"
download_url="https://github.com/microsoft/onnxruntime/releases/download/v${version}/${archive_name}"

mkdir -p "$cache_dir"
if [[ ! -f "$archive_path" ]]; then
  echo "[onnxruntime] downloading $download_url"
  curl --fail --location --retry 3 --retry-all-errors \
    --output "$archive_path" "$download_url"
fi

archive_bytes="$(stat -f '%z' "$archive_path")"
if (( archive_bytes < 1048576 )); then
  echo "[onnxruntime] archive is unexpectedly small: $archive_path" >&2
  exit 1
fi

extract_dir="$(mktemp -d)"
trap 'rm -rf "$extract_dir"' EXIT
tar -xzf "$archive_path" -C "$extract_dir"

package_root="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d -name 'onnxruntime-*' -print -quit)"
if [[ -z "$package_root" ]]; then
  echo "[onnxruntime] archive did not contain the expected package directory" >&2
  exit 1
fi

runtime_library="$(find "$package_root/lib" -maxdepth 1 -type f -name 'libonnxruntime.*.dylib' -print -quit)"
if [[ -z "$runtime_library" ]]; then
  runtime_library="$(find "$package_root/lib" -maxdepth 1 -type f -name 'libonnxruntime*.dylib' -print -quit)"
fi
if [[ ! -d "$package_root/include" || -z "$runtime_library" ]]; then
  echo "[onnxruntime] required headers or dynamic library are missing" >&2
  exit 1
fi
if ! file "$runtime_library" | grep -q "$expected_machine"; then
  echo "[onnxruntime] dynamic library architecture does not match $expected_machine" >&2
  file "$runtime_library" >&2
  exit 1
fi

rm -rf "$deps_dir/include" "$deps_dir/lib"
mkdir -p "$deps_dir/include" "$deps_dir/lib"
cp -R "$package_root/include/." "$deps_dir/include/"
runtime_name="$(basename "$runtime_library")"
cp "$runtime_library" "$deps_dir/lib/$runtime_name"
ln -s "$runtime_name" "$deps_dir/lib/libonnxruntime.dylib"

echo "[onnxruntime] prepared macOS $expected_machine runtime $version"
