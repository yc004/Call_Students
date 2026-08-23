'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop attendance page exposes the classroom face-system paused state to every teacher', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(html, /id="faceSystemPausedWarning"/);
  assert.match(html, /教室人脸识别已关闭/);
  assert.match(renderer, /faceSystemStateKnown/);
  assert.match(renderer, /msg\.type === 'face-system-state'/);
  assert.match(renderer, /人脸识别已关闭 · 数据已暂停/);
  assert.match(renderer, /人脸识别已关闭，出勤暂停更新/);
});
