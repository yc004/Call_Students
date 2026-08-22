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
  const profileView = fs.readFileSync(path.join(sourceRoot, 'pages/profile-edit/index.wxml'), 'utf8');

  assert.match(profileView, /open-type=["']chooseAvatar["']/i);
  assert.doesNotMatch(profileView, /getPhoneNumber/i);
  assert.match(profileView, /仅在你主动点击后调用微信头像选择组件/);
});

test('我的页面通过顶部账户区域进入独立个人信息页', () => {
  const profileView = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.wxml'), 'utf8');
  const profileLogic = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.js'), 'utf8');

  assert.match(profileView, /class="profile-account"[^>]*bindtap="openProfileEditor"/);
  assert.doesNotMatch(profileView, /<button class="profile-account"/);
  assert.doesNotMatch(profileView, /bindtap="saveProfile"|open-type="chooseAvatar"/);
  assert.match(profileLogic, /pages\/profile-edit\/index/);
});
