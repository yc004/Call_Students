'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCloudConfig, isFaceMessage, sanitizeCloudMessage, cloudSocketUrl, ClassroomCloudBridge } = require('../cloud-bridge');

test('validates classroom cloud device configuration', () => {
  const config = normalizeCloudConfig({ enabled:true, serverUrl:'https://cloud.example.com/', deviceToken:'cd_x', classroomId:'room', deviceId:'device' });
  assert.equal(config.serverUrl, 'https://cloud.example.com');
  assert.equal(cloudSocketUrl(config), 'wss://cloud.example.com/ws/classroom?client=classroom-desktop&protocol=2');
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
  bridge.handleCloudMessage(JSON.stringify({ event:'classroom.event', data:{ type:'cloud.classroom-update', classroomId:'room', name:'高一（1）班', status:'active' } }));
  assert.equal(received.name, '高一（1）班');
  assert.equal(bridge.localClients.size, 0);
});

test('cloud bridge never publishes local data before authoritative cloud restore', () => {
  const sent = [];
  let snapshots = 0;
  const bridge = new ClassroomCloudBridge({ enabled:true, serverUrl:'https://cloud.example.com', deviceToken:'cd_x', classroomId:'room', deviceId:'device' }, {
    snapshotProvider:() => { snapshots += 1; return { type:'sync',students:[{ id:'cloud-student' }] }; },
    restoreHandler:message => message.authority === 'cloud',
  });
  bridge.cloud = { readyState:1, send:value=>sent.push(JSON.parse(value)) };
  bridge.handleCloudMessage(JSON.stringify({ event:'session.ready',data:{} }));
  assert.equal(snapshots, 0);
  assert.equal(sent.some(item=>item.data&&item.data.type==='sync'), false);
  bridge.handleCloudMessage(JSON.stringify({ event:'classroom.event',data:{ type:'cloud.restore',authority:'cloud',revision:7,students:[],assignments:[] } }));
  assert.equal(snapshots, 1);
  assert.equal(sent.some(item=>item.data&&item.data.type==='device.snapshot-applied'&&item.data.revision===7), true);
  assert.equal(sent.some(item=>item.data&&item.data.type==='sync'), true);
});

test('classroom device status publishes health only, without attendance or face artifacts', () => {
  const sent = [];
  const bridge = new ClassroomCloudBridge({ enabled:true, serverUrl:'https://cloud.example.com', deviceToken:'cd_x', classroomId:'room', deviceId:'device' }, {
    statusProvider:() => ({ operationalStatus:{ reportedAt:'2026-08-29T10:00:00.000Z',appReady:true,classroomConfigured:true } }),
  });
  bridge.cloud = { readyState:1, send:value=>sent.push(JSON.parse(value)) };
  bridge.sendDeviceStatus();
  assert.equal(sent[0].data.payload.operationalStatus.appReady, true);
  assert.equal(JSON.stringify(sent[0]).includes('students'), false);
  assert.equal(JSON.stringify(sent[0]).includes('attendance'), false);
  assert.equal(JSON.stringify(sent[0]).includes('descriptor'), false);
  assert.equal(JSON.stringify(sent[0]).includes('cropBase64'), false);
});

test('classroom requests the authoritative cloud snapshot with its local revision', () => {
  const sent = [];
  const bridge = new ClassroomCloudBridge({ enabled:true, serverUrl:'https://cloud.example.com', deviceToken:'cd_x', classroomId:'room', deviceId:'device' }, { revisionProvider:() => 12 });
  bridge.cloud = { readyState:1, send:value=>sent.push(JSON.parse(value)) };
  bridge.requestAuthoritativeSnapshot();
  assert.deepEqual(sent[0].data, { type:'device.snapshot-request',classroomId:'room',knownRevision:12 });
  bridge.handleCloudMessage(JSON.stringify({ event:'classroom.event',data:{ type:'cloud.invalidate',revision:13 } }));
  assert.equal(sent.length, 2);
});
