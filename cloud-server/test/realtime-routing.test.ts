import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ClassroomSocketHub } from '../src/modules/realtime/classroom-socket-hub.js';

function socket(){const sent:string[]=[];const closed:Array<[number,string]>=[];return{OPEN:1,readyState:1,send(value:string){sent.push(value);},close(code:number,reason:string){closed.push([code,reason]);},sent,closed};}

test('public relay routes teacher traffic to devices and responses to the requesting teacher only',()=>{
  const hub=new ClassroomSocketHub();
  const device=socket(),teacherA=socket(),teacherB=socket();
  hub.attach('room','device',device as never);
  hub.attach('room','user',teacherA as never,'client-a');
  hub.attach('room','user',teacherB as never,'client-b');
  hub.broadcastTo('room','device','classroom.event',{type:'connect'});
  assert.equal(device.sent.length,1);
  assert.equal(teacherA.sent.length,0);
  assert.equal(teacherB.sent.length,0);
  assert.equal(hub.sendToUser('room','client-a','classroom.event',{type:'sync'}),true);
  assert.equal(teacherA.sent.length,1);
  assert.equal(teacherB.sent.length,0);
});

test('revoked classroom devices are disconnected immediately',()=>{
  const hub=new ClassroomSocketHub();const device=socket();
  hub.attach('room','device',device as never,'device-1');
  assert.equal(hub.closeDevice('device-1'),true);
  assert.deepEqual(device.closed,[[4403,'device revoked']]);
  assert.equal(hub.closeDevice('device-1'),false);
});

test('cloud protocol injects trusted membership and persists classroom LAN routes',()=>{
  const realtime=readFileSync(new URL('../src/modules/realtime/realtime.gateway.ts',import.meta.url),'utf8');
  const device=readFileSync(new URL('../src/modules/devices/classroom-device.gateway.ts',import.meta.url),'utf8');
  const classroomApp=readFileSync(new URL('../../classroom-app/main.js',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../migrations/012_classroom_lan_access.sql',import.meta.url),'utf8');
  assert.match(realtime,/_cloudMembership=authorized/);
  assert.match(realtime,/message\._cloudClientId=session\.clientId/);
  assert.match(realtime,/this\.mutations\.isDurable/);
  assert.match(device,/updateRealtimeStatus/);
  assert.match(device,/device\.snapshot-request/);
  assert.match(classroomApp,/lanAddresses:getLanAddresses\(\)/);
  assert.match(migration,/lan_addresses_json/);
});

test('cloud classroom changes invalidate devices and clients periodically request authoritative snapshots',()=>{
  const classroom=readFileSync(new URL('../src/modules/classrooms/classroom.service.ts',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('../../classroom-app/cloud-bridge.js',import.meta.url),'utf8');
  assert.match(classroom,/students\.replaced/);
  assert.match(classroom,/revision=revision\+1/);
  assert.match(classroom,/cloud\.invalidate/);
  assert.match(bridge,/setInterval\(\(\) => this\.requestAuthoritativeSnapshot\(\), 30000\)/);
  assert.match(bridge,/knownRevision/);
});
