const { sessionStore } = require('../utils/session');
const scanAction = require('../utils/scan-action');

Component({
  data: {
    selected: 0,
    items: [
      { key:'home',text:'首页',path:'/pages/home/index',icon:'/assets/tabbar/home.png',activeIcon:'/assets/tabbar/home-active.png' },
      { key:'scan',text:'扫码',scan:true,icon:'/assets/tabbar/scan.png',activeIcon:'/assets/tabbar/scan-active.png' },
      { key:'profile',text:'我的',path:'/pages/profile/index',icon:'/assets/tabbar/profile.png',activeIcon:'/assets/tabbar/profile-active.png' },
    ],
  },
  lifetimes: { attached() { this.refresh(); } },
  methods: {
    refresh(selectedKey) {
      sessionStore.load();
      const items = this.data.items;
      const found = items.findIndex(item => item.key === selectedKey);
      const selected = found >= 0 ? found : this.data.selected;
      this.setData({ selected });
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
