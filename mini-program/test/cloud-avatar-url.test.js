const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCloudAssetUrl } = require('../src/utils/cloud');
const fs = require('node:fs');
const path = require('node:path');

test('云端头像始终使用当前登录服务器，并保留缓存版本', () => {
  const server = 'http://192.168.1.3:8080';
  assert.equal(
    resolveCloudAssetUrl(server, 'https://cloud.example.com/uploads/avatars/teacher.png?v=42'),
    'http://192.168.1.3:8080/uploads/avatars/teacher.png?v=42',
  );
  assert.equal(
    resolveCloudAssetUrl(server, '/uploads/avatars/teacher.webp?v=43'),
    'http://192.168.1.3:8080/uploads/avatars/teacher.webp?v=43',
  );
});

test('非本站上传资源不擅自改写', () => {
  assert.equal(
    resolveCloudAssetUrl('https://cloud.example.com', 'https://cdn.example.com/profile/avatar.png'),
    'https://cdn.example.com/profile/avatar.png',
  );
});

test('头像上传无论微信回调是否异常都会在限定时间内结束', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/utils/cloud.js'), 'utf8');
  assert.match(source, /头像上传超时/);
  assert.match(source, /encoding:'base64'/);
  assert.match(source, /data:\{ base64:String\(file\.data \|\| ''\) \}/);
  assert.match(source, /catch \(error\) \{ finish\(reject, error\); \}/);
  assert.match(source, /requestTask\.abort\(\)/);
});

test('刷新令牌请求采用单例并发，避免同一个轮换令牌被重复使用', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/utils/cloud.js'), 'utf8');
  assert.match(source, /refreshSession\.pending\.key === key/);
  assert.match(source, /refreshSession\.pending = \{ key, promise \}/);
});
