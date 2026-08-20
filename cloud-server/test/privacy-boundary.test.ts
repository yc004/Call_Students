import test from 'node:test';
import assert from 'node:assert/strict';
import { containsFaceData } from '../src/server.js';

test('cloud boundary rejects nested biometric content', () => {
  assert.equal(containsFaceData({ payload:{ cropBase64:'data:image/jpeg;base64,abc' } }), true);
  assert.equal(containsFaceData({ descriptor:[0.1, 0.2] }), true);
  assert.equal(containsFaceData({ type:'sync', faceLanRequired:true }), false);
  assert.equal(containsFaceData({ type:'assignment.upsert', payload:{ title:'完成第 3 页' } }), false);
});
