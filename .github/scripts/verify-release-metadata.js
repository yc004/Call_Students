'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const classroom = JSON.parse(fs.readFileSync(path.join(root, 'classroom-app', 'package.json'), 'utf8'));
const teacher = JSON.parse(fs.readFileSync(path.join(root, 'teacher-app', 'package.json'), 'utf8'));

if (classroom.version !== teacher.version) {
  throw new Error(`App versions differ: classroom=${classroom.version}, teacher=${teacher.version}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(classroom.version)) {
  throw new Error(`Invalid release version: ${classroom.version}`);
}
if (process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `v${classroom.version}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(`Tag ${process.env.GITHUB_REF_NAME} does not match package version ${expectedTag}`);
  }
}

console.log(`[release] metadata valid for version ${classroom.version}`);
