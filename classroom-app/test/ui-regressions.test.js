const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = path.join(__dirname, '..', 'renderer');

function read(...parts) {
  return fs.readFileSync(path.join(renderer, ...parts), 'utf8');
}

test('人脸录入必须先预览再确认，并允许重拍', () => {
  const html = read('face', 'face-register.html');
  const js = read('face', 'face-register.js');
  assert.match(html, /id="captureBtn"[^>]*>拍照预览</);
  assert.match(html, /id="retakeBtn"[^>]*>重新拍摄</);
  assert.match(html, /id="confirmBtn"[^>]*>确认录入</);
  assert.match(js, /pendingRegistration = \{ studentId, studentName, descriptor \}/);
  assert.match(js, /async function confirmRegistration\(\)/);
});

test('摄像头断开后会退出可拍摄状态并允许重新连接', () => {
  const html = read('face', 'face-register.html');
  const js = read('face', 'face-register.js');
  assert.match(html, /id="retryCameraBtn"[^>]*type="button"/);
  assert.match(js, /track\.addEventListener\('ended'/);
  assert.match(js, /摄像头连接已断开，请检查设备后重试/);
  assert.match(js, /stream = null/);
  assert.match(js, /updateCaptureBtn\(\)/);
});

test('呼叫弹窗提供可读倒计时和暂停控制', () => {
  const html = read('popup', 'popup.html');
  const js = read('popup', 'popup.js');
  assert.match(html, /id="timerText"[^>]*aria-live="polite"/);
  assert.match(html, /id="pauseBtn"[^>]*aria-pressed="false"/);
  assert.match(js, /function toggleCountdown\(\)/);
  assert.match(js, /clearInterval\(countdownTimer\)/);
});

test('作业状态保存失败会恢复修改前状态', () => {
  const js = read('homework', 'homework-board.js');
  assert.match(js, /localAssignment\.submissions\[studentId\] = previousValue/);
  assert.match(js, /保存失败，已恢复原状态，请重试/);
});
