const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

test('organization cloud classrooms never trigger local classroom initialization guides',()=>{
  const root=path.join(__dirname,'..','src');
  const home=fs.readFileSync(path.join(root,'pages/home/index.js'),'utf8');
  const settings=fs.readFileSync(path.join(root,'pages/classroom-settings/index.js'),'utf8');
  const desktop=fs.readFileSync(path.join(__dirname,'../../teacher-app/app.js'),'utf8');
  assert.match(home,/room\.transport!=='cloud'&&isHomeroom&&data\.classroomConfigured===false/);
  assert.match(settings,/!this\.data\.isCloudRoom&&data\.classroomConfigured===false/);
  assert.match(desktop,/state\.classroomConfigured = cloudRoom \? true/);
  assert.match(desktop,/if \(!cloudRoom && isHomeroomTeacher\(\) && !state\.classroomConfigured\)/);
});
