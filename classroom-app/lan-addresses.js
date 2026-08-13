const VIRTUAL_NAME = /^(bridge|utun|awdl|llw|vmnet|vbox|docker|br-|virbr|tailscale|zt)|virtual|hyper-v|vethernet|parallels/i;
const PHYSICAL_NAME = /^(en\d+|eth\d*|wlan\d*|wlp\w*|wifi|wi-fi|ethernet|以太网|无线)/i;

function isIpv4(entry) {
  return entry && (entry.family === 'IPv4' || entry.family === 4) && !entry.internal && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry.address || '');
}

function addressScore(name, address) {
  const interfaceName = String(name || '');
  let score = 0;
  if (PHYSICAL_NAME.test(interfaceName)) score += 100;
  if (VIRTUAL_NAME.test(interfaceName)) score -= 200;
  if (/^192\.168\./.test(address)) score += 30;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 15;
  else if (/^10\./.test(address)) score += 5;
  return score;
}

function getLanAddresses(networkInterfaces) {
  return getLanInterfaces(networkInterfaces).map(item => item.address);
}

function getLanInterfaces(networkInterfaces) {
  const candidates = [];
  Object.entries(networkInterfaces || {}).forEach(([name, entries]) => {
    (entries || []).forEach(entry => {
      if (isIpv4(entry)) candidates.push({
        address: entry.address,
        name,
        score: addressScore(name, entry.address),
        isVirtual: VIRTUAL_NAME.test(String(name || '')),
        isPhysical: PHYSICAL_NAME.test(String(name || '')),
      });
    });
  });
  candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
  const seen = new Set();
  return candidates.filter(item => {
    if (seen.has(item.address)) return false;
    seen.add(item.address);
    return true;
  });
}

module.exports = { getLanAddresses, getLanInterfaces, addressScore };
