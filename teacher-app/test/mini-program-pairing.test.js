'use strict';

const assert = require('assert');
const {
  createPairingPayload,
  parsePairingPayload,
  getLanAddresses,
  safeRooms,
} = require('../mini-program-pairing');

const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const value = createPairingPayload({ hosts: ['192.168.1.8'], port: 43123, token, expiresAt: Date.now() + 60000 });
assert.match(value, /^CLASSROOM-CALL-PAIR-1\./);
const parsed = parsePairingPayload(value);
assert.deepStrictEqual(parsed.hosts, ['192.168.1.8']);
assert.strictEqual(parsed.port, 43123);
assert.strictEqual(parsed.token, token);
assert.strictEqual(Object.hasOwn(parsed, 'account'), false);
assert.strictEqual(Object.hasOwn(parsed, 'rooms'), false);
assert.throws(() => parsePairingPayload('CLASSROOM-CALL-MINI-1.invalid.value'), /格式不正确/);
assert.deepStrictEqual(getLanAddresses({ en0: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }], lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }), ['192.168.1.8']);

assert.strictEqual(value.includes('张老师'), false);
assert.strictEqual(value.includes('178-260-683'), false);
assert.strictEqual(value.includes('passwordHash'), false);
assert.strictEqual(parsed.purpose, 'teacher-login');
assert.deepStrictEqual(safeRooms([{ id:'room-1',name:'一班',connectionCode:'178-260-568',subjects:['数学','数学','物理'] }])[0].subjects, ['数学','物理']);

console.log('Mini-program pairing tests passed.');
