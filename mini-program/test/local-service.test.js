const assert = require('assert');

let foundHandler = null;
let stopHandler = null;
let requestedType = '';
global.wx = {
  getDeviceInfo() { return { platform:'android' }; },
  onLocalServiceFound(handler) { foundHandler = handler; },
  offLocalServiceFound() {},
  onLocalServiceDiscoveryStop(handler) { stopHandler = handler; },
  offLocalServiceDiscoveryStop() {},
  startLocalServiceDiscovery({ serviceType, success }) {
    requestedType = serviceType;
    if (success) success();
    setTimeout(() => {
      foundHandler({ serviceName:'Banda-178368049', serviceType, ip:'192.168.43.20', port:3456 });
      stopHandler();
    }, 1);
  },
  stopLocalServiceDiscovery() {},
};

const { resolveClassroomHost, SERVICE_TYPE } = require('../src/utils/local-service');

(async () => {
  const result = await resolveClassroomHost({ connectionCode:'178-368-049' }, 200);
  assert.strictEqual(SERVICE_TYPE, '_banda._tcp.');
  assert.strictEqual(requestedType, SERVICE_TYPE);
  assert.strictEqual(result.host, '192.168.43.20');
  assert.strictEqual(result.source, 'mdns');
  console.log('local service discovery tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
