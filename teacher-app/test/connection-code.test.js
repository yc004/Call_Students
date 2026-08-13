'use strict';
const assert = require('assert');
const code = require('../connection-code');

['10.0.0.0','10.255.255.255','172.16.0.0','172.31.255.255','192.168.0.0','192.168.255.255','192.168.1.20'].forEach(ip => {
  const encoded = code.encode(ip);
  assert.match(encoded, /^\d{3}-\d{3}-\d{3}$/);
  assert.strictEqual(code.decode(encoded), ip);
});
assert.strictEqual(code.encode('192.168.1.20'), '178-260-683');
assert.strictEqual(code.decode('178260683'), '192.168.1.20');
assert.throws(() => code.decode('178-260-684'), /校验失败/);
assert.throws(() => code.encode('8.8.8.8'), /私有地址/);
console.log('Connection code tests passed.');
