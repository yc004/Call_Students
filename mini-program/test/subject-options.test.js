const test = require('node:test');
const assert = require('node:assert/strict');
const subjects = require('../src/utils/subject-options');

test('科目选项包含常用课程且不会重复', () => {
  const merged = subjects.merge(['数学', '校本课程', '数学']);
  assert.equal(merged.filter(value => value === '数学').length, 1);
  assert.ok(merged.includes('语文'));
  assert.ok(merged.includes('校本课程'));
});

test('历史自定义科目在编辑时会被保留', () => {
  assert.deepEqual(subjects.normalize([' 校本课程 ', '', '校本课程']), ['校本课程']);
});

test('科目选择可通过请求编号稳定返回，不依赖 EventChannel 时序', async () => {
  const originalWx = global.wx;
  let navigateOptions;
  global.wx = {
    navigateTo(options) {
      navigateOptions = options;
      options.success({ eventChannel:{ emit() {} } });
    },
  };
  try {
    const resultPromise = subjects.choose(['语文'], '设置授课科目');
    const pickerId = decodeURIComponent(navigateOptions.url.split('pickerId=')[1]);
    assert.deepEqual(subjects.getPicker(pickerId), { title:'设置授课科目', selected:['语文'], options:[...subjects.OPTIONS] });
    assert.equal(subjects.finishPicker(pickerId, ['数学', '物理']), true);
    assert.deepEqual(await resultPromise, ['数学', '物理']);
    assert.equal(subjects.getPicker(pickerId), null);
  } finally {
    global.wx = originalWx;
  }
});
