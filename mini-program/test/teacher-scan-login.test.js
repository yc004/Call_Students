'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.wx = {
  compressImage(options) { options.success({ tempFilePath:'wxfile://compressed-avatar.jpg' }); },
  getFileSystemManager() {
    return {
      readFile(options) { options.success({ data:Buffer.from('avatar-bytes').toString('base64') }); },
    };
  },
};

const { preparePairingSession } = require('../src/utils/auth');

(async () => {
  const local = await preparePairingSession({
    account:{ name:'张老师', connectionId:'teacher-device-123', avatarUrl:'wxfile://profile.png' },
    rooms:[{ name:'一班', connectionCode:'178-260-568' }],
    cloud:null,
  });
  assert.strictEqual(local.account.name, '张老师');
  assert.strictEqual(local.account.avatarUrl, undefined);
  assert.strictEqual(local.avatar.contentType, 'image/jpeg');
  assert.strictEqual(Buffer.from(local.avatar.base64, 'base64').toString(), 'avatar-bytes');
  assert.strictEqual(local.usageMode, 'toc');

  const remote = await preparePairingSession({
    account:{ name:'李老师', connectionId:'teacher-device-456', avatarUrl:'https://example.com/avatar.png' },
    rooms:[],
    cloud:{ serverUrl:'https://cloud.example.com' },
  });
  assert.strictEqual(remote.account.avatarUrl, 'https://example.com/avatar.png');
  assert.strictEqual(remote.avatar, null);
  assert.strictEqual(remote.usageMode, 'tob');

  const scanAction = fs.readFileSync(path.join(__dirname, '../src/utils/scan-action.js'), 'utf8');
  const loginFlow = scanAction.slice(scanAction.indexOf('async function handleTeacherLogin'), scanAction.indexOf('\nfunction start'));
  assert.ok(!loginFlow.includes('sessionStore.save'), '扫码登录不得覆盖小程序当前会话');
  assert.ok(loginFlow.includes('小程序中的资料不会被修改'));

  const teacherHtml = fs.readFileSync(path.join(__dirname, '../../teacher-app/index.html'), 'utf8');
  assert.strictEqual((teacherHtml.match(/id="miniScanLogin"/g) || []).length, 1);
  assert.ok(!teacherHtml.includes('generateMiniProgramQrBtn'), '登录后的账户设置中不得保留扫码同步入口');

  console.log('teacher scan login boundary tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
