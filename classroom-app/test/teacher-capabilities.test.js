const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('approved teaching teachers can call and manage only authorized subjects', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /case 'call':\s*\{\s*if \(!checkApprovedTeacher\(ws\)\) return;/);
  assert.match(main, /function canTeacherManageSubject\(teacher, subject\)[\s\S]*subjects\.includes/);
  assert.doesNotMatch(main, /case 'update-assignments':[\s\S]{0,500}teacher\.role !== '班主任'/);
});

test('full camera preview is restricted to homeroom teachers on direct LAN transport', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(main, /function canManageFaceSystem\(ws\)[\s\S]*_transport === 'lan'[\s\S]*role === '班主任'/);
  assert.match(main, /case 'face-preview-subscribe'/);
  assert.match(main, /ipcMain\.on\('face:report-preview'/);
  assert.match(preload, /previewRequested/);
  assert.match(preload, /reportPreview/);
});
