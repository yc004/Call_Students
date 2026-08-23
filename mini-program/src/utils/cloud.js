const CLOUD_SESSION_VERSION = 1;

function normalizeServerUrl(value, useHttps) {
  let raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('请填写服务器地址');
  const selectedScheme = typeof useHttps === 'boolean' ? (useHttps ? 'https' : 'http') : '';
  if (selectedScheme) raw = raw.replace(/^https?:\/\//i, '');
  if (!/^https?:\/\//i.test(raw)) raw = `${selectedScheme || 'https'}://${raw}`;
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
  return `${scheme}://${authority}`;
}

function explainNetworkError(error) {
  const raw = String(error && (error.errMsg || error.message) || error || '');
  if (/ERR_SSL_PROTOCOL_ERROR|SSL_ERROR|wrong version number/i.test(raw)) {
    return new Error('HTTPS 连接失败：服务器当前可能只提供 HTTP。请取消“使用 HTTPS 安全连接”，或为服务器配置有效的 HTTPS 证书。');
  }
  if (/ERR_CERT|certificate/i.test(raw)) {
    return new Error('HTTPS 证书校验失败：请使用受信任的域名和证书，或在局域网测试时取消“使用 HTTPS 安全连接”。');
  }
  if (/ERR_CONNECTION_REFUSED|connection refused/i.test(raw)) {
    return new Error('服务器拒绝连接：请检查服务器是否启动、端口是否开放，以及手机是否能访问该局域网地址。');
  }
  return new Error(raw || '无法连接云服务器');
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
      fail: error => reject(explainNetworkError(error)),
    });
  });
}

function normalizeMiniProgramAuth(data, serverUrl) {
  const user = (data && data.user) || {};
  const name = String(user.name || user.nickname || '').trim().slice(0, 40);
  const nickname = String(user.nickname || user.name || '').trim().slice(0, 40);
  const avatarUrl = String(user.avatarUrl || '').trim().slice(0, 500);
  const organization = (data && data.organization) || {};
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
    mustChangePassword:!!user.mustChangePassword,
    organization:{
      id:String(organization.id || ''),
      name:String(organization.name || '组织空间').trim().slice(0, 120),
      shortName:String(organization.shortName || organization.name || '组织').trim().slice(0, 40),
      logoUrl:String(organization.logoUrl || '').trim().slice(0, 500),
      primaryColor:/^#[0-9A-Fa-f]{6}$/.test(String(organization.primaryColor || '')) ? String(organization.primaryColor).toUpperCase() : '#2563EB',
    },
  };
}

async function loginMiniProgramAccount({ serverUrl, useHttps = true, loginName, password, deviceName }) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl, useHttps);
  const data = await request(normalizedServerUrl, '/api/v1/auth/mini-program/login', {
    method:'POST',
    data:{ loginName:String(loginName || '').trim(), password:String(password || ''), deviceName:deviceName || '微信小程序' },
  });
  return normalizeMiniProgramAuth(data, normalizedServerUrl);
}

async function completeTeacherProfile(cloud, { name, nickname, newPassword }) {
  const data = await request(cloud.serverUrl, '/api/v1/teacher/profile', {
    method:'PATCH', token:cloud.accessToken,
    data:{ name:String(name || '').trim(), nickname:String(nickname || '').trim(), newPassword:String(newPassword || '') },
  });
  const normalized = normalizeMiniProgramAuth({ ...data, accessToken:cloud.accessToken, accessExpiresAt:cloud.accessExpiresAt, refreshToken:cloud.refreshToken, expiresAt:cloud.expiresAt }, cloud.serverUrl);
  return { ...cloud, ...normalized };
}

async function updateTeacherProfile(cloud, { name, currentPassword, newPassword } = {}) {
  const payload = {};
  if (String(name || '').trim()) {
    payload.name = String(name).trim();
    payload.nickname = String(name).trim();
  }
  if (newPassword) {
    payload.currentPassword = String(currentPassword || '');
    payload.newPassword = String(newPassword);
  }
  const data = await request(cloud.serverUrl, '/api/v1/teacher/profile', { method:'PATCH', token:cloud.accessToken, data:payload });
  const normalized = normalizeMiniProgramAuth({ ...data, accessToken:cloud.accessToken, accessExpiresAt:cloud.accessExpiresAt, refreshToken:cloud.refreshToken, expiresAt:cloud.expiresAt }, cloud.serverUrl);
  return { ...cloud, ...normalized };
}

async function getTeacherProfile(cloud) {
  const data = await request(cloud.serverUrl, '/api/v1/teacher/profile', { token:cloud.accessToken });
  const normalized = normalizeMiniProgramAuth({ ...data, accessToken:cloud.accessToken, accessExpiresAt:cloud.accessExpiresAt, refreshToken:cloud.refreshToken, expiresAt:cloud.expiresAt }, cloud.serverUrl);
  return { ...cloud, ...normalized };
}

function uploadAvatar(cloud, filePath) {
  return new Promise((resolve, reject) => {
    if (!cloud || !cloud.accessToken) { reject(new Error('云服务登录已失效')); return; }
    if (!filePath) { reject(new Error('请先选择头像')); return; }
    const lowerPath = String(filePath).toLowerCase();
    const contentType = lowerPath.includes('.png') ? 'image/png' : (lowerPath.includes('.webp') ? 'image/webp' : 'image/jpeg');
    wx.getFileSystemManager().readFile({
      filePath:String(filePath),
      success:file => wx.request({
        url:`${normalizeServerUrl(cloud.serverUrl)}/api/v1/teacher/avatar`, method:'POST', data:file.data,
        header:{ 'content-type':contentType, 'x-banda-client':'mini-program', 'x-banda-protocol':'1', authorization:`Bearer ${cloud.accessToken}` },
        timeout:15000,
        success:response => {
          const data = response.data || {};
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
          else reject(Object.assign(new Error(data.message || `头像上传失败（${response.statusCode}）`), { code:data.error || 'CLOUD_REQUEST_FAILED' }));
        },
        fail:error => reject(new Error(error && error.errMsg || '头像上传失败')),
      }),
      fail:error => reject(new Error(error && error.errMsg || '无法读取头像文件')),
    });
  });
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
  return type === 'set-face-system' || type.startsWith('face-') || type.startsWith('pending-face') || type.startsWith('label-face');
}

module.exports = { normalizeServerUrl, request, loginMiniProgramAccount, completeTeacherProfile, updateTeacherProfile, getTeacherProfile, uploadAvatar, listClassrooms, refreshSession, leaveClassroom, logout, isFaceMessage, explainNetworkError };
