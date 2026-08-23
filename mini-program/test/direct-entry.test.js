const assert = require('assert');
const { parseDirectPairingLink } = require('../src/utils/auth');

const pairing = 'CLASSROOM-CALL-PAIR-1.example_payload';
const link = `https://example.com/classroom?cc_action=teacher-login&cc_pair=${encodeURIComponent(pairing)}`;
assert.strictEqual(parseDirectPairingLink(link), pairing);
assert.strictEqual(parseDirectPairingLink(encodeURIComponent(link)), pairing);
assert.strictEqual(parseDirectPairingLink('https://example.com/classroom?cc_action=connect'), '');
console.log('mini-program direct entry tests passed');
