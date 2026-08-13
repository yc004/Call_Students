(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ConnectionCode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANGES = [
    { base: [10, 0, 0, 0], size: 16777216, offset: 0 },
    { base: [172, 16, 0, 0], size: 1048576, offset: 16777216 },
    { base: [192, 168, 0, 0], size: 65536, offset: 17825792 },
  ];
  const MAX_INDEX = 17891327;

  function ipToNumber(parts) {
    return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]);
  }

  function numberToIp(value) {
    return [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256].join('.');
  }

  function parsePrivateIp(ip) {
    const text = String(ip || '').trim();
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) throw new Error('不是有效的 IPv4 地址');
    const parts = text.split('.').map(Number);
    if (parts.some(part => part < 0 || part > 255)) throw new Error('不是有效的 IPv4 地址');
    const value = ipToNumber(parts);
    const range = RANGES.find(item => {
      const base = ipToNumber(item.base);
      return value >= base && value < base + item.size;
    });
    if (!range) throw new Error('连接码仅支持局域网私有地址');
    return { value, range };
  }

  function checkDigit(payload) {
    let sum = 0;
    for (let index = payload.length - 1, doubleDigit = true; index >= 0; index -= 1, doubleDigit = !doubleDigit) {
      let digit = Number(payload[index]);
      if (doubleDigit) { digit *= 2; if (digit > 9) digit -= 9; }
      sum += digit;
    }
    return String((10 - (sum % 10)) % 10);
  }

  function normalize(code) {
    return String(code || '').replace(/[^0-9]/g, '');
  }

  function format(code) {
    const digits = normalize(code).slice(0, 9);
    return digits.replace(/(\d{3})(?=\d)/g, '$1-');
  }

  function encode(ip) {
    const { value, range } = parsePrivateIp(ip);
    const payload = String(range.offset + value - ipToNumber(range.base)).padStart(8, '0');
    return format(payload + checkDigit(payload));
  }

  function decode(code) {
    const digits = normalize(code);
    if (digits.length !== 9) throw new Error('连接码应为 9 位数字');
    const payload = digits.slice(0, 8);
    if (digits[8] !== checkDigit(payload)) throw new Error('连接码校验失败，请检查输入');
    const index = Number(payload);
    if (!Number.isSafeInteger(index) || index > MAX_INDEX) throw new Error('连接码不在有效范围内');
    const range = [...RANGES].reverse().find(item => index >= item.offset);
    const relative = index - range.offset;
    if (relative >= range.size) throw new Error('连接码不在有效范围内');
    return numberToIp(ipToNumber(range.base) + relative);
  }

  function isValid(code) {
    try { decode(code); return true; } catch (_error) { return false; }
  }

  return { encode, decode, format, normalize, isValid };
});
