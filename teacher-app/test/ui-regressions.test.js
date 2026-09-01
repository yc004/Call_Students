const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const desktopCss = fs.readFileSync(path.join(root, 'desktop.css'), 'utf8');

test('本机已有教室时会在列表渲染后刷新空状态文案', () => {
  const renderRooms = app.slice(
    app.indexOf('function renderRooms()'),
    app.indexOf('function sendLeaveRequest'),
  );
  assert.match(renderRooms, /state\.rooms\.length === 0[\s\S]*renderEmptyState\(\);[\s\S]*return;/);
  assert.match(renderRooms, /roomList\.appendChild\(li\);[\s\S]*renderEmptyState\(\);/);
  assert.match(app, /emptyStateTitle\.textContent = '选择一间教室开始工作'/);
});

test('连接中和离线时不会向辅助技术暴露工作台内容', () => {
  const hideRoomUi = app.slice(
    app.indexOf('function hideRoomUI()'),
    app.indexOf('function renderEmptyState()'),
  );
  assert.match(hideRoomUi, /mainTabContents\?\.forEach/);
  assert.match(hideRoomUi, /content\.classList\.add\('hidden'\)/);
  assert.match(hideRoomUi, /content\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(app, /c\.setAttribute\('aria-hidden', selected \? 'false' : 'true'\)/);
});

test('教师端弹窗提供标题、关闭按钮和多行编辑器语义', () => {
  assert.match(html, /role="textbox"[^>]*aria-multiline="true"/);
  assert.match(html, /id="accountModal"[\s\S]*aria-modal="true"/);
  assert.match(html, /id="accountModalTopClose"[^>]*aria-label="关闭教师端设置"/);
  assert.match(app, /if \(event\.key === 'Escape'\)[\s\S]*if \(accountModal/);
  assert.match(app, /if \(hwModal && !hwModal\.classList\.contains\('hidden'\)\)/);
});

test('多选筛选器使用复选框组语义并支持 Escape 关闭', () => {
  assert.match(html, /id="hwSubjectBtn"[^>]*aria-controls="hwSubjectDrop"/);
  assert.match(html, /id="hwSubjectDrop"[^>]*role="group"[^>]*aria-label="学科筛选"/);
  assert.match(app, /setMultiSelectExpanded\(hwSubjectBtn, hwSubjectDrop, false\); hwSubjectBtn\?\.focus\(\)/);
});

test('辅助说明文字设置了统一可读性下限', () => {
  assert.match(desktopCss, /可读性下限：辅助说明与图表标签不低于 11px/);
  assert.match(desktopCss, /\.ai-chart-legend em,[\s\S]*font-size: 11px;/);
});
