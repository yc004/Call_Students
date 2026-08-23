'use strict';

function normalizeServerUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) throw new Error('服务器地址必须以 http:// 或 https:// 开头');
  const parsed = new URL(raw);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('服务器地址不能包含账号、查询参数或片段');
  if (parsed.pathname !== '' && parsed.pathname !== '/') throw new Error('服务器地址不能包含路径');
  if (parsed.protocol !== 'https:' && !['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname)) throw new Error('云服务必须使用 HTTPS 加密连接');
  return parsed.toString().replace(/\/$/, '');
}

async function enrollClassroom({ serverUrl, key, deviceName, appVersion }) {
  const normalized = normalizeServerUrl(serverUrl);
  const response = await fetch(`${normalized}/api/v1/enrollment/classroom/redeem`, {
    method:'POST', headers:{ 'content-type':'application/json', 'x-banda-client':'classroom-desktop', 'x-banda-protocol':'1' },
    body:JSON.stringify({ key:String(key || '').trim(), deviceName:String(deviceName || '教室电脑'), appVersion:String(appVersion || '') }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `云服务接入失败（${response.status}）`);
  return { enabled:true, serverUrl:normalized, deviceId:result.deviceId, classroomId:result.classroomId, deviceToken:result.deviceToken };
}

async function revokeClassroom(config) {
  if (!config || !config.deviceToken) return;
  await fetch(`${normalizeServerUrl(config.serverUrl)}/api/v1/classroom-device/revoke`, { method:'POST', headers:{'content-type':'application/json','x-banda-client':'classroom-desktop','x-banda-protocol':'1'}, body:JSON.stringify({ deviceToken:config.deviceToken }) });
}

module.exports = { normalizeServerUrl, enrollClassroom, revokeClassroom };
