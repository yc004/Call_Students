const CLOUD_SESSION_VERSION = 2;
const CLOUD_SERVER_PREFERENCE_KEY = 'banda_cloud_server_preference_v1';

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

function resolveCloudAssetUrl(serverUrl, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const base = normalizeServerUrl(serverUrl);
  if (raw.startsWith('/')) return `${base}${raw}`;
  const match = raw.match(/^https?:\/\/[^/]+(\/uploads\/[^?#]+(?:\?[^#]*)?)$/i);
  return match ? `${base}${match[1]}` : raw;
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
    let settled = false;
    let requestTask = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    };
    const timeout = Number(options.timeout) || 10000;
    const deadline = setTimeout(() => {
      if (requestTask && requestTask.abort) requestTask.abort();
      finish(reject, new Error('云服务请求超时，请检查网络后重试'));
    }, timeout + 1500);
    const header = { 'x-banda-client':'mini-program', 'x-banda-protocol':'2', ...(options.token ? { authorization:`Bearer ${options.token}` } : {}) };
    if (options.data !== undefined) header['content-type']='application/json';
    requestTask = wx.request({
      url: `${normalizeServerUrl(serverUrl)}${pathname}`,
      method: options.method || 'GET',
      header,
      data: options.data,
      timeout,
      success: response => {
        try {
          if (response.statusCode >= 200 && response.statusCode < 300) { const payload=response.data||{};finish(resolve,Object.prototype.hasOwnProperty.call(payload,'data')?payload.data:payload); }
          else finish(reject,Object.assign(new Error(response.data && response.data.error && response.data.error.message || `云服务请求失败（${response.statusCode}）`), { code:response.data && response.data.error && response.data.error.code || 'CLOUD_REQUEST_FAILED', statusCode:Number(response.statusCode) || 0 }));
        } catch (error) { finish(reject, error); }
      },
      fail: error => finish(reject, explainNetworkError(error)),
    });
  });
}

function normalizeMiniProgramAuth(data, serverUrl) {
  const user = (data && data.user) || {};
  const name = String(user.name || user.nickname || '').trim().slice(0, 40);
  const nickname = String(user.nickname || user.name || '').trim().slice(0, 40);
  const avatarUrl = resolveCloudAssetUrl(serverUrl, String(user.avatarUrl || '').trim()).slice(0, 500);
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
    wechatBound:!!user.wechatBound,
    organization:{
      id:String(organization.id || ''),
      name:String(organization.name || '组织空间').trim().slice(0, 120),
      shortName:String(organization.shortName || organization.name || '组织').trim().slice(0, 40),
      logoUrl:String(organization.logoUrl || '').trim().slice(0, 500),
      primaryColor:/^#[0-9A-Fa-f]{6}$/.test(String(organization.primaryColor || '')) ? String(organization.primaryColor).toUpperCase() : '#2563EB',
    },
  };
}

function rememberCloudServer(serverUrl,useHttps) {
  const normalized=normalizeServerUrl(serverUrl,useHttps);
  wx.setStorageSync(CLOUD_SERVER_PREFERENCE_KEY,{serverUrl:normalized,useHttps:normalized.startsWith('https://')});
  return normalized;
}

function loadRememberedCloudServer() {
  try {
    const value=wx.getStorageSync(CLOUD_SERVER_PREFERENCE_KEY)||{};
    const serverUrl=normalizeServerUrl(value.serverUrl);
    return{serverUrl:serverUrl.replace(/^https?:\/\//i,''),useHttps:serverUrl.startsWith('https://')};
  } catch (_error) { return{serverUrl:'',useHttps:false}; }
}

async function loginMiniProgramAccount({ serverUrl, useHttps = true, organizationSlug, loginName, password, deviceName }) {
  const normalizedServerUrl = normalizeServerUrl(serverUrl, useHttps);
  const data = await request(normalizedServerUrl, '/api/v2/auth/login', {
    method:'POST',
    data:{ organizationSlug:String(organizationSlug || '').trim(), loginName:String(loginName || '').trim(), password:String(password || ''), deviceName:deviceName || '微信小程序' },
  });
  return normalizeMiniProgramAuth(data, normalizedServerUrl);
}

async function loginWechatAccount({serverUrl,useHttps=true,code,deviceName}) {
  const normalizedServerUrl=normalizeServerUrl(serverUrl,useHttps);
  const data=await request(normalizedServerUrl,'/api/v2/auth/wechat/login',{
    method:'POST',data:{code:String(code||''),deviceName:deviceName||'微信小程序'},
  });
  return normalizeMiniProgramAuth(data,normalizedServerUrl);
}

async function bindWechat(cloud,code) {
  await request(cloud.serverUrl,'/api/v2/auth/wechat/bind',{method:'POST',token:cloud.accessToken,data:{code:String(code||''),deviceName:'微信小程序'}});
  return{...cloud,wechatBound:true};
}

async function completeTeacherProfile(cloud, { name, nickname, newPassword }) {
  const data = await request(cloud.serverUrl, '/api/v2/profile', {
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
  const data = await request(cloud.serverUrl, '/api/v2/profile', { method:'PATCH', token:cloud.accessToken, data:payload });
  const normalized = normalizeMiniProgramAuth({ ...data, accessToken:cloud.accessToken, accessExpiresAt:cloud.accessExpiresAt, refreshToken:cloud.refreshToken, expiresAt:cloud.expiresAt }, cloud.serverUrl);
  return { ...cloud, ...normalized };
}

async function getTeacherProfile(cloud) {
  const data = await request(cloud.serverUrl, '/api/v2/profile', { token:cloud.accessToken });
  const normalized = normalizeMiniProgramAuth({ ...data, accessToken:cloud.accessToken, accessExpiresAt:cloud.accessExpiresAt, refreshToken:cloud.refreshToken, expiresAt:cloud.expiresAt }, cloud.serverUrl);
  return { ...cloud, ...normalized };
}

function uploadAvatar(cloud, filePath) {
  return new Promise((resolve, reject) => {
    if (!cloud || !cloud.accessToken) { reject(new Error('云服务登录已失效')); return; }
    if (!filePath) { reject(new Error('请先选择头像')); return; }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback(value);
    };
    const deadline = setTimeout(() => finish(reject, new Error('头像上传超时，请检查网络后重试')), 18000);
    wx.getFileSystemManager().readFile({
      filePath:String(filePath),
      encoding:'base64',
      success:async file => {
        try {
          const result = await request(cloud.serverUrl, '/api/v2/profile/avatar', {
            method:'POST', token:cloud.accessToken, timeout:15000, data:{ base64:String(file.data || '') },
          });
          finish(resolve, { ...result, url:resolveCloudAssetUrl(cloud.serverUrl, result.url) });
        } catch (error) { finish(reject, error); }
      },
      fail:error => finish(reject, new Error(error && error.errMsg || '无法读取头像文件')),
    });
  });
}

async function listClassrooms(cloud) {
  const data = await request(cloud.serverUrl, '/api/v2/client/classrooms', { token:cloud.accessToken });
  return (data || []).map(room => ({
    id:room.id,
    cloudClassroomId:room.id,
    name:room.name || '云端教室',
    transport:'cloud',
    connectionCode:room.lan_connection_code || '',
    lanAddresses:Array.isArray(room.lan_addresses_json) ? room.lan_addresses_json : [],
    subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [],
    role:room.role,
    cloudStatus:room.device_status || 'offline',
    publicRelayAvailable:room.public_relay_available === true,
  }));
}
async function listSubjects(cloud){const data=await request(cloud.serverUrl,'/api/v2/client/subjects',{token:cloud.accessToken});return(data||[]).map(item=>item.name).filter(Boolean);}

async function refreshSession(cloud) {
  const key = `${normalizeServerUrl(cloud.serverUrl)}:${String(cloud.userId || '')}:${String(cloud.refreshToken || '').slice(-16)}`;
  if (refreshSession.pending && refreshSession.pending.key === key) return refreshSession.pending.promise;
  const promise = request(cloud.serverUrl, '/api/v2/auth/refresh', { method:'POST', data:{ refreshToken:cloud.refreshToken } })
    .then(data => ({ ...cloud, accessToken:data.accessToken, accessExpiresAt:data.accessExpiresAt, refreshToken:data.refreshToken, expiresAt:data.expiresAt }))
    .finally(() => {
      if (refreshSession.pending && refreshSession.pending.promise === promise) refreshSession.pending = null;
    });
  refreshSession.pending = { key, promise };
  return promise;
}

async function leaveClassroom(cloud, classroomId) {
  await request(cloud.serverUrl, `/api/v2/client/classrooms/${encodeURIComponent(classroomId)}/membership`, { method:'DELETE', token:cloud.accessToken });
  return true;
}

async function logout(cloud) {
  if (!cloud || !cloud.refreshToken) return;
  await request(cloud.serverUrl, '/api/v2/auth/logout', { method:'POST', data:{ refreshToken:cloud.refreshToken } });
}

function isFaceMessage(message) {
  const type = String(message && message.type || '');
  return type === 'set-face-system' || type.startsWith('face-') || type.startsWith('pending-face') || type.startsWith('label-face');
}

module.exports = { normalizeServerUrl, resolveCloudAssetUrl, rememberCloudServer, loadRememberedCloudServer, request, loginMiniProgramAccount, loginWechatAccount, bindWechat, completeTeacherProfile, updateTeacherProfile, getTeacherProfile, uploadAvatar, listClassrooms,listSubjects, refreshSession, leaveClassroom, logout, isFaceMessage, explainNetworkError };
