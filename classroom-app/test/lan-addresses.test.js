const assert = require('assert');
const { getLanAddresses, getLanInterfaces } = require('../lan-addresses');

const addresses = getLanAddresses({
  bridge100: [{ family:'IPv4', internal:false, address:'10.211.55.2' }],
  en0: [{ family:'IPv4', internal:false, address:'192.168.1.241' }],
  utun3: [{ family:'IPv4', internal:false, address:'10.8.0.2' }],
  lo0: [{ family:'IPv4', internal:true, address:'127.0.0.1' }],
});
assert.deepStrictEqual(addresses, ['192.168.1.241', '10.211.55.2', '10.8.0.2']);
assert.deepStrictEqual(getLanAddresses({ 'Wi-Fi': [{ family:4, internal:false, address:'10.0.0.8' }] }), ['10.0.0.8']);
const interfaces = getLanInterfaces({
  vmnet8: [{ family:'IPv4', internal:false, address:'192.168.88.1' }],
  en0: [{ family:'IPv4', internal:false, address:'192.168.1.20' }],
});
assert.deepStrictEqual(interfaces.map(item => item.name), ['en0','vmnet8']);
assert.strictEqual(interfaces[0].isPhysical, true);
assert.strictEqual(interfaces[1].isVirtual, true);
console.log('LAN address selection tests passed');
