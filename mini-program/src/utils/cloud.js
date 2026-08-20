const CLOUD_SESSION_VERSION = 1;

function normalizeServerUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) throw new Error('服务器地址必须以 http:// 或 https:// 开头');
  const match = raw.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
  if (!match) throw new Error('服务器地址格式不正确');
  const scheme = match[1].toLowerCase();
  const authority = match[2] || '';
  const pathname = match[3] || '';
  const search = match[4] || '';
  const hash = match[5] || '';
  if (authority.includes('@')) throw new Error('服务器地址不能包含账号或密码');
  if (search || hash) throw new Error('服务器地址不能包含查询参数或片段');
  if (pathname && pathname !== '/') throw new Error('服务器地址不能包含路径');
  const host = authority.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/:\d+$/, '').toLowerCase();
  if (scheme !== 'https' && !['localhost','127.0.0.1','[::1]','::1'].includes(host)) throw new Error('云服务必须使用 HTTPS 加密连接');
  return `${scheme}://${authority}`;
}

function request(serverUrl, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'x-banda-client':'mini-program', 'x-banda-protocol':'1', ...(options.token ? { authorization:`Bearer ${options.token}` } : {}) };
    if (options.data !== undefined) header['content-type']='application/json';
    wx.request({
      url: `${normalizeServerUrl(serverUrl)}${pathname}`,
      method: options.method || 'GET',
      header,
      data: options.data,
      timeout: options.timeout || 10000,
      success: response => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data || {});
        else reject(Object.assign(new Error(response.data && response.data.message || `云服务请求失败（${response.statusCode}）`), { code:response.data && response.data.error || 'CLOUD_REQUEST_FAILED' }));
      },
      fail: error => reject(new Error(error && error.errMsg || '无法连接云服务器')),
    });
  });
}

function normalizeMiniProgramAuth(data, serverUrl) {
  const user = (data && data.user) || {};
  const name = String(user.name || user.nickname || '').trim().slice(0, 40);
  const nickname = String(user.nickname || user.name || '').trim().slice(0, 40);
  const avatarUrl = String(user.avatarUrl || '').trim().slice(0, 500);
  return {
    version:CLOUD_SESSION_VERSION,
    serverUrl:normalizeServerUrl(serverUrl),
    userId:String(user.id || ''),
    userName:name,
    accessToken:String(data.accessToken || ''),
    accessExpiresAt:String(data.accessExpiresAt || ''),
    refreshToken:String(data.refreshToken || ''),
    expiresAt:String(data.expiresAt || ''),
    nickname,
    avatarUrl,
  };
}

async function registerMiniProgramAccount({ serverUrl, key, loginName, password, nickname, avatarUrl, legacyConnectionId, deviceName, wechatCode }) {
  const data = await request(serverUrl, '/api/v1/auth/mini-program/register', {
    method:'POST',
    data:{
      key:String(key || '').trim(),
      loginName:String(loginName || '').trim(),
      password:String(password || ''),
      nickname:String(nickname || '').trim(),
      avatarUrl:avatarUrl ? String(avatarUrl) : undefined,
      legacyConnectionId:legacyConnectionId ? String(legacyConnectionId) : undefined,
      deviceName:deviceName || '微信小程序',
      wechatCode:wechatCode ? String(wechatCode) : undefined,
    },
  });
  return normalizeMiniProgramAuth(data, serverUrl);
}

async function loginMiniProgramAccount({ serverUrl, loginName, password, deviceName }) {
  const data = await request(serverUrl, '/api/v1/auth/mini-program/login', {
    method:'POST',
    data:{ loginName:String(loginName || '').trim(), password:String(password || ''), deviceName:deviceName || '微信小程序' },
  });
  return normalizeMiniProgramAuth(data, serverUrl);
}

async function wechatLogin({ serverUrl, code, deviceName }) {
  const data = await request(serverUrl, '/api/v1/auth/mini-program/wechat', {
    method:'POST',
    data:{ code:String(code || '').trim(), deviceName:deviceName || '微信小程序' },
  });
  return normalizeMiniProgramAuth(data, serverUrl);
}

function uploadAvatar(cloud, filePath) {
  return new Promise((resolve, reject) => {
    if (!cloud || !cloud.accessToken) { reject(new Error('云服务登录已失效')); return; }
    if (!filePath) { reject(new Error('请先选择头像')); return; }
    wx.uploadFile({
      url: `${normalizeServerUrl(cloud.serverUrl)}/api/v1/teacher/avatar`,
      filePath:String(filePath),
      name:'file',
      header: { 'x-banda-client':'mini-program', 'x-banda-protocol':'1', authorization:`Bearer ${cloud.accessToken}` },
      success: response => {
        let data = null;
        if (response.data) {
          try { data = JSON.parse(response.data); }
          catch (_error) { reject(new Error('头像上传返回数据无法解析')); return; }
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data || {});
        else reject(Object.assign(new Error(data && data.message || `头像上传失败（${response.statusCode}）`), { code:data && data.error || 'CLOUD_REQUEST_FAILED' }));
      },
      fail: error => reject(new Error(error && error.errMsg || '头像上传失败')),
    });
  });
}

async function enrollTeacher({ serverUrl, key, account }) {
  const data = await request(serverUrl, '/api/v1/enrollment/teacher/redeem', {
    method:'POST',
    data:{ key:String(key || '').trim(), name:account.name, legacyConnectionId:account.connectionId, deviceName:'微信小程序', deviceType:'mini-program' },
  });
  return {
    version:CLOUD_SESSION_VERSION,
    serverUrl:normalizeServerUrl(serverUrl),
    userId:data.user.id,
    userName:data.user.name,
    accessToken:data.accessToken,
    accessExpiresAt:data.accessExpiresAt,
    refreshToken:data.refreshToken,
    expiresAt:data.expiresAt,
  };
}

async function listClassrooms(cloud) {
  const data = await request(cloud.serverUrl, '/api/v1/classrooms', { token:cloud.accessToken });
  return (data.classrooms || []).map(room => ({
    id:room.id,
    cloudClassroomId:room.id,
    name:room.name || '云端教室',
    transport:'cloud',
    connectionCode:room.lan_connection_code || '',
    subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [],
    role:room.role,
    cloudStatus:room.device_status || 'offline',
  }));
}

async function refreshSession(cloud) {
  const data = await request(cloud.serverUrl, '/api/v1/auth/refresh', { method:'POST', data:{ refreshToken:cloud.refreshToken } });
  return { ...cloud, accessToken:data.accessToken, accessExpiresAt:data.accessExpiresAt, refreshToken:data.refreshToken, expiresAt:data.expiresAt };
}

async function leaveClassroom(cloud, classroomId) {
  await request(cloud.serverUrl, `/api/v1/classrooms/${encodeURIComponent(classroomId)}/membership`, { method:'DELETE', token:cloud.accessToken });
  return true;
}

async function logout(cloud) {
  if (!cloud || !cloud.refreshToken) return;
  await request(cloud.serverUrl, '/api/v1/auth/logout', { method:'POST', data:{ refreshToken:cloud.refreshToken } });
}

function isFaceMessage(message) {
  const type = String(message && message.type || '');
  return type.startsWith('face-') || type.startsWith('pending-face') || type.startsWith('label-face');
}

module.exports = { normalizeServerUrl, request, registerMiniProgramAccount, loginMiniProgramAccount, wechatLogin, uploadAvatar, enrollTeacher, listClassrooms, refreshSession, leaveClassroom, logout, isFaceMessage };
