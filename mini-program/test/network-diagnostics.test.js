'use strict';

const assert = require('assert');

global.wx = {
  getNetworkType({ success }) { success({ networkType:'wifi' }); },
  getSystemInfoSync() { return {}; },
  getAccountInfoSync() { return { miniProgram:{} }; },
  showModal() {},
};

const diagnostics = require('../src/utils/network-diagnostics');

(async () => {
  assert.strictEqual(diagnostics.isPrivateIpv4('192.168.43.4'), true);
  assert.strictEqual(diagnostics.isPrivateIpv4('172.20.10.2'), true);
  assert.strictEqual(diagnostics.isPrivateIpv4('8.8.8.8'), false);
  assert.strictEqual(diagnostics.isCellular('4g'), true);
  assert.strictEqual(diagnostics.isCellular('wifi'), false);

  const hotspot = await diagnostics.diagnose(new Error('connectSocket:fail timeout'), {
    room:{ connectionCode:'178-368-049' },
    networkType:'4g',
  });
  assert.strictEqual(hotspot.kind, 'phone-hotspot-host');
  assert.strictEqual(hotspot.hotspotLikely, true);
  assert.strictEqual(hotspot.target, '192.168.43.4');
  assert.match(hotspot.message, /热点/);
  assert.ok(hotspot.suggestions.some(item => /另一台/.test(item)));

  const ordinaryWifi = await diagnostics.diagnose(new Error('connectSocket:fail timeout'), {
    room:{ connectionCode:'178-368-049' },
    networkType:'wifi',
  });
  assert.strictEqual(ordinaryWifi.kind, 'lan-unreachable');
  assert.strictEqual(ordinaryWifi.hotspotLikely, false);

  const policy = await diagnostics.diagnose(new Error('fail:url not in domain list'), {
    room:{ connectionCode:'178-368-049' },
    networkType:'wifi',
  });
  assert.strictEqual(policy.kind, 'wechat-policy');

  console.log('network diagnostics tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
