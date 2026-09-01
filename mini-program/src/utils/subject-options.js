const OPTIONS = Object.freeze([
  '语文', '数学', '英语', '物理', '化学', '生物', '道德与法治', '历史', '地理',
  '科学', '信息科技', '通用技术', '体育与健康', '音乐', '美术', '劳动',
  '综合实践活动', '心理健康', '班会', '日语', '俄语',
]);

const pendingPickers = new Map();
let pickerSequence = 0;

function normalize(values = []) {
  return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
}

function merge(values = [], available) {
  return Array.from(new Set([...(Array.isArray(available) ? normalize(available) : OPTIONS), ...normalize(values)]));
}

function createPickerId() {
  pickerSequence = (pickerSequence + 1) % 1000000;
  return `subject-${Date.now().toString(36)}-${pickerSequence.toString(36)}`;
}

function getPicker(id) {
  const picker = pendingPickers.get(String(id || ''));
  return picker ? { title:picker.title, selected:[...picker.selected], options:[...picker.options] } : null;
}

function finishPicker(id, values) {
  const key = String(id || '');
  const picker = pendingPickers.get(key);
  if (!picker) return false;
  pendingPickers.delete(key);
  picker.resolve(values === null ? null : normalize(values));
  return true;
}

function choose(selected = [], title = '选择授课科目', available) {
  return new Promise((resolve, reject) => {
    const pickerId = createPickerId();
    pendingPickers.set(pickerId, { resolve, reject, title, selected:normalize(selected), options:merge(selected,available) });
    wx.navigateTo({
      url: `/pages/subject-select/index?pickerId=${encodeURIComponent(pickerId)}`,
      events: {
        subjectPickerResult(payload) {
          finishPicker(pickerId, payload && payload.subjects);
        },
        subjectPickerCancel() {
          finishPicker(pickerId, null);
        },
      },
      success(result) {
        result.eventChannel.emit('subjectPickerInit', { title, selected: normalize(selected), options:merge(selected,available) });
      },
      fail(error) {
        pendingPickers.delete(pickerId);
        reject(error);
      },
    });
  });
}

module.exports = { OPTIONS, normalize, merge, choose, getPicker, finishPicker };
