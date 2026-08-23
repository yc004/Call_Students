'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', 'coverage']);
const checkedExtensions = new Set(['.js', '.ts', '.json', '.html', '.md', '.yml', '.yaml']);
const forbiddenNames = [
  ['教室', '呼叫'].join(''),
  ['学生', '呼叫系统'].join(''),
  ['Classroom', 'Call'].join(''),
  ['班达', '随身'].join(''),
  ['班达', '教师'].join(''),
];
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file);
      continue;
    }
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    const relative = path.relative(root, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      forbiddenNames.forEach(name => {
        if (line.includes(name)) failures.push(`${relative}:${index + 1}: contains legacy product name “${name}”`);
      });
    });
  }
}

visit(root);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('[branding] product name is consistently Banda / 班达');
