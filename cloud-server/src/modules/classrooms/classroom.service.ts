import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../../common/auth-context.js';
import { accessibleCampusIds, accessibleClassroomIds, canAccessClassroom, canAccessCampus, hasOrganizationScope } from '../../common/scope-policy.js';
import { transaction, type Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import { generateClassroomLoginName, generateInitialPassword, hashPassword } from '../../security.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';
import type { BatchCreateClassroomsDto, CreateClassroomDto, MemberDto, ReplaceStudentsDto, UpdateClassroomDto } from './classroom.dto.js';

@Injectable()
export class ClassroomService {
  constructor(@Inject(DATABASE) private readonly database:Database,private readonly hub:ClassroomSocketHub) {}

  async list(auth:AuthContext) {
    const campusIds=accessibleCampusIds(auth,'classroom.read');
    const classroomIds=accessibleClassroomIds(auth,'classroom.read');
    return (await this.database.query(
      `SELECT c.id,c.name,c.status,c.configured,c.revision,c.campus_id,cp.name AS campus_name,c.last_device_sync_at,c.created_at,ca.login_name,
       count(DISTINCT s.id)FILTER(WHERE s.status='active')::int AS student_count,count(DISTINCT m.id)FILTER(WHERE m.status='approved')::int AS member_count,
       count(DISTINCT d.id)FILTER(WHERE d.revoked_at IS NULL)::int AS device_count
       FROM classrooms c LEFT JOIN campuses cp ON cp.id=c.campus_id LEFT JOIN classroom_accounts ca ON ca.classroom_id=c.id
       LEFT JOIN students s ON s.classroom_id=c.id LEFT JOIN classroom_members m ON m.classroom_id=c.id LEFT JOIN classroom_devices d ON d.classroom_id=c.id
       WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND ($2::boolean OR c.campus_id=ANY($3::uuid[]) OR c.id=ANY($4::uuid[]))
       GROUP BY c.id,cp.name,ca.login_name ORDER BY c.name`,
      [auth.organizationId,hasOrganizationScope(auth,'classroom.read'),campusIds,classroomIds],
    )).rows;
  }

  async statusOverview(auth:AuthContext) {
    const campusIds=accessibleCampusIds(auth,'classroom.read');
    const classroomIds=accessibleClassroomIds(auth,'classroom.read');
    const rawRows=(await this.database.query(
      `SELECT c.id,c.name,c.status AS classroom_status,c.configured,c.revision,c.campus_id,cp.name AS campus_name,c.last_device_sync_at,
       (SELECT count(*)::int FROM students s WHERE s.classroom_id=c.id AND s.status='active') AS student_count,
       (SELECT count(*)::int FROM classroom_members m WHERE m.classroom_id=c.id AND m.status='approved') AS teacher_count,
       d.id AS device_id,d.device_name,d.app_version,d.last_seen_at AS device_last_seen_at,d.operational_status_json,d.operational_status_updated_at,
       CASE WHEN d.id IS NULL THEN 'unbound' WHEN d.last_seen_at>=now()-interval '60 seconds' THEN 'online' ELSE 'offline' END AS connection_status
       FROM classrooms c LEFT JOIN campuses cp ON cp.id=c.campus_id
       LEFT JOIN LATERAL(SELECT id,device_name,app_version,last_seen_at,operational_status_json,operational_status_updated_at FROM classroom_devices WHERE classroom_id=c.id AND revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST,created_at DESC LIMIT 1)d ON true
       WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND c.status<>'archived' AND ($2::boolean OR c.campus_id=ANY($3::uuid[]) OR c.id=ANY($4::uuid[]))
       ORDER BY CASE WHEN d.last_seen_at>=now()-interval '60 seconds' THEN 0 WHEN d.id IS NOT NULL THEN 1 ELSE 2 END,c.name`,
      [auth.organizationId,hasOrganizationScope(auth,'classroom.read'),campusIds,classroomIds],
    )).rows;
    const rows=rawRows.map(row=>{
      const source:Record<string,unknown>=row.operational_status_json&&typeof row.operational_status_json==='object'?row.operational_status_json as Record<string,unknown>:{};
      const statusFresh=row.connection_status==='online'&&row.operational_status_updated_at&&Date.now()-new Date(row.operational_status_updated_at).getTime()<70_000;
      return{...row,app_ready:statusFresh&&source.appReady===true,device_status_fresh:!!statusFresh};
    });
    return {
      summary:{totalClassrooms:rows.length,onlineClassrooms:rows.filter(row=>row.connection_status==='online').length,offlineClassrooms:rows.filter(row=>row.connection_status==='offline').length,unboundClassrooms:rows.filter(row=>row.connection_status==='unbound').length,registeredStudents:rows.reduce((sum,row)=>sum+Number(row.student_count||0),0),teacherMembers:rows.reduce((sum,row)=>sum+Number(row.teacher_count||0),0)},
      items:rows,
      privacy:{attendanceCloudAvailable:false,message:'人脸识别、在场人数和学生出勤结果仅保留在教室本机，云端只接收设备在线与健康状态。'},
      generatedAt:new Date().toISOString(),
    };
  }

  async detail(auth:AuthContext,id:string) {
    const classroom=(await this.database.query(
      'SELECT c.*,cp.name AS campus_name,ca.login_name FROM classrooms c LEFT JOIN campuses cp ON cp.id=c.campus_id LEFT JOIN classroom_accounts ca ON ca.classroom_id=c.id WHERE c.id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL',
      [id,auth.organizationId],
    )).rows[0];
    if(!classroom)throw new NotFoundException('教室不存在');
    if(!canAccessClassroom(auth,id,classroom.campus_id||null,'classroom.read'))throw new ForbiddenException('无权访问该教室');
    const [students,members,devices]=await Promise.all([
      this.database.query("SELECT id,name,sort_order,status,created_at,updated_at FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at",[id]),
      this.database.query('SELECT m.id,m.user_id,u.name,m.role,m.status,m.subjects_json,m.joined_at FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 ORDER BY m.created_at',[id]),
      this.database.query('SELECT id,device_name,status,app_version,last_seen_at,revoked_at,created_at FROM classroom_devices WHERE classroom_id=$1 ORDER BY created_at DESC',[id]),
    ]);
    return{classroom,students:students.rows,members:members.rows,devices:devices.rows};
  }

  async create(auth:AuthContext,input:CreateClassroomDto,requestId:string) {
    await this.assertCampus(auth,input.campusId);
    const credential=await this.createCredential(input.loginName);
    try {
      const classroom=await transaction(this.database,async client=>{
        const created=(await client.query("INSERT INTO classrooms(organization_id,campus_id,name,status)VALUES($1,$2,$3,'active')RETURNING *",[auth.organizationId,input.campusId,input.name.trim()])).rows[0];
        await client.query('INSERT INTO classroom_accounts(organization_id,classroom_id,login_name,password_hash)VALUES($1,$2,$3,$4)',[auth.organizationId,created.id,credential.loginName,credential.passwordHash]);
        return created;
      });
      await this.audit(auth,'classroom.create',classroom.id,requestId,{loginName:credential.loginName});
      return{...classroom,loginName:credential.loginName,initialPassword:credential.initialPassword};
    } catch(error) {
      if((error as{code?:string}).code==='23505')throw new ConflictException('教室登录账号已经存在');
      throw error;
    }
  }

  async batchCreate(auth:AuthContext,input:BatchCreateClassroomsDto,requestId:string) {
    if(!input.items.length)throw new BadRequestException('请至少提供一个教室');
    for(const item of input.items)await this.assertCampus(auth,item.campusId);
    const normalized=input.items.map(item=>({name:item.name.trim(),campusId:item.campusId,loginName:item.loginName?.trim()}));
    const provided=normalized.map(item=>item.loginName?.toLowerCase()).filter(Boolean) as string[];
    if(new Set(provided).size!==provided.length)throw new BadRequestException('导入文件中教室登录账号重复');
    if(provided.length){const existing=await this.database.query('SELECT login_name FROM classroom_accounts WHERE organization_id=$1 AND lower(login_name)=ANY($2::text[])',[auth.organizationId,provided]);if(existing.rowCount)throw new ConflictException(`教室登录账号已经存在：${existing.rows.map(row=>row.login_name).join('、')}`);}
    const credentials=await Promise.all(normalized.map(async item=>({...item,...await this.createCredential(item.loginName)})));
    try {
      const result=await transaction(this.database,async client=>{
        const items=[];
        for(const item of credentials){
          const classroom=(await client.query("INSERT INTO classrooms(organization_id,campus_id,name,status)VALUES($1,$2,$3,'active')RETURNING *",[auth.organizationId,item.campusId,item.name])).rows[0];
          await client.query('INSERT INTO classroom_accounts(organization_id,classroom_id,login_name,password_hash)VALUES($1,$2,$3,$4)',[auth.organizationId,classroom.id,item.loginName,item.passwordHash]);
          items.push({...classroom,loginName:item.loginName,initialPassword:item.initialPassword});
        }
        return{items,passwordRule:'C-XXXX-XXXX-XX'};
      });
      await this.audit(auth,'classroom.batch-create',auth.organizationId,requestId,{count:input.items.length});
      return result;
    } catch(error) {
      if((error as{code?:string}).code==='23505')throw new ConflictException('教室名称或登录账号发生冲突，请重试');
      throw error;
    }
  }

  async resetPassword(auth:AuthContext,id:string,requestId:string) {
    await this.assertManage(auth,id);
    const current=(await this.database.query('SELECT login_name FROM classroom_accounts WHERE classroom_id=$1',[id])).rows[0];
    const credential=await this.createCredential(current?.login_name);
    await this.database.query(
      `INSERT INTO classroom_accounts(organization_id,classroom_id,login_name,password_hash)VALUES($1,$2,$3,$4)
       ON CONFLICT(classroom_id)DO UPDATE SET password_hash=EXCLUDED.password_hash,auth_version=classroom_accounts.auth_version+1,updated_at=now()`,
      [auth.organizationId,id,credential.loginName,credential.passwordHash],
    );
    await this.audit(auth,'classroom.password.reset',id,requestId);
    return{classroomId:id,loginName:credential.loginName,initialPassword:credential.initialPassword,passwordRule:'C-XXXX-XXXX-XX'};
  }

  async update(auth:AuthContext,id:string,input:UpdateClassroomDto,requestId:string) {
    const current=(await this.database.query('SELECT campus_id FROM classrooms WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[id,auth.organizationId])).rows[0];
    if(!current)throw new NotFoundException('教室不存在');
    if(!canAccessClassroom(auth,id,current.campus_id||null,'classroom.manage'))throw new ForbiddenException('无权管理该教室');
    if(input.campusId&&!canAccessCampus(auth,input.campusId,'classroom.manage'))throw new ForbiddenException('无权移动到该校区');
    const classroom=(await this.database.query('UPDATE classrooms SET name=COALESCE($3,name),campus_id=COALESCE($4,campus_id),status=COALESCE($5,status),updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *',[id,auth.organizationId,input.name?.trim()||null,input.campusId||null,input.status||null])).rows[0];
    await this.invalidateDeviceSnapshot(id,'classroom.updated');
    await this.audit(auth,'classroom.update',id,requestId);
    return classroom;
  }

  async archive(auth:AuthContext,id:string,requestId:string) {
    await this.assertManage(auth,id);
    const classroom=(await this.database.query("UPDATE classrooms SET status='archived',deleted_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING campus_id",[id,auth.organizationId])).rows[0];
    if(!classroom)throw new NotFoundException('教室不存在');
    await this.audit(auth,'classroom.archive',id,requestId);
  }

  async replaceStudents(auth:AuthContext,id:string,input:ReplaceStudentsDto,requestId:string) {
    await this.assertManage(auth,id);
    await transaction(this.database,async client=>{
      const ids:string[]=[];
      for(let index=0;index<input.students.length;index++){
        const student=input.students[index]!;
        const studentId=student.id||randomUUID();
        ids.push(studentId);
        await client.query("INSERT INTO students(id,classroom_id,name,sort_order,status)VALUES($1,$2,$3,$4,'active')ON CONFLICT(id)DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now() WHERE students.classroom_id=$2",[studentId,id,student.name.trim(),index]);
      }
      await client.query("UPDATE students SET status='removed',updated_at=now() WHERE classroom_id=$1 AND NOT(id=ANY($2::text[]))",[id,ids]);
      await client.query("DELETE FROM submissions s USING students st WHERE s.student_id=st.id AND st.classroom_id=$1 AND st.status='removed'",[id]);
    });
    await this.invalidateDeviceSnapshot(id,'students.replaced');
    await this.audit(auth,'classroom.students.replace',id,requestId,{count:input.students.length});
    return this.detail(auth,id);
  }

  async upsertMember(auth:AuthContext,id:string,input:MemberDto,requestId:string) {
    await this.assertManage(auth,id);
    const user=await this.database.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND status='active' AND deleted_at IS NULL",[input.userId,auth.organizationId]);
    if(!user.rowCount)throw new BadRequestException('教师不存在');
    const requested=[...new Map(input.subjects.map(value=>[value.trim().toLowerCase(),value.trim()])).values()];
    const configured=requested.length?(await this.database.query("SELECT name FROM subjects WHERE organization_id=$1 AND deleted_at IS NULL AND status='active' AND lower(name)=ANY($2::text[])",[auth.organizationId,requested.map(value=>value.toLowerCase())])).rows:[];
    if(configured.length!==requested.length)throw new BadRequestException('包含未配置或已停用的科目');
    const namesByLower=new Map(configured.map(row=>[String(row.name).toLowerCase(),String(row.name)]));
    const subjects=requested.map(value=>namesByLower.get(value.toLowerCase())!);
    await transaction(this.database,async client=>{
      if(input.role==='homeroom')await client.query("UPDATE classroom_members SET role='teacher',updated_at=now() WHERE classroom_id=$1 AND role='homeroom' AND user_id<>$2",[id,input.userId]);
      await client.query("INSERT INTO classroom_members(classroom_id,user_id,role,status,subjects_json,joined_at,sync_source)VALUES($1,$2,$3,'approved',$4,now(),'cloud')ON CONFLICT(classroom_id,user_id)DO UPDATE SET role=EXCLUDED.role,status='approved',subjects_json=EXCLUDED.subjects_json,joined_at=COALESCE(classroom_members.joined_at,now()),updated_at=now()",[id,input.userId,input.role,JSON.stringify(subjects)]);
    });
    await this.invalidateDeviceSnapshot(id,'members.updated');
    await this.audit(auth,'classroom.member.upsert',id,requestId,{userId:input.userId,subjects});
  }

  async removeMember(auth:AuthContext,id:string,userId:string,requestId:string) {
    await this.assertManage(auth,id);
    const result=await this.database.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 RETURNING id',[id,userId]);
    if(!result.rowCount)throw new NotFoundException('成员不存在');
    await this.invalidateDeviceSnapshot(id,'members.updated');
    await this.audit(auth,'classroom.member.remove',id,requestId,{userId});
  }

  private async createCredential(loginName?:string) {
    const initialPassword=generateInitialPassword('classroom');
    return{loginName:loginName?.trim()||generateClassroomLoginName(),initialPassword,passwordHash:await hashPassword(initialPassword)};
  }

  private async assertCampus(auth:AuthContext,campusId:string) {
    if(!canAccessCampus(auth,campusId,'classroom.manage'))throw new ForbiddenException('无权在该校区创建教室');
    const campus=await this.database.query('SELECT 1 FROM campuses WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[campusId,auth.organizationId]);
    if(!campus.rowCount)throw new BadRequestException('校区不存在');
  }

  private async assertManage(auth:AuthContext,id:string) {
    const classroom=(await this.database.query('SELECT campus_id FROM classrooms WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[id,auth.organizationId])).rows[0];
    if(!classroom)throw new NotFoundException('教室不存在');
    if(!canAccessClassroom(auth,id,classroom.campus_id||null,'classroom.manage'))throw new ForbiddenException('无权管理该教室');
  }

  private async invalidateDeviceSnapshot(id:string,reason:string) {
    const row=(await this.database.query(
      `UPDATE classrooms c SET configured=(btrim(c.name)<>'' AND EXISTS(SELECT 1 FROM students s WHERE s.classroom_id=c.id AND s.status='active')),
       revision=revision+1,last_cloud_mutation_at=now(),updated_at=now() WHERE c.id=$1 AND c.deleted_at IS NULL RETURNING revision,configured`,
      [id],
    )).rows[0];
    if(row)this.hub.broadcastTo(id,'device','classroom.event',{type:'cloud.invalidate',revision:Number(row.revision||0),reason});
  }

  private audit(auth:AuthContext,action:string,id:string,requestId:string,metadata:Record<string,unknown>={}) {
    return this.database.query("INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json)VALUES($1,'user',$2,$3,'classroom',$4,$5,$6)",[auth.organizationId,auth.subjectId,action,id,requestId,JSON.stringify(metadata)]);
  }
}
