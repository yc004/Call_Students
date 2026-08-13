const assert = require('assert');
const ExcelJS = require('exceljs');
const { buildHomeworkWorkbookBuffer, safeFilePart } = require('../homework-export');

(async () => {
  const buffer = await buildHomeworkWorkbookBuffer({
    className: '八年级一班',
    teacherName: '刘老师',
    exportedAt: '2026-08-12T10:00:00.000Z',
    filters: { stage: 'closed', subjects: ['数学'], status: '', dateFrom: '2026-08-01', dateTo: '2026-08-12' },
    students: [{ id: 's1', name: '张三' }, { id: 's2', name: '李四' }, { id: 's3', name: '王五' }],
    assignments: [{
      id: 'hw-1',
      subject: '数学',
      title: '练习册 3-4 页',
      date: '2026-08-12',
      deadline: '2026-08-12T21:00',
      submissions: { s1: '已提交', s2: '迟交', s3: '未提交' },
    }],
  });
  assert(buffer.byteLength > 5000, 'workbook should contain real xlsx data');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepStrictEqual(workbook.worksheets.map(sheet => sheet.name), ['作业汇总', '学生明细']);
  const summary = workbook.getWorksheet('作业汇总');
  const detail = workbook.getWorksheet('学生明细');
  assert.strictEqual(summary.getCell('A1').value, '八年级一班 · 作业统计');
  assert.strictEqual(summary.getCell('F9').result, 1);
  assert.strictEqual(summary.getCell('G9').result, 1);
  assert.strictEqual(summary.getCell('H9').result, 1);
  assert.strictEqual(summary.getCell('K9').result, 2 / 3);
  assert(String(summary.getCell('A5').value).includes('提交统计'));
  assert.strictEqual(detail.rowCount, 4);
  assert.strictEqual(detail.getCell('F2').value, '已提交');
  assert.strictEqual(detail.getCell('F4').value, '未提交');
  assert.strictEqual(safeFilePart('八/一:*?班'), '八-一---班');
  console.log('homework export tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
