const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('classroom onboarding is limited to the initial homeroom binding', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'renderer/onboarding/onboarding.js'), 'utf8');

  assert.match(main, /function createOnboardingWindow\(\)\s*\{[\s\S]*?if \(isHomeroomBound\(\)\)/);
  assert.match(main, /if \(!isHomeroomBound\(\)\)\s*\{\s*createOnboardingWindow\(\)/);
  assert.doesNotMatch(preload, /approvePendingTeacher|rejectPendingTeacher|transferHomeroomTeacher/);
  assert.doesNotMatch(onboarding, /approvePendingTeacher|rejectPendingTeacher|transferHomeroomTeacher/);
});

test('authoritative cloud restore reconciles the floating classroom runtime', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const restore = main.slice(main.indexOf('function applyCloudRestore'), main.indexOf('function applyCloudClassroomUpdate'));
  const reconcile = main.slice(main.indexOf('function reconcileRuntimeWithCurrentConfiguration'), main.indexOf('function deactivateBoundRuntimeForRebinding'));

  assert.match(restore, /reconcileRuntimeWithCurrentConfiguration\(\{ cloudManaged:true \}\)/);
  assert.match(reconcile, /if \(isSystemReady\(\)\) return activateBoundRuntime\(false\)/);
  assert.match(reconcile, /if \(!cloudManaged && !isHomeroomBound\(\)\) createOnboardingWindow\(\)/);
});

test('renderer windows receive role-scoped preload capabilities',()=>{
  const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(preload,/banda-window-role/);
  assert.match(preload,/'cloud-settings':\['getCloudConfig','enrollCloud','disconnectCloud'\]/);
  assert.match(preload,/allowedFace/);
  for(const role of ['onboarding','connection','cloud-settings','homework-float','homework-widget','popup','homework-board','face-check','face-register'])assert.match(main,new RegExp(`banda-window-role=${role}`));
});
