import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import WebSocket from 'ws';
import { hashPassword } from '../dist/security.js';

const baseUrl=process.env.BASE_URL || 'http://127.0.0.1:8080';
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('DATABASE_URL is required');

const pool=new pg.Pool({connectionString:databaseUrl});
const database=await pool.connect();
const suffix=randomUUID().replaceAll('-','').slice(0,12);
const fixture={organizationId:randomUUID(),userId:randomUUID(),roleId:randomUUID(),slug:`runtime-${suffix}`,loginName:`owner-${suffix}`,password:`E2e-${suffix}-Password!`,teacherLoginName:`teacher-${suffix}`,teacherPassword:`Teacher-${suffix}!`};

async function request(path,options={}){
  const headers={...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})};
  const response=await fetch(`${baseUrl}${path}`,{...options,headers});
  const text=await response.text();
  let body;
  try{body=text?JSON.parse(text):undefined;}catch{body=text;}
  return{response,body};
}

function assertWebSocketRejects(path){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(baseUrl.replace(/^http/,'ws')+path);
    const timer=setTimeout(()=>{socket.terminate();reject(new Error(`${path} authentication timeout`));},5_000);
    socket.on('open',()=>socket.send(JSON.stringify({event:'authenticate',data:{token:'invalid'}})));
    socket.on('close',code=>{clearTimeout(timer);try{assert.equal(code,4401);resolve();}catch(error){reject(error);}});
    socket.on('error',reject);
  });
}

function publishDurableMutation({accessToken,classroomId,message}){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(baseUrl.replace(/^http/,'ws')+'/ws/client');
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('durable mutation timeout'));},8_000);
    let publishes=0;
    socket.on('open',()=>socket.send(JSON.stringify({event:'authenticate',data:{token:accessToken}})));
    socket.on('message',raw=>{
      let packet;try{packet=JSON.parse(String(raw));}catch{return;}
      if(packet.event==='session.ready')socket.send(JSON.stringify({event:'subscribe',data:{classroomId}}));
      else if(packet.event==='subscription.ready')socket.send(JSON.stringify({event:'publish',data:message}));
      else if(packet.event==='error'){clearTimeout(timer);socket.close();reject(new Error(packet.data?.message||packet.data?.code||'mutation rejected'));}
      else if(packet.event==='published'){
        publishes+=1;
        if(publishes===1){assert.equal(packet.data.replayed,false);socket.send(JSON.stringify({event:'publish',data:message}));}
        else{clearTimeout(timer);assert.equal(packet.data.replayed,true);socket.close();resolve(packet.data);}
      }
    });
    socket.on('error',error=>{clearTimeout(timer);reject(error);});
  });
}

try{
  const passwordHash=await hashPassword(fixture.password);
  await database.query('BEGIN');
  await database.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[fixture.organizationId,'Runtime E2E',fixture.slug]);
  await database.query(`INSERT INTO users(id,organization_id,name,login_name,password_hash,server_role,status) VALUES($1,$2,'Runtime Owner',$3,$4,'admin','active')`,[fixture.userId,fixture.organizationId,fixture.loginName,passwordHash]);
  await database.query(`INSERT INTO roles(id,organization_id,code,name,data_scope,is_system) VALUES($1,$2,'runtime_owner','Runtime Owner','organization',true)`,[fixture.roleId,fixture.organizationId]);
  await database.query('INSERT INTO role_permissions(role_id,permission_key) SELECT $1,key FROM permissions',[fixture.roleId]);
  await database.query(`INSERT INTO user_role_bindings(organization_id,user_id,role_id,scope_type,scope_id,created_by) VALUES($1,$2,$3,'organization',$1,$2)`,[fixture.organizationId,fixture.userId,fixture.roleId]);
  await database.query('COMMIT');

  const login=await request('/api/v2/auth/admin/login',{method:'POST',body:JSON.stringify({organizationSlug:fixture.slug,loginName:fixture.loginName,password:fixture.password,deviceName:'Runtime E2E'})});
  assert.equal(login.response.status,200);
  assert.ok(login.body.data.accessToken);
  assert.ok(login.body.data.refreshToken);

  const authorization={authorization:`Bearer ${login.body.data.accessToken}`};
  const me=await request('/api/v2/auth/me',{headers:authorization});
  assert.equal(me.response.status,200);
  assert.equal(me.body.data.organization.slug,fixture.slug);
  assert.ok(me.body.data.permissions.includes('organization.manage'));

  const organization=await request('/api/v2/organization',{headers:authorization});
  assert.equal(organization.response.status,200);
  assert.equal(organization.body.data.id,fixture.organizationId);
  const logoBytes=await sharp({create:{background:{alpha:1,b:220,g:110,r:30},channels:4,height:1200,width:1600}}).png({compressionLevel:0}).toBuffer();
  const uploadedLogo=await request('/api/v2/organization/logo',{method:'POST',headers:{...authorization,'content-type':'image/png'},body:logoBytes});
  assert.equal(uploadedLogo.response.status,201);
  assert.match(uploadedLogo.body.data.logo_url,/^\/uploads\/logos\/[0-9a-f-]+\.webp$/);
  const servedLogo=await fetch(`${baseUrl}${uploadedLogo.body.data.logo_url}`);
  assert.equal(servedLogo.status,200);
  assert.equal(servedLogo.headers.get('content-type'),'image/webp');
  const optimizedLogo=Buffer.from(await servedLogo.arrayBuffer());
  const optimizedMetadata=await sharp(optimizedLogo).metadata();
  assert.ok(optimizedLogo.length<logoBytes.length);
  assert.ok(Math.max(optimizedMetadata.width||0,optimizedMetadata.height||0)<=512);
  const aliasContentTypeLogo=await request('/api/v2/organization/logo',{method:'POST',headers:{...authorization,'content-type':'image/x-png'},body:logoBytes});
  assert.equal(aliasContentTypeLogo.response.status,201);
  const invalidLogo=await request('/api/v2/organization/logo',{method:'POST',headers:{...authorization,'content-type':'image/png'},body:Buffer.from('not-an-image')});
  assert.equal(invalidLogo.response.status,400);
  const removedLogo=await request('/api/v2/organization/logo',{method:'DELETE',headers:authorization});
  assert.equal(removedLogo.response.status,200);
  assert.equal(removedLogo.body.data.logo_url,null);

  const subject=await request('/api/v2/subjects',{method:'POST',headers:authorization,body:JSON.stringify({name:'E2E 科目',sortOrder:5})});
  assert.equal(subject.response.status,201);
  const activeSubjects=await request('/api/v2/subjects?activeOnly=true',{headers:authorization});
  assert.equal(activeSubjects.response.status,200);
  assert.ok(activeSubjects.body.data.some((item)=>item.id===subject.body.data.id));

  const campus=await request('/api/v2/campuses',{method:'POST',headers:authorization,body:JSON.stringify({name:'E2E 校区',code:`campus-${suffix}`})});
  assert.equal(campus.response.status,201);
  const role=await request('/api/v2/roles',{method:'POST',headers:authorization,body:JSON.stringify({code:`runtime_${suffix}`,name:'Runtime Manager',dataScope:'organization',permissions:['campus.read','classroom.read']})});
  assert.equal(role.response.status,201);
  const teacher=await request('/api/v2/users',{method:'POST',headers:authorization,body:JSON.stringify({name:'Runtime Teacher',loginName:fixture.teacherLoginName,serverRole:'teacher'})});
  assert.equal(teacher.response.status,201);
  assert.match(teacher.body.data.initialPassword,/^T-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
  const binding=await request(`/api/v2/users/${teacher.body.data.id}/role-bindings`,{method:'POST',headers:authorization,body:JSON.stringify({roleId:role.body.data.id,scopeType:'organization',scopeId:fixture.organizationId})});
  assert.equal(binding.response.status,201);
  const classroom=await request('/api/v2/classrooms',{method:'POST',headers:authorization,body:JSON.stringify({name:'E2E 教室',campusId:campus.body.data.id})});
  assert.equal(classroom.response.status,201);
  assert.match(classroom.body.data.loginName,/^room-[0-9a-f]{10}$/);
  assert.match(classroom.body.data.initialPassword,/^C-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
  const member=await request(`/api/v2/classrooms/${classroom.body.data.id}/members`,{method:'PUT',headers:authorization,body:JSON.stringify({userId:teacher.body.data.id,role:'teacher',subjects:['E2E 科目']})});
  assert.equal(member.response.status,204);
  const invalidSubject=await request(`/api/v2/classrooms/${classroom.body.data.id}/members`,{method:'PUT',headers:authorization,body:JSON.stringify({userId:teacher.body.data.id,role:'teacher',subjects:['未配置科目']})});
  assert.equal(invalidSubject.response.status,400);
  const renamedSubject=await request(`/api/v2/subjects/${subject.body.data.id}`,{method:'PATCH',headers:authorization,body:JSON.stringify({name:'E2E 科目（已更新）',sortOrder:6})});
  assert.equal(renamedSubject.response.status,200);
  const classroomAfterRename=await request(`/api/v2/classrooms/${classroom.body.data.id}`,{headers:authorization});
  assert.ok(classroomAfterRename.body.data.members.some((item)=>item.subjects_json.includes('E2E 科目（已更新）')));
  const assignment=await request(`/api/v2/classrooms/${classroom.body.data.id}/assignments`,{method:'POST',headers:authorization,body:JSON.stringify({subject:'E2E 科目（已更新）',type:'homework',title:'E2E 作业'})});
  assert.equal(assignment.response.status,201);
  const invalidAssignment=await request(`/api/v2/classrooms/${classroom.body.data.id}/assignments`,{method:'POST',headers:authorization,body:JSON.stringify({subject:'未配置科目',type:'homework',title:'非法作业'})});
  assert.equal(invalidAssignment.response.status,400);
  const students=await request(`/api/v2/classrooms/${classroom.body.data.id}/students`,{method:'PUT',headers:authorization,body:JSON.stringify({students:[{name:'学生甲'},{name:'学生乙'}]})});
  assert.equal(students.response.status,200);
  assert.equal(students.body.data.students.length,2);
  const teacherLogin=await request('/api/v2/auth/login',{method:'POST',body:JSON.stringify({organizationSlug:fixture.slug,loginName:fixture.teacherLoginName,password:teacher.body.data.initialPassword,deviceName:'Runtime Teacher Client'})});
  assert.equal(teacherLogin.response.status,200);
  assert.equal(teacherLogin.body.data.user.mustChangePassword,true);
  assert.equal(teacherLogin.body.data.organization.slug,fixture.slug);
  const teacherAuthorization={authorization:`Bearer ${teacherLogin.body.data.accessToken}`};
  const clientClassrooms=await request('/api/v2/client/classrooms',{headers:teacherAuthorization});
  assert.equal(clientClassrooms.response.status,200);
  assert.ok(clientClassrooms.body.data.some((item)=>item.id===classroom.body.data.id&&item.subjects_json.includes('E2E 科目（已更新）')));
  const clientSubjects=await request('/api/v2/client/subjects',{headers:teacherAuthorization});
  assert.equal(clientSubjects.response.status,200);
  assert.ok(clientSubjects.body.data.some((item)=>item.id===subject.body.data.id&&item.name==='E2E 科目（已更新）'));
  const clientSnapshot=await request(`/api/v2/client/classrooms/${classroom.body.data.id}/snapshot`,{headers:teacherAuthorization});
  assert.equal(clientSnapshot.response.status,200);
  assert.equal(clientSnapshot.body.data.students.length,2);
  assert.ok(clientSnapshot.body.data.assignments.some((item)=>item.id===assignment.body.data.id));
  const profileUpdate=await request('/api/v2/profile',{method:'PATCH',headers:teacherAuthorization,body:JSON.stringify({name:'Runtime Teacher Updated',newPassword:`Updated-${suffix}!`})});
  assert.equal(profileUpdate.response.status,200);
  assert.equal(profileUpdate.body.data.user.name,'Runtime Teacher Updated');
  assert.equal(profileUpdate.body.data.user.mustChangePassword,false);
  const relayAssignmentId=`relay-${suffix}`;
  const relayOperationId=randomUUID();
  const relayResult=await publishDurableMutation({
    accessToken:teacherLogin.body.data.accessToken,classroomId:classroom.body.data.id,
    message:{type:'update-assignments',operationId:relayOperationId,action:'add',assignment:{id:relayAssignmentId,subject:'E2E 科目（已更新）',type:'homework',title:'Relay 作业',submissions:{[students.body.data.students[0].id]:'已提交'}}},
  });
  assert.equal(relayResult.operationId,relayOperationId);
  const persistedRelay=(await database.query('SELECT title FROM assignments WHERE id=$1 AND classroom_id=$2',[relayAssignmentId,classroom.body.data.id])).rows[0];
  assert.equal(persistedRelay.title,'Relay 作业');
  const persistedSubmission=(await database.query('SELECT status FROM submissions WHERE assignment_id=$1 AND student_id=$2',[relayAssignmentId,students.body.data.students[0].id])).rows[0];
  assert.equal(persistedSubmission.status,'已提交');
  assert.equal(Number((await database.query('SELECT count(*) AS count FROM operation_events WHERE classroom_id=$1 AND operation_id=$2',[classroom.body.data.id,relayOperationId])).rows[0].count),1);
  const deviceRegistration=await request('/api/v2/devices/classrooms/login',{method:'POST',body:JSON.stringify({organizationSlug:fixture.slug,loginName:classroom.body.data.loginName,password:classroom.body.data.initialPassword,deviceName:'Runtime Classroom Client',appVersion:'2.0.0',installationId:`runtime-${suffix}`})});
  assert.equal(deviceRegistration.response.status,201);
  assert.ok(String(deviceRegistration.body.data.deviceToken).startsWith('cd_'));
  const deviceHeartbeat=await request('/api/v2/devices/classrooms/heartbeat',{method:'POST',body:JSON.stringify({deviceToken:deviceRegistration.body.data.deviceToken,appVersion:'2.0.0',lanConnectionCode:'ABCD-1234'})});
  assert.equal(deviceHeartbeat.response.status,201);
  assert.equal(deviceHeartbeat.body.data.classroom_id,classroom.body.data.id);
  const deviceList=await request('/api/v2/classroom-devices',{headers:authorization});
  assert.equal(deviceList.response.status,200);
  assert.ok(Array.isArray(deviceList.body.data));
  const classroomStatus=await request('/api/v2/classrooms/status/overview',{headers:authorization});
  assert.equal(classroomStatus.response.status,200);
  assert.equal(classroomStatus.body.data.summary.totalClassrooms,1);
  assert.equal(classroomStatus.body.data.summary.onlineClassrooms,1);
  assert.equal(classroomStatus.body.data.summary.registeredStudents,2);
  assert.equal(classroomStatus.body.data.summary.teacherMembers,1);
  assert.ok(classroomStatus.body.data.items.some((item)=>item.id===classroom.body.data.id&&item.connection_status==='online'&&item.student_count===2&&item.teacher_count===1&&item.current_student_count===null&&item.attendance_status==='local_only'));
  assert.equal(classroomStatus.body.data.privacy.attendanceCloudAvailable,false);
  const batchTeachers=await request('/api/v2/users/batch',{method:'POST',headers:authorization,body:JSON.stringify({items:[{name:'批量教师甲',loginName:`batch-a-${suffix}`},{name:'批量教师乙',loginName:`batch-b-${suffix}`}]})});
  assert.equal(batchTeachers.response.status,201);
  assert.equal(batchTeachers.body.data.items.length,2);
  assert.ok(batchTeachers.body.data.items.every(item=>/^T-/.test(item.initialPassword)));
  const batchClassrooms=await request('/api/v2/classrooms/batch',{method:'POST',headers:authorization,body:JSON.stringify({items:[{name:'批量教室甲',campusId:campus.body.data.id},{name:'批量教室乙',campusId:campus.body.data.id,loginName:`room-batch-${suffix}`}]})});
  assert.equal(batchClassrooms.response.status,201);
  assert.equal(batchClassrooms.body.data.items.length,2);
  assert.ok(batchClassrooms.body.data.items.every(item=>/^C-/.test(item.initialPassword)));
  const resetClassroomPassword=await request(`/api/v2/classrooms/${classroom.body.data.id}/reset-password`,{method:'POST',headers:authorization});
  assert.equal(resetClassroomPassword.response.status,201);
  assert.match(resetClassroomPassword.body.data.initialPassword,/^C-/);
  const staleClassroomPassword=await request('/api/v2/devices/classrooms/login',{method:'POST',body:JSON.stringify({organizationSlug:fixture.slug,loginName:classroom.body.data.loginName,password:classroom.body.data.initialPassword,deviceName:'Stale password'})});
  assert.equal(staleClassroomPassword.response.status,401);
  const renewedClassroomLogin=await request('/api/v2/devices/classrooms/login',{method:'POST',body:JSON.stringify({organizationSlug:fixture.slug,loginName:classroom.body.data.loginName,password:resetClassroomPassword.body.data.initialPassword,deviceName:'Renewed classroom'})});
  assert.equal(renewedClassroomLogin.response.status,201);
  const removedKeyApi=await request('/api/v2/enrollment-keys',{method:'POST',headers:authorization,body:JSON.stringify({classroomId:classroom.body.data.id,expiresInHours:1})});
  assert.equal(removedKeyApi.response.status,404);
  const removedRedeemApi=await request('/api/v2/devices/classrooms/redeem',{method:'POST',body:JSON.stringify({key:'ck_removed_key_value_123456789',deviceName:'Removed flow'})});
  assert.equal(removedRedeemApi.response.status,404);
  const disableTeacher=await request(`/api/v2/users/${teacher.body.data.id}`,{method:'PATCH',headers:authorization,body:JSON.stringify({status:'disabled'})});
  assert.equal(disableTeacher.response.status,403);
  const deleteTeacher=await request(`/api/v2/users/${teacher.body.data.id}`,{method:'DELETE',headers:authorization});
  assert.equal(deleteTeacher.response.status,204);
  const deletedTeacher=await request(`/api/v2/users/${teacher.body.data.id}`,{headers:authorization});
  assert.equal(deletedTeacher.response.status,404);
  const deletedSubject=await request(`/api/v2/subjects/${subject.body.data.id}`,{method:'DELETE',headers:authorization});
  assert.equal(deletedSubject.response.status,204);
  const auditList=await request('/api/v2/audit-logs?limit=100',{headers:authorization});
  assert.equal(auditList.response.status,200);
  assert.ok(auditList.body.data.items.some((item)=>item.action==='classroom.students.replace'));
  assert.ok(auditList.body.data.items.some((item)=>item.action==='user.delete'));

  const refresh=await request('/api/v2/auth/refresh',{method:'POST',body:JSON.stringify({refreshToken:login.body.data.refreshToken})});
  assert.equal(refresh.response.status,200);
  assert.notEqual(refresh.body.data.refreshToken,login.body.data.refreshToken);

  const replay=await request('/api/v2/auth/refresh',{method:'POST',body:JSON.stringify({refreshToken:login.body.data.refreshToken})});
  assert.equal(replay.response.status,401);

  const biometric=await request('/api/v2/devices/classrooms/heartbeat',{method:'POST',body:JSON.stringify({deviceToken:'cd_invalid_token_value_123456789',faceEmbedding:[0.1,0.2]})});
  assert.equal(biometric.response.status,400);

  await Promise.all([assertWebSocketRejects('/ws/client'),assertWebSocketRejects('/ws/classroom')]);

  const legacy=await request('/api/v1/system/info');
  assert.equal(legacy.response.status,404);

  const logout=await request('/api/v2/auth/logout',{method:'POST',body:JSON.stringify({refreshToken:refresh.body.data.refreshToken})});
  assert.equal(logout.response.status,204);
  const revoked=await request('/api/v2/auth/me',{headers:{authorization:`Bearer ${refresh.body.data.accessToken}`}});
  assert.equal(revoked.response.status,401);

  console.log(JSON.stringify({ok:true,checks:['tenant-qualified-admin-login','permissions','tenant-scope','management-crud','organization-logo-upload','subject-catalog','subject-validation','role-binding','student-roster','batch-teacher-create','batch-classroom-create','random-initial-passwords','client-v2','profile-v2','device-password-binding','classroom-password-reset','classroom-status-overview','key-management-removed','teacher-disable-rejected','teacher-delete','audit-log','refresh-rotation','refresh-replay-rejection','biometric-boundary','websocket-auth','v1-removed','logout-revocation']}));
}finally{
  await database.query('ROLLBACK').catch(()=>{});
  await database.query('DELETE FROM login_events WHERE user_id=$1',[fixture.userId]);
  await database.query('DELETE FROM refresh_tokens WHERE subject_id=$1',[fixture.userId]);
  await database.query('DELETE FROM organizations WHERE id=$1',[fixture.organizationId]);
  database.release();
  await pool.end();
}
