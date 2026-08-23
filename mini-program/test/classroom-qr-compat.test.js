const assert = require('assert');
const { createClassroomQrPayload } = require('../../classroom-app/classroom-qr');

global.wx = {
  base64ToArrayBuffer(value) {
    const buffer = Buffer.from(value, 'base64');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
};

const { parseClassroomQr } = require('../src/utils/classroom-qr');

const encoded = createClassroomQrPayload('八年级一班', '178-260-683');
assert.deepStrictEqual(parseClassroomQr(encoded), {
  name:'八年级一班',
  connectionCode:'178-260-683',
});
assert.throws(() => parseClassroomQr('CLASSROOM-CALL-ROOM-1.invalid'), /无法读取/);
console.log('classroom QR compatibility tests passed');
