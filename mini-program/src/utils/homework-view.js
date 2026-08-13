function parseLocalDateTime(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dateKey(value) {
  const date = parseLocalDateTime(value);
  if (!date) return 'undated';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function stageOf(assignment, now = Date.now()) {
  const deadline = parseLocalDateTime(assignment && assignment.deadline);
  return !deadline || deadline.getTime() > now ? 'pending' : 'closed';
}
function typeOf(item) { return item && item.type === 'notice' ? 'notice' : 'homework'; }
function deadlineLabel(key, now = Date.now()) {
  if (key === 'undated') return '未设置截止日期';
  const target = parseLocalDateTime(`${key}T00:00`); const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = target ? Math.round((target.getTime() - today.getTime()) / 86400000) : null;
  if (diff === 0) return '今天截止'; if (diff === 1) return '明天截止'; if (diff === -1) return '昨天截止';
  return target ? `${target.getMonth() + 1}月${target.getDate()}日截止` : key;
}
function groupByDeadline(assignments, stage, now = Date.now()) {
  const groups = new Map();
  (assignments || []).filter(item => !stage || stageOf(item, now) === stage).forEach(item => {
    const key = dateKey(item.deadline); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item);
  });
  const direction = stage === 'closed' ? -1 : 1;
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'undated') return 1; if (b === 'undated') return -1; return a.localeCompare(b) * direction;
  }).map(([key, items]) => ({ key, label: deadlineLabel(key, now), assignments: items }));
}
function submissionSummary(assignment, students) {
  const result = { submitted:0, pending:0, late:0, exempt:0, other:0, total:(students || []).length };
  (students || []).forEach(student => {
    const status = (assignment.submissions && assignment.submissions[student.id]) || '未提交';
    if (status === '已提交') result.submitted += 1; else if (status === '迟交') result.late += 1; else if (status === '未提交') result.pending += 1; else if (status === '免交') result.exempt += 1; else result.other += 1;
  });
  const required = Math.max(0, result.total - result.exempt); result.completed = result.submitted + result.late; result.rate = required ? Math.round(result.completed / required * 100) : 100;
  return result;
}
module.exports = { parseLocalDateTime, dateKey, stageOf, typeOf, deadlineLabel, groupByDeadline, submissionSummary };
