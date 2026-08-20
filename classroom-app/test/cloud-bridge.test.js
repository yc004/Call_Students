'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCloudConfig, isFaceMessage, sanitizeCloudMessage, cloudSocketUrl, ClassroomCloudBridge } = require('../cloud-bridge');

test('validates classroom cloud device configuration', () => {
  const config = normalizeCloudConfig({ enabled:true, serverUrl:'https://cloud.example.com/', deviceToken:'cd_x', classroomId:'room', deviceId:'device' });
  assert.equal(config.serverUrl, 'https://cloud.example.com');
  assert.equal(cloudSocketUrl(config), 'wss://cloud.example.com/ws/v1/classroom?client=classroom-desktop&protocol=1');
  assert.throws(() => normalizeCloudConfig({ enabled:true, serverUrl:'cloud', deviceToken:'x' }));
  assert.throws(() => normalizeCloudConfig({ enabled:true, serverUrl:'http://cloud.example.com', deviceToken:'cd_x', classroomId:'room', deviceId:'device' }), /HTTPS/);
});

test('cloud sync preserves classroom members but strips every face-derived field', () => {
  const safe = sanitizeCloudMessage({ type:'sync', students:[{ id:'1' }], teachers:{ approved:[{ connection_id:'teacher-1' }], pending:[] }, attendance:[{ studentId:'1' }], pendingFaces:[{ cropBase64:'secret' }] });
  assert.deepEqual(safe.students, [{ id:'1' }]);
  assert.deepEqual(safe.teachers.approved, [{ connection_id:'teacher-1' }]);
  assert.equal(safe.attendance, undefined);
  assert.equal(safe.pendingFaces, undefined);
  assert.equal(safe.faceLanRequired, true);
});

test('cloud bridge rejects all face payload families', () => {
  assert.equal(isFaceMessage({ type:'face-detections' }), true);
  assert.equal(isFaceMessage({ type:'pending-face-library' }), true);
  assert.equal(isFaceMessage({ type:'call' }), false);
});

test('cloud bridge applies classroom metadata updates without forwarding them to local clients', () => {
  let received = null;
  const bridge = new ClassroomCloudBridge({ enabled:true, serverUrl:'https://cloud.example.com', deviceToken:'cd_x', classroomId:'room', deviceId:'device' }, {
    classroomHandler:message => { received = message; return true; },
  });
  bridge.handleCloudMessage(JSON.stringify({ type:'cloud.classroom-update', classroomId:'room', name:'高一（1）班', status:'active' }));
  assert.equal(received.name, '高一（1）班');
  assert.equal(bridge.localClients.size, 0);
});
