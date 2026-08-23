const assert = require('assert');
global.wx = {
  storage: new Map(),
  setStorageSync(key, value) { this.storage.set(key, value); },
  getStorageSync(key) { return this.storage.get(key); },
  removeStorageSync(key) { this.storage.delete(key); },
};

const sharedRoom = require('../src/utils/shared-room');
const room = { name: '八年级一班', connectionCode: '178-260-683' };
assert.deepStrictEqual(sharedRoom.normalizeRoom(room), room);
assert.strictEqual(sharedRoom.normalizeRoom({ name: '测试', connectionCode: '123' }), null);
const path = sharedRoom.createPath(room);
assert(path.startsWith('/pages/room-connect/index?'));
assert(path.includes(encodeURIComponent(room.name)));
assert.deepStrictEqual(sharedRoom.normalizeRoom({ name: encodeURIComponent(room.name), connectionCode: room.connectionCode }), room);
const directLink = `https://example.com/classroom?cc_action=connect&cc_code=178260683&cc_name=${encodeURIComponent(room.name)}`;
assert.deepStrictEqual(sharedRoom.parseDirectLink(directLink), room);
assert.deepStrictEqual(
  sharedRoom.parseDirectLink('https://example.com/classroom?cc_action=connect&cc_code=178260683&cc_name=%E4%B8%80%E7%8F%AD%26%E4%BA%8C%E7%8F%AD'),
  { name:'一班&二班', connectionCode:room.connectionCode },
);
assert.deepStrictEqual(sharedRoom.parseDirectLink(encodeURIComponent(directLink)), room);
assert.strictEqual(sharedRoom.parseDirectLink('https://example.com/classroom?cc_action=unknown&cc_code=178260683'), null);
assert.deepStrictEqual(sharedRoom.parseScene('c=178260683'), { name:'扫码连接的教室', connectionCode:room.connectionCode });
assert.deepStrictEqual(sharedRoom.fromLaunchOptions({ q:encodeURIComponent(directLink) }), room);
assert.deepStrictEqual(sharedRoom.fromLaunchOptions({ query:{ scene:'c%3D178260683' } }), { name:'扫码连接的教室', connectionCode:room.connectionCode });
assert(sharedRoom.savePending(room));
assert.deepStrictEqual(sharedRoom.loadPending(), room);
sharedRoom.clearPending();
assert.strictEqual(sharedRoom.loadPending(), null);
console.log('shared room tests passed');
