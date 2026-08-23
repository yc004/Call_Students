const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('teaching teacher UI exposes calling and subject-scoped publishing', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(app, /callTabBtn'\)\?\.classList\.remove\('hidden'\)/);
  assert.match(app, /function canModifySubject\(subject\)[\s\S]*subjects[\s\S]*includes/);
  assert.match(app, /const canPublish = homeroom \|\|/);
  assert.doesNotMatch(html, /workspace-tool-call[^>]+data-permission="homeroom"/);
});

test('homeroom UI includes face-system switch and full camera viewer', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(html, /id="faceSystemToggle"/);
  assert.match(html, /id="faceCameraImage"/);
  assert.match(app, /type:'set-face-system'/);
  assert.match(app, /type:'face-preview-subscribe'/);
});
