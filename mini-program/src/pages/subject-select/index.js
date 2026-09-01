const subjects = require('../../utils/subject-options');

Page({
  data: { title: '选择授课科目', options: [], selected: [], selectedCount: 0 },

  onLoad(options) {
    this.confirmed = false;
    this.pickerId = options && options.pickerId || '';
    const channel = this.getOpenerEventChannel();
    this.channel = channel;
    const applyInitialValue = payload => {
      const selected = subjects.normalize(payload && payload.selected);
      const selectedSet = new Set(selected);
      const title = payload && payload.title || '选择授课科目';
      this.setData({ title, selected, selectedCount:selected.length, options:subjects.merge(selected,payload&&payload.options).map(name => ({ name, checked:selectedSet.has(name) })) });
      wx.setNavigationBarTitle({ title });
    };
    const pending = subjects.getPicker(this.pickerId);
    if (pending) applyInitialValue(pending);
    channel.on('subjectPickerInit', applyInitialValue);
  },

  onChange(event) {
    const selected = subjects.normalize(event.detail.value);
    this.setData({ selected, selectedCount: selected.length });
  },

  confirm() {
    if (!this.data.selected.length) {
      wx.showToast({ title: '请至少选择一个科目', icon: 'none' });
      return;
    }
    this.confirmed = true;
    subjects.finishPicker(this.pickerId, this.data.selected);
    this.channel.emit('subjectPickerResult', { subjects: this.data.selected });
    wx.navigateBack();
  },

  cancel() { wx.navigateBack(); },

  onUnload() {
    if (!this.confirmed) {
      subjects.finishPicker(this.pickerId, null);
      if (this.channel) this.channel.emit('subjectPickerCancel');
    }
  },
});
