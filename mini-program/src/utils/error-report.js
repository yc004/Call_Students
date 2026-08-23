'use strict';

let showing = false;

function safeText(value) { return String(value == null ? '' : value).trim(); }

function redact(value) {
  return safeText(value)
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
  if (error.stack) lines.push(redact(error.stack));
  return lines.join('\n') || '未知错误';
}

function runtimeInfo() {
  let system = {};
  let account = {};
  try { system = wx.getSystemInfoSync() || {}; } catch (_error) {}
  try { account = wx.getAccountInfoSync().miniProgram || {}; } catch (_error) {}
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  return {
    route: pages.length ? pages[pages.length - 1].route : '未知页面',
    version: account.version || account.envVersion || '开发版本',
    system: [system.platform, system.system, system.model, `微信 ${system.version || ''}`, `基础库 ${system.SDKVersion || ''}`].filter(Boolean).join(' · '),
  };
}

function buildReport(options = {}) {
  const now = new Date();
  const runtime = runtimeInfo();
  const suggestions = Array.isArray(options.suggestions) ? options.suggestions.filter(Boolean) : [];
  return [
    '班达错误报告（微信小程序）',
    `发生时间：${now.toLocaleString()} (${now.toISOString()})`,
    `错误场景：${safeText(options.context) || runtime.route}`,
    `错误标题：${safeText(options.title) || '操作失败'}`,
    `小程序版本：${runtime.version}`,
    `页面：${runtime.route}`,
    `设备信息：${runtime.system}`,
    '',
    '详细信息：',
    errorDetails(options.error || options.detail),
    suggestions.length ? `\n建议检查：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function show(options = {}) {
  if (showing) return buildReport(options);
  showing = true;
  const report = buildReport(options);
  const headline = safeText(options.message) || errorDetails(options.error || options.detail).split('\n')[0];
  const suggestions = Array.isArray(options.suggestions) ? options.suggestions.filter(Boolean) : [];
  const content = [
    headline,
    suggestions.length ? `\n建议检查：\n${suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    '\n如需管理员协助，请点击“复制信息”，并将复制的完整错误报告提交给管理员。',
  ].filter(Boolean).join('\n').slice(0, 1800);
  wx.showModal({
    title: safeText(options.title) || '操作失败',
    content,
    cancelText: '关闭',
    confirmText: '复制信息',
    success(result) {
      if (!result.confirm) return;
      wx.setClipboardData({
        data: report,
        success: () => wx.showToast({ title:'已复制，请提交管理员', icon:'none', duration:2200 }),
        fail: () => wx.showToast({ title:'复制失败，请截图提交', icon:'none' }),
      });
    },
    complete() { showing = false; },
  });
  return report;
}

module.exports = { show, buildReport, errorDetails };
