function two(value) { return String(value).padStart(2, '0'); }

function nextDeadlineDraft(now = new Date()) {
  const deadline = new Date(now.getTime());
  deadline.setSeconds(0, 0);
  if (deadline.getHours() >= 20) deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(20, 0, 0, 0);
  return {
    date:`${deadline.getFullYear()}-${two(deadline.getMonth() + 1)}-${two(deadline.getDate())}`,
    time:'20:00',
  };
}

function deadlineValue(date, time) { return `${date}T${time}`; }

function isFutureDeadline(value, now = Date.now()) {
  const deadline = new Date(value).getTime();
  return Number.isFinite(deadline) && deadline > now;
}

function mutationSatisfied(mutation, snapshot) {
  const assignments = snapshot && Array.isArray(snapshot.assignments) ? snapshot.assignments : [];
  if (!mutation) return false;
  if (mutation.action === 'delete') return !assignments.some(item => item.id === mutation.assignmentId);
  if (mutation.action === 'submission') {
    const assignment = assignments.find(item => item.id === mutation.assignmentId);
    return !!assignment && assignment.submissions && assignment.submissions[mutation.studentId] === mutation.status;
  }
  const assignment = assignments.find(item => item.id === mutation.assignmentId);
  if (!assignment) return false;
  return assignment.title === mutation.title
    && assignment.subject === mutation.subject
    && assignment.deadline === mutation.deadline
    && (assignment.type === 'notice' ? 'notice' : 'homework') === mutation.type;
}

module.exports = { deadlineValue, isFutureDeadline, mutationSatisfied, nextDeadlineDraft };
