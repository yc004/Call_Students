const ExcelJS = require('exceljs');

const STATUS_ORDER = ['已提交', '迟交', '未提交', '免交'];
const COLORS = {
  navy: 'FF172033',
  blue: 'FF3568E8',
  blueLight: 'FFEAF1FF',
  header: 'FFF3F6FC',
  border: 'FFDCE3EE',
  muted: 'FF667085',
  green: 'FF237A57',
  greenLight: 'FFE8F7F0',
  orange: 'FFB26812',
  orangeLight: 'FFFFF2DC',
  red: 'FFC24141',
  redLight: 'FFFFEAEA',
  grayLight: 'FFF2F4F7',
};

function safeText(value, maxLength = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

function safeFilePart(value) {
  return safeText(value, 60).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ') || '教室';
}

function normalizePayload(input = {}) {
  const students = Array.isArray(input.students) ? input.students.slice(0, 5000).map((student, index) => ({
    id: safeText(student && student.id, 100) || `student-${index + 1}`,
    name: safeText(student && student.name, 80) || `学生${index + 1}`,
  })) : [];
  const studentIds = new Set(students.map(student => student.id));
  const assignments = Array.isArray(input.assignments) ? input.assignments.filter(assignment => !assignment || assignment.type !== 'notice').slice(0, 1000).map((assignment, index) => {
    const submissions = {};
    if (assignment && assignment.submissions && typeof assignment.submissions === 'object') {
      Object.entries(assignment.submissions).forEach(([studentId, status]) => {
        const id = safeText(studentId, 100);
        if (studentIds.has(id)) submissions[id] = safeText(status, 80) || '未提交';
      });
    }
    return {
      id: safeText(assignment && assignment.id, 100) || `assignment-${index + 1}`,
      subject: safeText(assignment && assignment.subject, 80) || '未分类',
      title: safeText(assignment && assignment.title, 200) || '未命名作业',
      date: safeText(assignment && assignment.date, 20),
      deadline: safeText(assignment && assignment.deadline, 40),
      submissions,
    };
  }) : [];
  return {
    className: safeText(input.className, 80) || '未命名教室',
    teacherName: safeText(input.teacherName, 80) || '教师',
    exportedAt: input.exportedAt ? new Date(input.exportedAt) : new Date(),
    filters: {
      stage: safeText(input.filters && input.filters.stage, 20),
      subjects: Array.isArray(input.filters && input.filters.subjects) ? input.filters.subjects.map(v => safeText(v, 80)).filter(Boolean) : [],
      assignments: Array.isArray(input.filters && input.filters.assignments) ? input.filters.assignments.map(v => safeText(v, 200)).filter(Boolean) : [],
      status: safeText(input.filters && input.filters.status, 80),
      dateFrom: safeText(input.filters && input.filters.dateFrom, 20),
      dateTo: safeText(input.filters && input.filters.dateTo, 20),
    },
    students,
    assignments,
  };
}

function excelDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function statusFor(assignment, studentId) {
  return assignment.submissions[studentId] || '未提交';
}

function statusCounts(assignment, students) {
  const counts = { 已提交: 0, 迟交: 0, 未提交: 0, 免交: 0, 其他: 0 };
  students.forEach(student => {
    const status = statusFor(assignment, student.id);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    else counts.其他 += 1;
  });
  return counts;
}

function styleTitle(sheet, range) {
  range.font = { name: 'Microsoft YaHei', size: 20, bold: true, color: 'FFFFFFFF' };
  range.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
  range.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 42;
}

function styleTableHeader(row) {
  row.height = 28;
  row.eachCell(cell => {
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: COLORS.navy };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: COLORS.border } } };
  });
}

function addStatusStyle(cell, status) {
  const map = {
    已提交: [COLORS.green, COLORS.greenLight],
    迟交: [COLORS.orange, COLORS.orangeLight],
    未提交: [COLORS.red, COLORS.redLight],
    免交: [COLORS.muted, COLORS.grayLight],
  };
  const [font, fill] = map[status] || [COLORS.muted, COLORS.grayLight];
  cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: font };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
}

function filterDescription(filters) {
  const parts = [];
  if (filters.stage) parts.push(`作业阶段：${filters.stage === 'pending' ? '待提交作业' : '提交统计'}`);
  if (filters.subjects.length) parts.push(`学科：${filters.subjects.join('、')}`);
  if (filters.assignments.length) parts.push(`作业：${filters.assignments.join('、')}`);
  if (filters.status) parts.push(`状态：${filters.status}`);
  if (filters.dateFrom || filters.dateTo) parts.push(`日期：${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}`);
  return parts.length ? parts.join('；') : '全部作业、全部学生';
}

async function createHomeworkWorkbook(input) {
  const data = normalizePayload(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '教室呼叫教师端';
  workbook.created = data.exportedAt;
  workbook.modified = data.exportedAt;
  workbook.properties.date1904 = false;

  const summary = workbook.addWorksheet('作业汇总', { views: [{ state: 'frozen', ySplit: 8 }] });
  const detail = workbook.addWorksheet('学生明细', { views: [{ state: 'frozen', ySplit: 1 }] });

  summary.mergeCells('A1:K1');
  summary.getCell('A1').value = `${data.className} · 作业统计`;
  styleTitle(summary, summary.getCell('A1'));
  summary.getCell('A3').value = '导出教师';
  summary.getCell('B3').value = data.teacherName;
  summary.getCell('D3').value = '导出时间';
  summary.getCell('E3').value = data.exportedAt;
  summary.getCell('E3').numFmt = 'yyyy-mm-dd hh:mm';
  summary.getCell('G3').value = '学生人数';
  summary.getCell('H3').value = data.students.length;
  summary.getCell('J3').value = '作业数量';
  summary.getCell('K3').value = data.assignments.length;
  ['A3', 'D3', 'G3', 'J3'].forEach(address => {
    summary.getCell(address).font = { name: 'Microsoft YaHei', bold: true, color: COLORS.muted };
  });
  ['B3', 'E3', 'H3', 'K3'].forEach(address => {
    summary.getCell(address).font = { name: 'Microsoft YaHei', bold: true, color: COLORS.navy };
  });
  summary.mergeCells('A5:K5');
  summary.getCell('A5').value = `筛选范围：${filterDescription(data.filters)}`;
  summary.getCell('A5').font = { name: 'Microsoft YaHei', size: 10, color: COLORS.muted };
  summary.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blueLight } };
  summary.getCell('A5').alignment = { vertical: 'middle', wrapText: true };
  summary.getRow(5).height = 30;

  const headers = ['序号', '学科', '作业内容', '布置日期', '截止时间', '已提交', '迟交', '未提交', '免交', '其他', '完成率'];
  summary.getRow(8).values = headers;
  styleTableHeader(summary.getRow(8));

  const detailHeaders = ['学生姓名', '学科', '作业内容', '布置日期', '截止时间', '提交状态'];
  detail.getRow(1).values = detailHeaders;
  styleTableHeader(detail.getRow(1));
  let detailRow = 2;
  data.assignments.forEach(assignment => {
    data.students.forEach(student => {
      const status = statusFor(assignment, student.id);
      const row = detail.getRow(detailRow++);
      row.values = [student.name, assignment.subject, assignment.title, excelDate(assignment.date), excelDate(assignment.deadline), status];
      row.getCell(4).numFmt = 'yyyy-mm-dd';
      row.getCell(5).numFmt = 'yyyy-mm-dd hh:mm';
      addStatusStyle(row.getCell(6), status);
      row.eachCell((cell, col) => {
        cell.font = { ...(cell.font || {}), name: 'Microsoft YaHei', size: 10 };
        cell.alignment = { ...(cell.alignment || {}), vertical: 'middle', wrapText: col === 3 };
        cell.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
      });
      addStatusStyle(row.getCell(6), status);
      row.height = 24;
    });
  });
  const detailLastRow = Math.max(2, detailRow - 1);

  data.assignments.forEach((assignment, index) => {
    const rowNumber = 9 + index;
    const row = summary.getRow(rowNumber);
    const counts = statusCounts(assignment, data.students);
    row.values = [index + 1, assignment.subject, assignment.title, excelDate(assignment.date), excelDate(assignment.deadline), null, null, null, null, null, null];
    row.getCell(4).numFmt = 'yyyy-mm-dd';
    row.getCell(5).numFmt = 'yyyy-mm-dd hh:mm';
    STATUS_ORDER.forEach((status, statusIndex) => {
      const result = counts[status];
      row.getCell(6 + statusIndex).value = {
        formula: `COUNTIFS('学生明细'!$B$2:$B$${detailLastRow},B${rowNumber},'学生明细'!$C$2:$C$${detailLastRow},C${rowNumber},'学生明细'!$D$2:$D$${detailLastRow},D${rowNumber},'学生明细'!$E$2:$E$${detailLastRow},E${rowNumber},'学生明细'!$F$2:$F$${detailLastRow},"${status}")`,
        result,
      };
    });
    row.getCell(10).value = {
      formula: `COUNTIFS('学生明细'!$B$2:$B$${detailLastRow},B${rowNumber},'学生明细'!$C$2:$C$${detailLastRow},C${rowNumber},'学生明细'!$D$2:$D$${detailLastRow},D${rowNumber},'学生明细'!$E$2:$E$${detailLastRow},E${rowNumber})-SUM(F${rowNumber}:I${rowNumber})`,
      result: counts.其他,
    };
    const denominator = data.students.length - counts.免交;
    const completionRate = denominator > 0 ? (counts.已提交 + counts.迟交) / denominator : 0;
    row.getCell(11).value = {
      formula: `IFERROR((F${rowNumber}+G${rowNumber})/(COUNTIFS('学生明细'!$B$2:$B$${detailLastRow},B${rowNumber},'学生明细'!$C$2:$C$${detailLastRow},C${rowNumber},'学生明细'!$D$2:$D$${detailLastRow},D${rowNumber},'学生明细'!$E$2:$E$${detailLastRow},E${rowNumber})-I${rowNumber}),0)`,
      result: completionRate,
    };
    row.getCell(11).numFmt = '0.0%';
    row.eachCell((cell, col) => {
      cell.font = { name: 'Microsoft YaHei', size: 10, color: COLORS.navy };
      cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'left' : 'center', wrapText: col === 3 };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.border } } };
    });
    row.height = 28;
  });

  if (data.assignments.length) {
    summary.autoFilter = { from: 'A8', to: `K${8 + data.assignments.length}` };
    detail.autoFilter = { from: 'A1', to: `F${detailLastRow}` };
  }
  summary.columns = [8, 13, 34, 14, 20, 11, 11, 11, 11, 11, 12].map(width => ({ width }));
  detail.columns = [16, 13, 34, 14, 20, 13].map(width => ({ width }));
  summary.views = [{ state: 'frozen', ySplit: 8, showGridLines: false }];
  detail.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  summary.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  detail.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  return { workbook, data };
}

async function buildHomeworkWorkbookBuffer(input) {
  const { workbook } = await createHomeworkWorkbook(input);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildHomeworkWorkbookBuffer,
  createHomeworkWorkbook,
  normalizePayload,
  safeFilePart,
};
