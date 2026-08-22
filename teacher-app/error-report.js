(function () {
  'use strict';

  let activeDialog = null;
  let showingGlobalError = false;

  function text(value) { return String(value == null ? '' : value).trim(); }

  function redact(value) {
    return text(value)
      .replace(/((?:password|passwd|token|secret|api[_-]?key|connection[_-]?key)\s*[:=]\s*)[^\s,;&]+/gi, '$1[已隐藏]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[已隐藏]');
  }

  function errorDetails(error) {
    if (!error) return '未提供底层错误信息';
    if (typeof error === 'string') return redact(error);
    const lines = [];
    const message = redact(error.message || error.errMsg || error.reason || error);
    if (message) lines.push(message);
    if (error.code) lines.push(`错误代码：${redact(error.code)}`);
    if (error.status || error.statusCode) lines.push(`状态码：${error.status || error.statusCode}`);
    if (error.stack && !String(error.stack).startsWith(message)) lines.push(redact(error.stack));
    return lines.join('\n') || '未知错误';
  }

  function buildReport(options) {
    const now = new Date();
    const suggestions = Array.isArray(options.suggestions) ? options.suggestions.filter(Boolean) : [];
    return [
      '班达教师端错误报告',
      `发生时间：${now.toLocaleString('zh-CN')} (${now.toISOString()})`,
      `错误场景：${text(options.context) || '教师端运行'}`,
      `错误标题：${text(options.title) || '操作失败'}`,
      `页面：${location.pathname || 'index.html'}`,
      `系统信息：${navigator.userAgent}`,
      '',
      '详细信息：',
      errorDetails(options.error || options.detail),
      suggestions.length ? `\n建议检查：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }

  function ensureStyle() {
    if (document.getElementById('clientErrorReporterStyle')) return;
    const style = document.createElement('style');
    style.id = 'clientErrorReporterStyle';
    style.textContent = `
      .client-error-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.38);backdrop-filter:blur(8px);animation:modal-backdrop-in .2s ease-out both}
      .client-error-card{width:min(620px,calc(100vw - 40px));max-height:min(680px,calc(100vh - 40px));overflow:auto;padding:24px;border:1px solid rgba(128,128,128,.24);border-radius:18px;color:var(--label,#1d1d1f);background:var(--surface-solid,#fff);box-shadow:0 24px 70px rgba(0,0,0,.24);animation:modal-card-in .26s cubic-bezier(.22,1,.36,1) both}
      .client-error-mark{display:grid;width:44px;height:44px;place-items:center;border-radius:13px;color:#fff;background:#ff3b30;font-size:22px;font-weight:800}
      .client-error-head{display:flex;align-items:flex-start;gap:13px}.client-error-head>div{min-width:0;flex:1}.client-error-head h2{margin:0;font-size:19px;line-height:1.3}.client-error-head p{margin:5px 0 0;color:var(--secondary-label,#6e6e73);font-size:12px;line-height:1.55}
      .client-error-guide{margin:17px 0 0;padding:12px 14px;border-radius:11px;color:var(--secondary-label,#6e6e73);background:rgba(255,149,0,.1);font-size:12px;line-height:1.65}.client-error-guide strong{display:block;color:var(--label,#1d1d1f);margin-bottom:2px}
      .client-error-detail{margin-top:14px}.client-error-detail summary{cursor:pointer;color:var(--secondary-label,#6e6e73);font-size:12px;font-weight:650}.client-error-detail pre{max-height:230px;overflow:auto;margin:9px 0 0;padding:13px;border-radius:10px;color:var(--label,#1d1d1f);background:rgba(118,118,128,.09);font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
      .client-error-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:19px}.client-error-actions button{min-height:38px;padding:0 15px;border:1px solid rgba(128,128,128,.28);border-radius:9px;color:var(--label,#1d1d1f);background:transparent;font-size:12px;font-weight:650}.client-error-actions .client-error-copy{color:#fff;border-color:#0a84ff;background:#0a84ff}.client-error-copy.is-copied{border-color:#34c759;background:#34c759}
      @media(prefers-color-scheme:dark){.client-error-card{color:#f5f5f7;background:#2c2c2e}.client-error-detail pre{color:#f5f5f7;background:rgba(255,255,255,.07)}}`;
    document.head.appendChild(style);
  }

  async function copyReport(report, button) {
    try {
      if (window.api && typeof window.api.copyText === 'function') await window.api.copyText(report);
      else if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(report);
      else {
        const area = document.createElement('textarea');
        area.value = report; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      }
      button.textContent = '已复制，请提交管理员';
      button.classList.add('is-copied');
    } catch (_error) {
      button.textContent = '复制失败，请展开详情手动复制';
    }
  }

  function show(options) {
    options = options || {};
    ensureStyle();
    if (activeDialog) activeDialog.remove();
    const report = buildReport(options);
    const overlay = document.createElement('div');
    overlay.className = 'client-error-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('section'); card.className = 'client-error-card';
    const head = document.createElement('div'); head.className = 'client-error-head';
    const mark = document.createElement('span'); mark.className = 'client-error-mark'; mark.textContent = '!';
    const copy = document.createElement('div');
    const title = document.createElement('h2'); title.textContent = text(options.title) || '操作失败';
    const message = document.createElement('p'); message.textContent = text(options.message) || errorDetails(options.error || options.detail).split('\n')[0];
    copy.append(title, message); head.append(mark, copy);
    const guide = document.createElement('div'); guide.className = 'client-error-guide';
    guide.innerHTML = '<strong>需要管理员协助？</strong>点击下方“复制错误信息”，然后将复制的完整内容提交给系统管理员，以便快速定位问题。';
    if (Array.isArray(options.suggestions) && options.suggestions.length) {
      const list = document.createElement('ol');
      options.suggestions.forEach(item => { const li = document.createElement('li'); li.textContent = item; list.appendChild(li); });
      guide.appendChild(list);
    }
    const details = document.createElement('details'); details.className = 'client-error-detail';
    const summary = document.createElement('summary'); summary.textContent = '查看完整错误详情';
    const pre = document.createElement('pre'); pre.textContent = report;
    details.append(summary, pre);
    const actions = document.createElement('div'); actions.className = 'client-error-actions';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭';
    const copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'client-error-copy'; copyButton.textContent = '复制错误信息';
    close.addEventListener('click', () => { overlay.remove(); activeDialog = null; });
    copyButton.addEventListener('click', () => copyReport(report, copyButton));
    actions.append(close, copyButton); card.append(head, guide, details, actions); overlay.appendChild(card); document.body.appendChild(overlay);
    activeDialog = overlay;
    copyButton.focus();
    return report;
  }

  window.clientErrors = { show, buildReport };
  window.addEventListener('error', event => {
    if (showingGlobalError) return;
    showingGlobalError = true;
    show({ title:'教师端发生运行错误', message:'软件遇到未预期的问题，部分功能可能暂时不可用。', context:'页面运行', error:event.error || event.message, suggestions:['关闭当前提示后重试刚才的操作', '如果问题重复出现，请复制错误信息并提交给管理员'] });
    setTimeout(() => { showingGlobalError = false; }, 0);
  });
  window.addEventListener('unhandledrejection', event => {
    if (showingGlobalError) return;
    showingGlobalError = true;
    show({ title:'教师端请求处理失败', message:'请求没有正常完成，请检查网络或服务状态。', context:'异步请求', error:event.reason, suggestions:['检查教师端与教室端或云服务的网络连接', '稍后重试；若仍失败，请复制错误信息提交管理员'] });
    setTimeout(() => { showingGlobalError = false; }, 0);
  });
})();
