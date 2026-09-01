const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', 'src');

test('首次修改初始密码后提供微信绑定，登录页提供一键登录', () => {
  const logic = fs.readFileSync(path.join(root, 'pages/login/index.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'pages/login/index.wxml'), 'utf8');
  assert.match(logic, /completeProfile[\s\S]*offerWechatBinding\(updated\)/);
  assert.match(logic, /wx\.login/);
  assert.match(logic, /cloudApi\.bindWechat/);
  assert.match(logic, /cloudApi\.loginWechatAccount/);
  assert.match(view, /bindtap="loginWechatOrganization"[^>]*>微信一键登录/);
  assert.doesNotMatch(logic, /getUserProfile|getPhoneNumber/);
});

test('个人信息页可以补充绑定微信并显示绑定状态', () => {
  const logic = fs.readFileSync(path.join(root, 'pages/profile-edit/index.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'pages/profile-edit/index.wxml'), 'utf8');
  assert.match(logic, /bindWechat\(\)/);
  assert.match(view, /微信账号/);
  assert.match(view, /wechatBound \? '已绑定' : '绑定当前微信'/);
});
