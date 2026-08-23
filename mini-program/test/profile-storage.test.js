const test = require('node:test');
const assert = require('node:assert/strict');

let stored = null;
global.wx = {
  getStorageSync() { return stored; },
  setStorageSync(_key, value) { stored = value; },
  removeStorageSync() { stored = null; },
};

const { sessionStore } = require('../src/utils/session');

test('个人模式用户名和头像保存在本地会话', () => {
  sessionStore.save({ account:{ name:'张老师', connectionId:'mini-profile-12345678', avatarUrl:'wxfile://profile/avatar.jpg' }, rooms:[], activeRoom:null });
  const session = sessionStore.load();
  assert.equal(session.account.name, '张老师');
  assert.equal(session.account.avatarUrl, 'wxfile://profile/avatar.jpg');
  assert.equal(session.usageMode, 'toc');
});

test('组织资料同步时更新本地展示用户名和头像', () => {
  const current = sessionStore.load();
  sessionStore.save({ ...current, cloud:{ serverUrl:'https://cloud.example.com', accessToken:'a', refreshToken:'r', nickname:'李老师', avatarUrl:'https://cloud.example.com/avatar.jpg', organization:{} } });
  sessionStore.updateCloud({ serverUrl:'https://cloud.example.com', accessToken:'a', refreshToken:'r', nickname:'王老师', avatarUrl:'https://cloud.example.com/new.jpg', organization:{} }, []);
  const session = sessionStore.load();
  assert.equal(session.account.name, '王老师');
  assert.equal(session.account.avatarUrl, 'https://cloud.example.com/new.jpg');
  assert.equal(session.usageMode, 'tob');
});
