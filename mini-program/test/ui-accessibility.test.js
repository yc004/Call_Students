const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagesRoot = path.join(__dirname, '..', 'src', 'pages');

function pageViews() {
  return fs.readdirSync(pagesRoot)
    .map((page) => ({
      page,
      file: path.join(pagesRoot, page, 'index.wxml'),
    }))
    .filter(({ file }) => fs.existsSync(file))
    .map(({ page, file }) => ({ page, markup: fs.readFileSync(file, 'utf8') }));
}

test('所有表单控件都提供可读名称', () => {
  for (const { page, markup } of pageViews()) {
    for (const match of markup.matchAll(/<(input|textarea|picker)\b[^>]*>/g)) {
      assert.match(match[0], /\baria-label="[^"]+"/, `${page} 中的表单控件缺少 aria-label: ${match[0]}`);
    }
  }
});

test('使用 bindtap 的非按钮元素都声明交互角色', () => {
  for (const { page, markup } of pageViews()) {
    for (const match of markup.matchAll(/<(view|text|image)\b[^>]*\bbindtap="[^"]+"[^>]*>/g)) {
      assert.match(match[0], /\brole="(button|tab|radio)"/, `${page} 中的可点击元素缺少交互角色: ${match[0]}`);
    }
  }
});

test('教室设置和发布类型切换使用页签语义', () => {
  const classroom = fs.readFileSync(path.join(pagesRoot, 'classroom-settings', 'index.wxml'), 'utf8');
  const homework = fs.readFileSync(path.join(pagesRoot, 'homework', 'index.wxml'), 'utf8');
  assert.match(classroom, /class="segmented" role="tablist"/);
  assert.match(classroom, /role="tab" aria-selected="\{\{tab==='students'\}\}"/);
  assert.match(homework, /class="publish-switch" role="tablist"/);
  assert.match(homework, /role="radiogroup" aria-label="按学科筛选"/);
});
