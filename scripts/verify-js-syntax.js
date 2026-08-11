'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = process.argv[2];

if (!projectDir) {
  console.error('Usage: node scripts/verify-js-syntax.js <project-directory>');
  process.exit(2);
}

const root = path.resolve(__dirname, '..', projectDir);

if (!fs.statSync(root).isDirectory()) {
  console.error(`Project directory does not exist: ${root}`);
  process.exit(2);
}

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.cache') {
      return [];
    }

    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(file);
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}

const files = collectJavaScriptFiles(root);
let failures = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  }
}

if (failures > 0) {
  console.error(`Syntax validation failed for ${failures} file(s).`);
  process.exit(1);
}

console.log(`Syntax validation passed for ${files.length} JavaScript file(s) in ${projectDir}.`);
