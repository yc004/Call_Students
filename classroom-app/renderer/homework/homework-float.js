(function () {
  var api = window.api || {};
  var expanded = false;
  var menu = document.getElementById('floatMenu');
  var toggle = document.getElementById('toggleMenu');
  var unreadDot = document.getElementById('unreadDot');
  var shell = document.getElementById('floatShell');
  var closeTimer = null;
  function renderUnread(unread) {
    unreadDot.hidden = !unread;
    toggle.classList.toggle('has-unread', !!unread);
    toggle.dataset.unread = unread ? 'true' : 'false';
    updateToggleLabel();
  }
  function updateToggleLabel() { toggle.setAttribute('aria-label', (expanded ? '收起今日安排菜单' : '展开今日安排菜单') + (toggle.dataset.unread === 'true' ? '，有新内容' : '')); }
  if (api.getHomeworkUnread) api.getHomeworkUnread().then(renderUnread).catch(function () {});
  if (api.onHomeworkUnreadChanged) api.onHomeworkUnreadChanged(renderUnread);
  function setExpanded(next) {
    clearTimeout(closeTimer);
    expanded = next;
    toggle.setAttribute('aria-expanded', String(next));
    updateToggleLabel();
    if (next) {
      // 先扩大透明窗口，再在下一帧播放两个子球的弹出动画。
      if (api.setHomeworkFloatExpanded) api.setHomeworkFloatExpanded(true);
      menu.hidden = false;
      requestAnimationFrame(function () { shell.classList.add('expanded'); });
    } else {
      // 先播放回收动画，结束后再缩小窗口，避免小球瞬间被裁掉。
      shell.classList.remove('expanded');
      closeTimer = setTimeout(function () {
        menu.hidden = true;
        if (api.setHomeworkFloatExpanded) api.setHomeworkFloatExpanded(false);
      }, 260);
    }
  }
  // 轻触展开，按住移动超过少量距离即拖动窗口，避免点击与拖动互相抢手势。
  var drag = null;
  toggle.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    drag = { x: event.screenX, y: event.screenY, moved: false };
    toggle.setPointerCapture && toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener('pointermove', function (event) {
    if (!drag) return;
    var dx = event.screenX - drag.x;
    var dy = event.screenY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    toggle.classList.add('dragging');
    if (api.moveHomeworkFloat) api.moveHomeworkFloat(dx, dy);
    drag.x = event.screenX;
    drag.y = event.screenY;
  });
  function finishPointer(event) {
    if (!drag) return;
    var wasMoved = drag.moved;
    drag = null;
    toggle.classList.remove('dragging');
    if (toggle.hasPointerCapture && toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
    if (!wasMoved) setExpanded(!expanded);
  }
  toggle.addEventListener('pointerup', finishPointer);
  toggle.addEventListener('pointercancel', function () { drag = null; toggle.classList.remove('dragging'); });
  document.getElementById('openWidget').addEventListener('click', function () { renderUnread(false); if (api.openHomeworkWidget) api.openHomeworkWidget(); setExpanded(false); });
  document.getElementById('openBoard').addEventListener('click', function () { if (api.openHomeworkBoard) api.openHomeworkBoard(); setExpanded(false); });
})();
