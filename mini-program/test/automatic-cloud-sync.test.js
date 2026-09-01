const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourceRoot = path.join(__dirname, '..', 'src');

test('我的页面不展示云服务状态且不提供手动同步', () => {
  const view = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.wxml'), 'utf8');
  const logic = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.js'), 'utf8');
  const style = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.wxss'), 'utf8');
  assert.doesNotMatch(view, /云服务已连接|云端用户 ID|同步账号与教室|refreshCloud|cloud-card/);
  assert.doesNotMatch(logic, /refreshCloud|cloudBusy|cloudServerUrl|cloudUserId/);
  assert.doesNotMatch(style, /cloud-card|cloud-connected|cloud-action|cloud-id-row/);
});

test('每次小程序进入前台都会自动同步并通知当前页面刷新', () => {
  const app = fs.readFileSync(path.join(sourceRoot, 'app.js'), 'utf8');
  const home = fs.readFileSync(path.join(sourceRoot, 'pages/home/index.js'), 'utf8');
  const profile = fs.readFileSync(path.join(sourceRoot, 'pages/profile/index.js'), 'utf8');
  assert.match(app, /onShow\(options\)[\s\S]*restoreCloudConnection\(session\)/);
  assert.match(app, /notifyCloudSessionUpdated\(updated\)/);
  assert.match(app, /page\.onCloudSessionUpdated\(session\)/);
  assert.match(home, /onCloudSessionUpdated\(session\)/);
  assert.match(profile, /onCloudSessionUpdated\(\)/);
});

test('教室核心数据优先同步，不被个人资料或科目请求阻塞', () => {
  const app = fs.readFileSync(path.join(sourceRoot, 'app.js'), 'utf8');
  const classroomsAt = app.indexOf('await cloudApi.listClassrooms(cloud)');
  const optionalAt = app.indexOf('Promise.allSettled');
  assert.ok(classroomsAt >= 0 && optionalAt > classroomsAt);
  assert.match(app, /profileResult\.status === 'fulfilled'/);
  assert.match(app, /subjectsResult\.status === 'fulfilled'/);
});

test('云端轮换令牌失效后清理旧会话并返回登录页', () => {
  const app = fs.readFileSync(path.join(sourceRoot, 'app.js'), 'utf8');
  const cloud = fs.readFileSync(path.join(sourceRoot, 'utils/cloud.js'), 'utf8');
  assert.match(cloud, /statusCode:Number\(response\.statusCode\)/);
  assert.match(app, /error\.statusCode === 401[\s\S]*sessionStore\.clear\(\)[\s\S]*reLaunch/);
});
