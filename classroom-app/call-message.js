'use strict';

function normalizeIncomingCall(message = {}) {
  const studentNames = (Array.isArray(message.studentNames) ? message.studentNames : [message.studentName])
    .map(name => String(name || '').trim().slice(0, 20))
    .filter(Boolean);
  if (!studentNames.length) return null;

  const completeStudentName = studentNames.join('、');
  const incomingStudentName = String(message.studentName || '').trim();
  let completeMessage = String(message.message || `${completeStudentName}同学，请到办公室`);
  if (incomingStudentName && incomingStudentName !== completeStudentName && completeMessage.includes(incomingStudentName)) {
    const completeTarget = incomingStudentName.endsWith('同学') ? `${completeStudentName}同学` : completeStudentName;
    completeMessage = completeMessage.split(incomingStudentName).join(completeTarget);
  }
  // 多人呼叫即使使用了不含 {name} 的自定义文案，也要先完整播报全部目标学生。
  if (studentNames.length > 1 && !completeMessage.includes(completeStudentName)) {
    completeMessage = `${completeStudentName}同学，${completeMessage}`;
  }

  return {
    studentName:completeStudentName,
    studentNames,
    message:completeMessage.slice(0, 20000),
  };
}

module.exports = { normalizeIncomingCall };
