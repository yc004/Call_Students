const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('subject picker checkboxes are not expanded by modal input styles', () => {
  const css = fs.readFileSync(path.join(root, 'desktop.css'), 'utf8');
  assert.match(css, /\.subject-picker-control \.subject-picker-drop label\s*\{[^}]*grid-template-columns:\s*16px minmax\(0,1fr\)/s);
  assert.match(css, /\.subject-picker-control \.subject-picker-drop input\[type="checkbox"\]\s*\{[^}]*width:\s*16px !important[^}]*min-height:\s*16px !important/s);
});
