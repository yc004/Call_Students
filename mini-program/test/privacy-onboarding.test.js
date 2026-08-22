const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourceRoot = path.join(__dirname, '..', 'src');

test('登录与首次设置不会索取微信手机号、头像或昵称授权', () => {
  const loginView = fs.readFileSync(path.join(sourceRoot, 'pages/login/index.wxml'), 'utf8');
  const loginLogic = fs.readFileSync(path.join(sourceRoot, 'pages/login/index.js'), 'utf8');

  assert.doesNotMatch(loginView, /getPhoneNumber/i);
  assert.doesNotMatch(loginView, /open-type=["']chooseAvatar["']/i);
  assert.doesNotMatch(loginView, /type=["']nickname["']/i);
  assert.doesNotMatch(loginLogic, /getPhoneNumber|getUserProfile|wx\.authorize/i);
  assert.match(loginView, /个人模式不收集手机号等个人信息/);
});

test('头像只在进入个人资料页后由用户主动选择', () => {
  const profileView = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.wxml'), 'utf8');

  assert.match(profileView, /open-type=["']chooseAvatar["']/i);
  assert.doesNotMatch(profileView, /getPhoneNumber/i);
  assert.match(profileView, /头像仅在你主动点击后选择/);
});
