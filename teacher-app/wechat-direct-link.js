'use strict';

function normalizeWechatDirectBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try { url = new URL(text); }
  catch (_error) { throw new Error('微信直达链接格式不正确'); }
  if (url.protocol !== 'https:') throw new Error('微信直达链接必须使用 HTTPS');
  if (url.username || url.password) throw new Error('微信直达链接不能包含账号或密码');
  url.hash = '';
  return url.toString();
}

function createTeacherPairingDirectLink(baseUrl, pairingPayload) {
  const normalized = normalizeWechatDirectBaseUrl(baseUrl);
  if (!normalized) throw new Error('请先配置微信直达链接');
  const payload = String(pairingPayload || '').trim();
  if (!payload.startsWith('CLASSROOM-CALL-PAIR-1.')) throw new Error('教师端临时配对信息无效');
  const url = new URL(normalized);
  url.searchParams.set('cc_action', 'teacher-login');
  url.searchParams.set('cc_pair', payload);
  return url.toString();
}

module.exports = { normalizeWechatDirectBaseUrl, createTeacherPairingDirectLink };
