const assert = require('assert');
const { normalizeWechatDirectBaseUrl, createTeacherPairingDirectLink } = require('../wechat-direct-link');

const payload = 'CLASSROOM-CALL-PAIR-1.example_payload';
const link = new URL(createTeacherPairingDirectLink('https://example.com/classroom', payload));
assert.strictEqual(link.searchParams.get('cc_action'), 'teacher-login');
assert.strictEqual(link.searchParams.get('cc_pair'), payload);
assert.strictEqual(normalizeWechatDirectBaseUrl('https://example.com/classroom#ignored'), 'https://example.com/classroom');
assert.throws(() => normalizeWechatDirectBaseUrl('http://example.com/classroom'), /HTTPS/);
console.log('teacher WeChat direct link tests passed');
