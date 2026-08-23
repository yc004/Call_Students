'use strict';

const connectionCode = require('./connection-code');
const errorReport = require('./error-report');

function safeText(value) { return String(value == null ? '' : value).trim(); }

function isPrivateIpv4(host) {
  const parts = safeText(host).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254);
}

function isCellular(networkType) {
  return /^(2g|3g|4g|5g)$/i.test(safeText(networkType));
}

function targetFromRoom(room) {
  if (!room || room.transport === 'cloud') return '';
  if (room.__resolvedHost) return safeText(room.__resolvedHost);
  try { return connectionCode.decode(room.connectionCode); } catch (_error) { return ''; }
}

function readNetworkType() {
  return new Promise(resolve => {
    if (typeof wx === 'undefined' || typeof wx.getNetworkType !== 'function') { resolve('unknown'); return; }
    wx.getNetworkType({
      success:result => resolve(safeText(result && result.networkType).toLowerCase() || 'unknown'),
      fail:() => resolve('unknown'),
    });
  });
}

async function diagnose(error, options = {}) {
  const raw = safeText(error && (error.errMsg || error.message) || error);
  const target = safeText(options.target) || targetFromRoom(options.room);
  const networkType = safeText(options.networkType).toLowerCase() || await readNetworkType();
  const privateTarget = isPrivateIpv4(target);
  const hotspotLikely = privateTarget && isCellular(networkType);
  const domainBlocked = /domain|合法域名|url not in domain list/i.test(raw);
  const noNetwork = networkType === 'none';
  const networkLabel = networkType === 'unknown' ? '未知' : networkType.toUpperCase();

  if (hotspotLikely) {
    return {
      kind:'phone-hotspot-host',
      title:'手机热点可能阻止了连接',
      message:`检测到当前手机网络为 ${networkLabel}，而教室端目标 ${target} 是局域网地址。教室电脑可能连接了这台手机开启的热点；微信可能不会把热点宿主手机与热点内设备判定为同一局域网，因此会拦截小程序连接。`,
      suggestions:[
        '关闭当前手机提供的热点，让手机和教室电脑同时连接同一个普通 Wi‑Fi 或路由器',
        '如果只能使用热点，请让另一台手机或设备提供热点，再让本手机和教室电脑都连接该热点',
        '切换网络后返回小程序重新扫码，不要只在原网络上反复重试',
        '若仍失败，再检查微信本地网络权限、电脑防火墙和 TCP 3456 端口',
      ],
      target, networkType, hotspotLikely:true,
    };
  }

  if (domainBlocked) {
    return {
      kind:'wechat-policy',
      title:'微信阻止了局域网连接',
      message:'微信拒绝了当前局域网 WebSocket 地址。正式版中，开发工具的“不校验合法域名”设置不会生效；请确认当前平台支持所使用的局域网连接方式。',
      suggestions:['确认手机与教室电脑连接同一个普通 Wi‑Fi', '不要让运行小程序的手机同时作为教室电脑的热点', '确认微信已获得本地网络权限后重新扫码'],
      target, networkType, hotspotLikely:false,
    };
  }

  if (noNetwork) {
    return {
      kind:'offline', title:'手机当前没有网络', message:'微信报告当前设备没有可用网络，无法查找局域网中的教室电脑。',
      suggestions:['连接 Wi‑Fi 后重新扫码', '确认系统没有限制微信使用网络'], target, networkType, hotspotLikely:false,
    };
  }

  return {
    kind:'lan-unreachable',
    title:'无法连接教室',
    message:privateTarget
      ? `没有收到教室端 ${target} 的有效响应。当前手机网络为 ${networkLabel}，暂时无法确认是网络隔离、教室端离线还是防火墙拦截。`
      : '没有收到教室端的有效响应，请检查局域网连接和教室端状态。',
    suggestions:['确认手机和教室电脑连接同一个非访客 Wi‑Fi', '确认教室端软件已经启动且连接码没有变化', '确认微信已获得本地网络权限', '允许 TCP 3456 端口通过电脑防火墙，并暂时关闭 VPN、代理或网络加速'],
    target, networkType, hotspotLikely:false,
  };
}

async function showFailure(options = {}) {
  const result = await diagnose(options.error, options);
  const technical = [
    safeText(options.error && (options.error.errMsg || options.error.message) || options.error),
    result.target ? `目标：${result.target}:3456` : '',
    `手机网络：${result.networkType || 'unknown'}`,
    options.attempts ? `尝试次数：${options.attempts}` : '',
    `诊断：${result.kind}`,
  ].filter(Boolean).join('\n');
  errorReport.show({
    title:result.title,
    context:options.context || '教室局域网连接',
    message:result.message,
    error:new Error(technical || result.message),
    suggestions:result.suggestions,
  });
  return result;
}

module.exports = { isPrivateIpv4, isCellular, targetFromRoom, readNetworkType, diagnose, showFailure };
