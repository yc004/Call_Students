(function () {
  var api = window.api || {};
  var list = document.getElementById('assignmentList');
  var noticeList = document.getElementById('noticeList');
  var empty = document.getElementById('emptyState');
  var dateLabel = document.getElementById('dateLabel');
  var classLabel = document.getElementById('classLabel');
  function today() { return new Date().toISOString().slice(0, 10); }
  function formatDate(value) { return new Date(value + 'T00:00:00').toLocaleDateString('zh-CN', { month:'long', day:'numeric', weekday:'long' }); }
  function esc(value) { var node = document.createElement('div'); node.textContent = value || ''; return node.innerHTML; }
  function isDisplayPhase(item) { return !item.deadline || new Date(item.deadline).getTime() > Date.now(); }
  function deadlineText(value) { if (!value) return '等待老师设置截止时间'; var d = new Date(value); return Number.isNaN(d.getTime()) ? value : '截止 ' + d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }); }
  function groupBySubject(assignments) {
    var groups = new Map();
    assignments.forEach(function (item) {
      var subject = String(item.subject || '未分类').trim() || '未分类';
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(item);
    });
    return Array.from(groups.entries()).map(function (entry) { return { subject: entry[0], assignments: entry[1] }; });
  }
  function renderSubjectGroup(group) {
    var countText = group.assignments.length === 1 ? '1 项作业' : group.assignments.length + ' 项作业';
    var items = group.assignments.map(function (item) {
      return '<li class="assignment-item"><h2 class="title">' + esc(item.title || '未命名作业') + '</h2><span class="deadline">' + esc(deadlineText(item.deadline)) + '</span></li>';
    }).join('');
    return '<article class="subject-group"><div class="subject-group-head"><span class="subject">' + esc(group.subject) + '</span><span class="assignment-count">' + countText + '</span></div><ul class="assignment-items">' + items + '</ul></article>';
  }
  function renderNotices(notices) {
    if (!notices.length) return '';
    return '<div class="notice-heading"><strong>班级通知</strong><span>' + notices.length + ' 条</span></div>' + notices.map(function (item) {
      return '<article class="notice-item"><span class="notice-subject">' + esc(item.subject || '班级') + '</span><h2>' + esc(item.title || '未命名通知') + '</h2><small>' + esc(deadlineText(item.deadline).replace('截止', '结束')) + '</small></article>';
    }).join('');
  }
  async function render() {
    dateLabel.textContent = formatDate(today());
    if (!api.getData) { classLabel.textContent = '预览环境未连接数据'; return; }
    try {
      var data = await api.getData(); var students = data.students || [];
      var active = (data.assignments || []).filter(function (item) { return isDisplayPhase(item); });
      var assignments = active.filter(function (item) { return item.type !== 'notice' && item.date === today(); });
      var notices = active.filter(function (item) { return item.type === 'notice'; });
      classLabel.textContent = (data.className || '未命名班级') + ' · ' + students.length + ' 名学生';
      empty.hidden = assignments.length > 0 || notices.length > 0;
      noticeList.innerHTML = renderNotices(notices);
      list.innerHTML = groupBySubject(assignments).map(renderSubjectGroup).join('');
    } catch (error) { console.error(error); classLabel.textContent = '同步失败，请点击刷新'; }
  }
  document.getElementById('closeWidget').addEventListener('click', function () { if (api.hideHomeworkWidget) api.hideHomeworkWidget(); });
  document.getElementById('refreshWidget').addEventListener('click', render);
  if (api.onDataChanged) api.onDataChanged(render);
  render();
  setInterval(render, 15000);
})();
