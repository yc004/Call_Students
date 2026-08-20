const assert = require('assert');
const room = { id:'r1',name:'八年级一班',connectionCode:'178-260-683' };
let stored = { account:{name:'刘老师',connectionId:'mini-test-account'},rooms:[room],activeRoom:null };
global.wx = {
  getStorageSync(){ return stored; },
  setStorageSync(_key,value){ stored=value; },
  removeStorageSync(){},
};
global.getApp = () => ({ globalData:{} });
const context = require('../src/utils/room-context');
const result = context.activateByCode('178260683');
assert.strictEqual(result.room.name,'八年级一班');
assert.strictEqual(result.session.activeRoom.connectionCode,'178-260-683');
assert.strictEqual(context.featureUrl('call',room),'/pages/call/index?code=178-260-683');
assert.strictEqual(context.featureUrl('homework',room),'/pages/homework/index?code=178-260-683');
assert.strictEqual(context.featureUrl('attendance',room),'/pages/attendance/index?code=178-260-683');
assert.strictEqual(context.featureUrl('settings',room),'/pages/classroom-settings/index?code=178-260-683');
const removed = require('../src/utils/session').sessionStore.removeRoom(room.connectionCode);
assert.deepStrictEqual(removed.rooms,[]);
assert.strictEqual(removed.activeRoom,null);
const cloudRoom={id:'cloud-room',cloudClassroomId:'8ad0e55d-5e19-41f0-9573-771cbbed6069',transport:'cloud',name:'云端班级',connectionCode:'',subjects:['数学']};
stored={account:{name:'刘老师',connectionId:'mini-test-account'},rooms:[cloudRoom],activeRoom:null,cloud:{serverUrl:'https://cloud.example.com',accessToken:'a',refreshToken:'r'}};
const cloudResult=context.activateByCode(`cloud:${cloudRoom.cloudClassroomId}`);
assert.strictEqual(cloudResult.room.name,'云端班级');
assert.strictEqual(context.featureUrl('homework',cloudRoom),`/pages/homework/index?code=cloud%3A${cloudRoom.cloudClassroomId}`);
assert.deepStrictEqual(require('../src/utils/session').sessionStore.removeRoom(cloudRoom).rooms,[]);
console.log('room context tests passed');
