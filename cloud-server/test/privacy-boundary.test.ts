import test from 'node:test';
import assert from 'node:assert/strict';
import { containsProhibitedBiometricData } from '../src/common/biometric-boundary.js';

test('cloud boundary rejects nested biometric content', () => {
  assert.equal(containsProhibitedBiometricData({ payload:{ cropBase64:'data:image/jpeg;base64,abc' } }), true);
  assert.equal(containsProhibitedBiometricData({ descriptor:[0.1, 0.2] }), true);
  assert.equal(containsProhibitedBiometricData({ type:'sync', faceLanRequired:true }), false);
  assert.equal(containsProhibitedBiometricData({ type:'device.status',payload:{ operationalStatus:{ reportedAt:'2026-08-29T10:00:00.000Z',appReady:true } } }), false);
  assert.equal(containsProhibitedBiometricData({ a:{ b:{ c:{ d:{ e:{ f:{ g:{ h:{ i:{ descriptor:[0.1] } } } } } } } } } }), true);
  assert.equal(containsProhibitedBiometricData({ type:'device.status',payload:{ operationalStatus:{ students:[{studentId:'1',similarity:0.99}] } } }), true);
  assert.equal(containsProhibitedBiometricData({ type:'assignment.upsert', payload:{ title:'完成第 3 页' } }), false);
});
