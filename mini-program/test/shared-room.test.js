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
assert(sharedRoom.savePending(room));
assert.deepStrictEqual(sharedRoom.loadPending(), room);
sharedRoom.clearPending();
assert.strictEqual(sharedRoom.loadPending(), null);
console.log('shared room tests passed');
