const connectionCode = require('./connection-code');

const SERVICE_TYPE = '_banda._tcp.';
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();
let activeDiscovery = null;

function platformName() {
  try {
    if (typeof wx.getDeviceInfo === 'function') return String(wx.getDeviceInfo().platform || '').toLowerCase();
  } catch (_error) {}
  try { return String(wx.getSystemInfoSync().platform || '').toLowerCase(); }
  catch (_error) { return ''; }
}

function qrHost(room) {
  return connectionCode.decode(room && room.connectionCode);
}

function roomDigits(room) {
  return connectionCode.format(room && room.connectionCode).replace(/\D/g, '');
}

function isMatchingService(service, digits) {
  const name = String(service && service.serviceName || '').toLowerCase();
  return name === `banda-${digits}` || name.startsWith(`banda-${digits} (`);
}

function usableService(service) {
  return service && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(service.ip || ''))
    && Number(service.port) === 3456;
}

function stopDiscovery() {
  try { wx.stopLocalServiceDiscovery({ serviceType:SERVICE_TYPE }); } catch (_error) {}
}

function discover(timeoutMs) {
  if (activeDiscovery) return activeDiscovery;
  activeDiscovery = new Promise(resolve => {
    const found = [];
    let finished = false;
    let timer = null;
    const onFound = service => {
      if (usableService(service)) found.push(service);
    };
    const onStopped = () => finish();
    function cleanup() {
      clearTimeout(timer);
      if (typeof wx.offLocalServiceFound === 'function') wx.offLocalServiceFound(onFound);
      if (typeof wx.offLocalServiceDiscoveryStop === 'function') wx.offLocalServiceDiscoveryStop(onStopped);
    }
    function finish() {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(found);
    }
    wx.onLocalServiceFound(onFound);
    if (typeof wx.onLocalServiceDiscoveryStop === 'function') wx.onLocalServiceDiscoveryStop(onStopped);
    timer = setTimeout(() => { stopDiscovery(); finish(); }, Math.max(300, timeoutMs || 2200));
    try {
      wx.startLocalServiceDiscovery({
        serviceType:SERVICE_TYPE,
        fail:() => finish(),
      });
    } catch (_error) { finish(); }
  }).finally(() => { activeDiscovery = null; });
  return activeDiscovery;
}

async function resolveClassroomHost(room, timeoutMs = 2200) {
  const fallback = qrHost(room);
  const digits = roomDigits(room);
  const saved = cache.get(digits);
  if (saved && saved.expiresAt > Date.now()) return { host:saved.host, source:saved.source, serviceName:saved.serviceName };

  // 微信当前在 iOS 上不提供 mDNS 搜索能力；二维码内同网段 IP 仍作为兼容路径。
  if (platformName() === 'ios'
    || typeof wx.startLocalServiceDiscovery !== 'function'
    || typeof wx.onLocalServiceFound !== 'function') {
    return { host:fallback, source:'qr' };
  }
  const services = await discover(timeoutMs);
  const match = services.find(service => isMatchingService(service, digits));
  if (!match) {
    cache.set(digits, { host:fallback, source:'qr-fallback', expiresAt:Date.now() + 30000 });
    return { host:fallback, source:'qr-fallback' };
  }
  cache.set(digits, { host:match.ip, source:'mdns', serviceName:match.serviceName, expiresAt:Date.now() + CACHE_TTL });
  return { host:match.ip, source:'mdns', serviceName:match.serviceName };
}

function clearLocalServiceCache() { cache.clear(); }

module.exports = { SERVICE_TYPE, resolveClassroomHost, clearLocalServiceCache, isMatchingService };
