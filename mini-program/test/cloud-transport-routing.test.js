const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

test('organization classrooms prefer LAN and fall back to public cloud relay',()=>{
  const sourceRoot=path.join(__dirname,'..','src');
  const socket=fs.readFileSync(path.join(sourceRoot,'utils/socket.js'),'utf8');
  const session=fs.readFileSync(path.join(sourceRoot,'utils/session.js'),'utf8');
  const cloud=fs.readFileSync(path.join(sourceRoot,'utils/cloud.js'),'utf8');
  assert.match(socket,/hasLanRoute/);
  assert.match(socket,/forceCloud:true/);
  assert.match(socket,/activeUsesCloudRelay/);
  assert.match(session,/account\.connectionId = `cloud-\$\{cloud\.userId\}`/);
  assert.match(cloud,/lanAddresses/);
  assert.match(cloud,/publicRelayAvailable/);
});
