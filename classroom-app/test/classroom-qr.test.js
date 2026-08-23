const assert = require('assert');
const {
  PREFIX,
  createClassroomQrPayload,
  createWechatDirectLink,
  normalizeWechatDirectBaseUrl,
} = require('../classroom-qr');

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
const directLink = new URL(createWechatDirectLink('https://example.com/mp/classroom', '八年级一班', '178-260-683'));
assert.strictEqual(directLink.origin + directLink.pathname, 'https://example.com/mp/classroom');
assert.strictEqual(directLink.searchParams.get('cc_action'), 'connect');
assert.strictEqual(directLink.searchParams.get('cc_code'), '178260683');
assert.strictEqual(directLink.searchParams.get('cc_name'), '八年级一班');
assert.strictEqual(normalizeWechatDirectBaseUrl('https://example.com/classroom#ignored'), 'https://example.com/classroom');
assert.throws(() => normalizeWechatDirectBaseUrl('http://example.com/classroom'), /HTTPS/);
console.log('classroom QR payload tests passed');
