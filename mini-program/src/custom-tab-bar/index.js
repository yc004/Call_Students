const { sessionStore } = require('../utils/session');
const scanAction = require('../utils/scan-action');

function hueOf(color) {
  const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!match) return 147;
  const values = [0, 2, 4].map(index => Number.parseInt(match[1].slice(index, index + 2), 16) / 255);
  const max = Math.max(...values); const min = Math.min(...values); const delta = max - min;
  if (!delta) return 147;
  let hue = 0;
  if (max === values[0]) hue = 60 * (((values[1] - values[2]) / delta) % 6);
  else if (max === values[1]) hue = 60 * ((values[2] - values[0]) / delta + 2);
  else hue = 60 * ((values[0] - values[1]) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

function iconFilter(color) {
  let delta = hueOf(color) - 147;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return `hue-rotate(${Math.round(delta)}deg)`;
}

Component({
  data: {
    selected: 0,
    usageMode:'toc',
    modeColor:'#07C160',
    iconFilter:'hue-rotate(0deg)',
    items: [
      { key:'home',text:'首页',path:'/pages/home/index',icon:'/assets/tabbar/home.png',activeIcon:'/assets/tabbar/home-active.png' },
      { key:'scan',text:'扫码',scan:true,icon:'/assets/tabbar/scan.png',activeIcon:'/assets/tabbar/scan-active.png' },
      { key:'profile',text:'我的',path:'/pages/profile/index',icon:'/assets/tabbar/profile.png',activeIcon:'/assets/tabbar/profile-active.png' },
    ],
  },
  lifetimes: { attached() { this.refresh(); } },
  methods: {
    refresh(selectedKey) {
      const session = sessionStore.load();
      const items = this.data.items;
      const found = items.findIndex(item => item.key === selectedKey);
      const selected = found >= 0 ? found : this.data.selected;
      const usageMode=session&&session.cloud?'tob':'toc';
      const organization=session&&session.cloud&&session.cloud.organization||{};
      const modeColor=usageMode==='tob'?(organization.primaryColor||'#2563EB'):'#07C160';
      this.setData({ selected, usageMode, modeColor, iconFilter:iconFilter(modeColor) });
    },
    tapItem(event) {
      const item = this.data.items[Number(event.currentTarget.dataset.index)];
      if (!item) return;
      if (item.scan) {
        scanAction.start({ onComplete: () => {
          wx.switchTab({ url:'/pages/home/index' });
        } });
        return;
      }
      wx.switchTab({ url: item.path });
    },
  },
});
