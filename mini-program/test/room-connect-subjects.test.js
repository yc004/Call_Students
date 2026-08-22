const assert = require('node:assert/strict');
const test = require('node:test');

test('从科目选择页返回时不会被 onShow 清空未提交的选择', async () => {
  const subjectOptions = require('../src/utils/subject-options');
  const { sessionStore } = require('../src/utils/session');
  const originalChoose = subjectOptions.choose;
  const originalLoad = sessionStore.load;
  const originalPage = global.Page;
  let page;

  try {
    subjectOptions.choose = async () => ['数学', '物理'];
    sessionStore.load = () => ({ account:{ name:'测试教师' }, rooms:[] });
    global.Page = definition => { page = definition; };
    delete require.cache[require.resolve('../src/pages/room-connect/index.js')];
    require('../src/pages/room-connect/index.js');

    const context = {
      data:{ selectedSubjects:[], subjectText:'' },
      room:{ connectionCode:'178-368-049' },
      subjectDraftDirty:false,
      setData(values) { Object.assign(this.data, values); },
    };

    await page.chooseSubjects.call(context);
    assert.deepEqual(context.data.selectedSubjects, ['数学', '物理']);
    assert.equal(context.subjectDraftDirty, true);

    page.refreshSession.call(context, { preserveSubjectDraft:context.subjectDraftDirty });
    assert.deepEqual(context.data.selectedSubjects, ['数学', '物理']);
    assert.equal(context.data.subjectText, '数学、物理');
  } finally {
    subjectOptions.choose = originalChoose;
    sessionStore.load = originalLoad;
    global.Page = originalPage;
  }
});
