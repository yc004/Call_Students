const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const shareCard = require('../src/utils/share-card');

test('classroom shares use the dedicated cover instead of a page screenshot', () => {
  const result = shareCard.classroomInvite('测试教室邀请', '/pages/room-connect/index');
  assert.deepEqual(result, {
    title: '测试教室邀请',
    path: '/pages/room-connect/index',
    imageUrl: '/assets/share/classroom-invite.jpg',
  });
  const cover = path.resolve(__dirname, '../src', result.imageUrl.slice(1));
  assert.equal(fs.existsSync(cover), true);
  assert.ok(fs.statSync(cover).size < 100 * 1024);
});

test('every classroom share entry uses the common share-card helper', () => {
  ['pages/home/index.js', 'pages/scan/index.js', 'pages/classroom-settings/index.js'].forEach(file => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
    assert.match(source, /shareCard\.classroomInvite/);
  });
});
