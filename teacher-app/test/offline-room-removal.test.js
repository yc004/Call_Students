const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'desktop.css'), 'utf8');

test('teacher can remove a stale classroom record without connecting to it', () => {
  assert.match(app, /function chooseRoomRemovalMode\(room\)/);
  assert.match(app, /local\.addEventListener\('click', \(\) => finish\('local'\)\)/);
  assert.match(app, /if \(removalMode === 'local'\) \{\s*await removeRoomFromLocalState\(room\);/);
  assert.match(app, /仅从本机移除不会解除教室端的班主任身份/);
  assert.match(css, /\.room-removal-card\s*\{/);
});

test('normal removal still asks the classroom to delete the teacher record first', () => {
  assert.match(app, /if \(removalMode === 'local'\)[\s\S]*state\.leavingRoomCode = code;[\s\S]*await requestClassroomLeave\(room\);/);
  assert.match(app, /无法通知教室端，本次仍保留本地记录/);
});
