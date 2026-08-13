const TAB_ROUTES = {
  home: '/pages/home/index',
  scan: '/pages/scan/index',
  profile: '/pages/profile/index',
};

function replaceTab(name, options = null) {
  const route = TAB_ROUTES[name];
  if (!route) return;
  if (options) wx.setStorageSync('pendingTabAction', { name, options });
  wx.switchTab({
    url: route,
    fail(error) {
      console.warn(`[navigation] unable to open tab ${name}:`, error.errMsg || error);
    },
  });
}

function consumeTabAction(name) {
  const action = wx.getStorageSync('pendingTabAction');
  if (!action || action.name !== name) return null;
  wx.removeStorageSync('pendingTabAction');
  return action.options || null;
}

module.exports = { replaceTab, consumeTabAction };
