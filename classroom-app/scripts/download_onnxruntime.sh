#!/usr/bin/env bash
# Download ONNX Runtime headers and shared library for the current platform.
# This script fetches the minimal inference-only package.
#
# Usage: bash scripts/download_onnxruntime.sh [version]
#   version: ONNX Runtime version (default: 1.18.0)
#
# The script places files into:
#   classroom-app/native/deps/onnxruntime/include/
#   classroom-app/native/deps/onnxruntime/lib/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPS_DIR="$PROJECT_DIR/native/deps/onnxruntime"

ONNX_VERSION="${1:-1.18.0}"

# Detect platform
case "$(uname -s)" in
    Darwin)
        PLATFORM="osx"
        ARCH="${ONNX_ARCH:-$(uname -m)}"
        if [ "$ARCH" = "arm64" ]; then
            ONNX_ARCH="arm64"
        else
            ONNX_ARCH="x86_64"
        fi
        LIB_EXT="dylib"
        ;;
    Linux)
        PLATFORM="linux"
        ONNX_ARCH="${ONNX_ARCH:-x64}"
        LIB_EXT="so"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="win"
        ONNX_ARCH="${ONNX_ARCH:-x64}"
        LIB_EXT="dll"
        ;;
    *)
        echo "Unsupported platform: $(uname -s)"
        exit 1
        ;;
esac

# Map arch names for ONNX Runtime download
case "$ONNX_ARCH" in
    x86_64|amd64)  ONNX_DOWNLOAD_ARCH="x64" ;;
    arm64|aarch64) ONNX_DOWNLOAD_ARCH="arm64" ;;
    *)             ONNX_DOWNLOAD_ARCH="$ONNX_ARCH" ;;
esac

if [ "$PLATFORM" = "osx" ]; then
    TARBALL="onnxruntime-${PLATFORM}-${ONNX_ARCH}-${ONNX_VERSION}.tgz"
elif [ "$PLATFORM" = "linux" ]; then
    TARBALL="onnxruntime-linux-${ONNX_DOWNLOAD_ARCH}-${ONNX_VERSION}.tgz"
else
    TARBALL="onnxruntime-win-${ONNX_DOWNLOAD_ARCH}-${ONNX_VERSION}.zip"
fi

DOWNLOAD_URL="https://github.com/microsoft/onnxruntime/releases/download/v${ONNX_VERSION}/${TARBALL}"

echo "============================================"
echo "  Downloading ONNX Runtime v${ONNX_VERSION}"
echo "  Platform: ${PLATFORM}/${ONNX_ARCH}"
echo "  URL: ${DOWNLOAD_URL}"
echo "  Destination: ${DEPS_DIR}"
echo "============================================"

mkdir -p "$DEPS_DIR"

# Download if not already cached
CACHE_DIR="$PROJECT_DIR/.cache"
mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/$TARBALL"

if [ ! -f "$CACHE_FILE" ]; then
    echo "Downloading..."
    if command -v curl > /dev/null; then
        curl -L -o "$CACHE_FILE" "$DOWNLOAD_URL"
    elif command -v wget > /dev/null; then
        wget -O "$CACHE_FILE" "$DOWNLOAD_URL"
    else
        echo "ERROR: curl or wget required"
        exit 1
    fi
    echo "Downloaded to $CACHE_FILE"
else
    echo "Using cached download: $CACHE_FILE"
fi

# Extract
echo "Extracting..."
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

if [[ "$TARBALL" == *.zip ]]; then
    unzip -q "$CACHE_FILE" -d "$TMP_DIR"
else
    tar xzf "$CACHE_FILE" -C "$TMP_DIR"
fi

# Find the extracted directory (it's usually named onnxruntime-*)
EXTRACTED_DIR=$(find "$TMP_DIR" -maxdepth 1 -type d -name "onnxruntime-*" | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
    echo "ERROR: Could not find extracted onnxruntime directory"
    exit 1
fi

# Copy headers
rm -rf "$DEPS_DIR/include"
cp -r "$EXTRACTED_DIR/include" "$DEPS_DIR/include"
echo "Headers → $DEPS_DIR/include/"

# Copy library
mkdir -p "$DEPS_DIR/lib"
if [ "$PLATFORM" = "win" ]; then
    cp "$EXTRACTED_DIR/lib/onnxruntime.lib" "$DEPS_DIR/lib/" 2>/dev/null || true
    cp "$EXTRACTED_DIR/lib/onnxruntime.dll" "$DEPS_DIR/lib/" 2>/dev/null || true
    # Also check bin/
    cp "$EXTRACTED_DIR/bin/onnxruntime.dll" "$DEPS_DIR/lib/" 2>/dev/null || true
elif [ "$PLATFORM" = "osx" ]; then
    cp "$EXTRACTED_DIR/lib/libonnxruntime.${ONNX_VERSION}.dylib" "$DEPS_DIR/lib/" 2>/dev/null || true
    # Create symlink without version
    (cd "$DEPS_DIR/lib" && ln -sf "libonnxruntime.${ONNX_VERSION}.dylib" "libonnxruntime.dylib") 2>/dev/null || true
else
    cp "$EXTRACTED_DIR/lib/libonnxruntime.so.${ONNX_VERSION}" "$DEPS_DIR/lib/" 2>/dev/null || true
    (cd "$DEPS_DIR/lib" && ln -sf "libonnxruntime.so.${ONNX_VERSION}" "libonnxruntime.so") 2>/dev/null || true
fi
echo "Library → $DEPS_DIR/lib/"

echo ""
echo "✓ ONNX Runtime v${ONNX_VERSION} installed for ${PLATFORM}/${ONNX_ARCH}"
echo ""
echo "Next: npm run build:native"
