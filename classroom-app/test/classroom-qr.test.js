const assert = require('assert');
const { PREFIX, createClassroomQrPayload } = require('../classroom-qr');

const encoded = createClassroomQrPayload('八年级一班', '178-260-683');
assert(encoded.startsWith(`${PREFIX}.`));
const payload = JSON.parse(Buffer.from(encoded.slice(PREFIX.length + 1), 'base64url').toString('utf8'));
assert.deepStrictEqual(payload, {
  version: 1,
  type: 'classroom',
  name: '八年级一班',
  connectionCode: '178-260-683',
});
assert.throws(() => createClassroomQrPayload('测试教室', '123'), /连接码无效/);
console.log('classroom QR payload tests passed');
