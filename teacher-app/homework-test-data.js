'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HomeworkTestData = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const ID_PREFIX = 'ai-homework-test-';
  const TITLES = [
    '基础知识巩固练习', '课堂重点整理', '错题订正与反思', '单元综合训练',
    '核心概念应用题', '阶段复习检测', '拓展探究任务', '周末能力提升',
    '易错题专项练习', '学习小结与自评', '综合实践作业', '阶段性复习卷',
  ];

  function uniqueText(values) {
    return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
  }

  function dateText(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function deadlineText(date) { return `${dateText(date)}T20:00`; }

  function stableRoomKey(value) {
    let hash = 2166136261;
    for (const char of String(value || 'classroom')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function statusFor(studentIndex, assignmentIndex) {
    if (studentIndex === 0) return assignmentIndex === 8 ? '迟交' : '已提交';
    if (studentIndex === 1) return assignmentIndex % 5 === 0 ? '迟交' : (assignmentIndex % 4 === 1 ? '未提交' : '已提交');
    if (studentIndex === 2) return assignmentIndex % 4 === 1 ? '未提交' : '已提交';
    if (studentIndex === 3) return assignmentIndex % 3 === 0 ? '已提交' : '未提交';
    if ((studentIndex + assignmentIndex) % 11 === 0) return '免交';
    if ((studentIndex * 3 + assignmentIndex * 2) % 7 === 0) return '迟交';
    if ((studentIndex * 5 + assignmentIndex) % 6 <= 1) return '未提交';
    return '已提交';
  }

  function build(options = {}) {
    const students = Array.isArray(options.students) ? options.students.filter(student => student && student.id && student.name) : [];
    const subjects = uniqueText(options.subjects);
    if (!students.length) throw new Error('当前班级没有学生，无法生成作业提交样本');
    if (!subjects.length) throw new Error('当前教师没有已授权的授课科目');
    const now = options.now instanceof Date ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('测试日期无效');
    const roomKey = stableRoomKey(options.roomKey);
    const offsets = [-42, -38, -34, -30, -26, -22, -18, -14, -10, -6, 2, 6];
    return offsets.map((offset, index) => {
      const publishAt = new Date(now);
      publishAt.setHours(12, 0, 0, 0);
      publishAt.setDate(publishAt.getDate() + offset);
      const deadline = new Date(publishAt);
      deadline.setDate(deadline.getDate() + 2);
      const submissions = {};
      students.forEach((student, studentIndex) => { submissions[String(student.id)] = statusFor(studentIndex, index); });
      const subject = subjects[index % subjects.length];
      return {
        id:`${ID_PREFIX}${roomKey}-${String(index + 1).padStart(2, '0')}`,
        subject, type:'homework', title:`[AI测试] ${subject}｜${TITLES[index]}`,
        date:dateText(publishAt), deadline:deadlineText(deadline), source:'teacher', submissions,
      };
    });
  }

  function isTestAssignment(assignment) {
    return String(assignment && assignment.id || '').startsWith(ID_PREFIX);
  }

  return { ID_PREFIX, build, isTestAssignment };
});
