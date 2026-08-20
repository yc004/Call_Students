const { Bonjour } = require('bonjour-service');

const SERVICE_TYPE = 'banda';
const DISCOVERY_SERVICE_TYPE = `_${SERVICE_TYPE}._tcp.`;

function digitsOf(code) {
  return String(code || '').replace(/\D/g, '');
}

function serviceNameForCode(code) {
  const digits = digitsOf(code);
  if (!/^\d{9}$/.test(digits)) throw new Error('无法广播无效的教室连接码');
  return `Banda-${digits}`;
}

class ClassroomMdnsAdvertiser {
  constructor(options = {}) {
    this.BonjourCtor = options.BonjourCtor || Bonjour;
    this.logger = options.logger || (() => {});
    this.bonjour = null;
    this.service = null;
  }

  start({ address, connectionCode, port, className }) {
    this.stop();
    if (!address || !connectionCode || !port) return false;
    try {
      // 将组播绑定到用户选择的真实局域网网卡，避免虚拟机/VPN 网卡被发布给手机。
      this.bonjour = new this.BonjourCtor({ interface:address }, error => {
        this.logger(`mDNS error: ${error && error.message || error}`);
      });
      this.service = this.bonjour.publish({
        name:serviceNameForCode(connectionCode),
        type:SERVICE_TYPE,
        protocol:'tcp',
        port,
        disableIPv6:true,
        txt:{ version:'1', code:digitsOf(connectionCode), name:String(className || '本教室').slice(0, 80) },
      });
      // bonjour-service 默认会把所有网卡的 A 记录一并写入响应。只保留用户选择的
      // IPv4 地址，否则手机可能拿到虚拟机、VPN 或另一张网卡的地址。
      if (this.service && typeof this.service.records === 'function') {
        const allRecords = this.service.records.bind(this.service);
        this.service.records = () => allRecords().filter(record => record.type !== 'A' || record.data === address);
      }
      this.service.on('up', () => this.logger(`mDNS advertised ${DISCOVERY_SERVICE_TYPE} at ${address}:${port}`));
      this.service.on('error', error => this.logger(`mDNS publish error: ${error && error.message || error}`));
      return true;
    } catch (error) {
      this.logger(`mDNS start failed: ${error && error.message || error}`);
      this.stop();
      return false;
    }
  }

  stop() {
    const bonjour = this.bonjour;
    this.service = null;
    this.bonjour = null;
    if (!bonjour) return;
    try {
      bonjour.unpublishAll(() => {
        try { bonjour.destroy(); } catch (_error) {}
      });
    } catch (_error) {
      try { bonjour.destroy(); } catch (_destroyError) {}
    }
  }
}

module.exports = { ClassroomMdnsAdvertiser, SERVICE_TYPE, DISCOVERY_SERVICE_TYPE, serviceNameForCode };
