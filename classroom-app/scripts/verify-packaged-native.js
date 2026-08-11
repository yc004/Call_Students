'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`[package] missing ${label}: ${filePath}`);
  }
}

exports.default = async function verifyPackagedNative(context) {
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const nativeDir = path.join(resourcesDir, 'native');
  const modelDir = path.join(resourcesDir, 'models', 'onnx');
  const manifestPath = path.join(modelDir, 'models.json');

  requireFile(path.join(nativeDir, 'face_native_addon.node'), 'native addon');
  const runtimePattern = context.electronPlatformName === 'win32'
    ? /^onnxruntime\.dll$/i
    : context.electronPlatformName === 'darwin'
      ? /^libonnxruntime.*\.dylib$/
      : /^libonnxruntime.*\.so(?:\..*)?$/;
  const runtimeFiles = fs.readdirSync(nativeDir).filter(file => runtimePattern.test(file));
  if (runtimeFiles.length === 0) throw new Error(`[package] ONNX Runtime library missing from ${nativeDir}`);

  requireFile(manifestPath, 'model manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const model of manifest.models) {
    const modelPath = path.join(modelDir, model.file);
    requireFile(modelPath, `model ${model.file}`);
    const stat = fs.statSync(modelPath);
    if (stat.size !== model.bytes) throw new Error(`[package] ${model.file} has unexpected size`);
    if (sha256(modelPath) !== model.sha256) throw new Error(`[package] ${model.file} checksum mismatch`);
  }
  console.log(`[package] verified native addon, runtime, and ${manifest.models.length} face models`);
};
