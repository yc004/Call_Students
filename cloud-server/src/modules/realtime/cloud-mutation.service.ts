import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AccessSubject } from '../../security.js';
import { transaction, type Database, type DatabaseClient } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import { ClassroomSocketHub } from './classroom-socket-hub.js';

type Membership={role:'homeroom'|'teacher';subjects:string[]};
type MutationMessage=Record<string,unknown>;

@Injectable()
export class CloudMutationService {
  constructor(@Inject(DATABASE)private readonly database:Database,private readonly hub:ClassroomSocketHub) {}

  isDurable(message:MutationMessage) {
    return ['update-classroom','manage-teacher','update-assignments','update-submission'].includes(String(message.type||''));
  }

  async apply(subject:AccessSubject,classroomId:string,message:MutationMessage) {
    const requestedOperationId=String(message.operationId||'');
    const operationId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
      ?requestedOperationId:randomUUID();
    const result=await transaction(this.database,async client=>{
      const classroom=(await client.query(
        `SELECT c.id,c.revision,m.role,m.subjects_json FROM classrooms c JOIN classroom_members m ON m.classroom_id=c.id
         WHERE c.id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL AND c.status='active'
         AND m.user_id=$3 AND m.status='approved' FOR UPDATE OF c`,
        [classroomId,subject.organizationId,subject.subjectId],
      )).rows[0];
      if(!classroom)throw new ForbiddenException('教室成员权限已经失效');
      const effectiveMembership:Membership={
        role:classroom.role==='homeroom'?'homeroom':'teacher',
        subjects:Array.isArray(classroom.subjects_json)?classroom.subjects_json.map(String):[],
      };
      const previous=(await client.query('SELECT revision FROM operation_events WHERE classroom_id=$1 AND operation_id=$2',[classroomId,operationId])).rows[0];
      if(previous)return{revision:Number(previous.revision),operationId,replayed:true};
      const type=String(message.type||'');
      if(type==='update-classroom')await this.updateClassroom(client,classroomId,effectiveMembership,message);
      else if(type==='manage-teacher')await this.manageTeacher(client,classroomId,subject.subjectId,effectiveMembership,message);
      else if(type==='update-assignments')await this.updateAssignment(client,classroomId,subject.subjectId,effectiveMembership,message);
      else if(type==='update-submission')await this.updateSubmission(client,classroomId,subject.subjectId,effectiveMembership,message);
      else throw new BadRequestException('不支持的云端修改命令');
      const revision=Number(classroom.revision||0)+1;
      await client.query('UPDATE classrooms SET revision=$2,last_cloud_mutation_at=now(),updated_at=now() WHERE id=$1',[classroomId,revision]);
      await client.query(
        'INSERT INTO operation_events(classroom_id,revision,operation_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',
        [classroomId,revision,operationId,`relay.${type}`,JSON.stringify({actorId:subject.subjectId})],
      );
      await client.query(
        `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,metadata_json)
         VALUES($1,'user',$2,$3,'classroom',$4,$5)`,
        [subject.organizationId,subject.subjectId,`relay.${type}`,classroomId,JSON.stringify({operationId})],
      );
      return{revision,operationId,replayed:false};
    });
    if(!result.replayed)this.hub.broadcastTo(classroomId,'device','classroom.event',{type:'cloud.invalidate',revision:result.revision,reason:String(message.type)});
    return result;
  }

  private requireHomeroom(membership:Membership) {
    if(membership.role!=='homeroom')throw new ForbiddenException('仅班主任可以执行该操作');
  }

  private canManageSubject(membership:Membership,subject:string) {
    return membership.role==='homeroom'||membership.subjects.some(value=>value.localeCompare(subject,undefined,{sensitivity:'accent'})===0);
  }

  private async updateClassroom(client:DatabaseClient,classroomId:string,membership:Membership,message:MutationMessage) {
    this.requireHomeroom(membership);
    const input=message.classroom&&typeof message.classroom==='object'&&!Array.isArray(message.classroom)?message.classroom as Record<string,unknown>:{};
    const className=String(input.className||'').trim().slice(0,120);
    const source=Array.isArray(input.students)?input.students:[];
    if(!className||source.length<1||source.length>5000)throw new BadRequestException('班级名称和学生名单无效');
    const seenIds=new Set<string>(),seenNames=new Set<string>();
    const students=source.map((item,index)=>{
      const row=item&&typeof item==='object'&&!Array.isArray(item)?item as Record<string,unknown>:{};
      const name=String(row.name||'').trim().slice(0,80);
      const id=String(row.id||randomUUID()).trim().slice(0,128);
      if(!name||!id||seenIds.has(id)||seenNames.has(name))throw new BadRequestException(`学生名单第 ${index+1} 项无效或重复`);
      seenIds.add(id);seenNames.add(name);return{id,name,index};
    });
    await client.query('UPDATE classrooms SET name=$2,configured=true WHERE id=$1',[classroomId,className]);
    for(const student of students)await client.query(
      `INSERT INTO students(id,classroom_id,name,sort_order,status)VALUES($1,$2,$3,$4,'active')
       ON CONFLICT(id)DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now()
       WHERE students.classroom_id=$2`,[student.id,classroomId,student.name,student.index]);
    await client.query("UPDATE students SET status='removed',updated_at=now() WHERE classroom_id=$1 AND NOT(id=ANY($2::text[]))",[classroomId,students.map(student=>student.id)]);
    await client.query("DELETE FROM submissions s USING students st WHERE s.student_id=st.id AND st.classroom_id=$1 AND st.status='removed'",[classroomId]);
  }

  private async manageTeacher(client:DatabaseClient,classroomId:string,operatorId:string,membership:Membership,message:MutationMessage) {
    this.requireHomeroom(membership);
    const action=String(message.action||'');
    const rawId=String(message.connectionId||'').replace(/^cloud-/,'');
    if(!/^[0-9a-f-]{36}$/i.test(rawId))throw new BadRequestException('教师标识无效');
    if(rawId===operatorId&&action!=='update')throw new BadRequestException('不能移除或转让给当前账号');
    const target=(await client.query('SELECT role,status FROM classroom_members WHERE classroom_id=$1 AND user_id=$2',[classroomId,rawId])).rows[0];
    if(!target)throw new NotFoundException('教师成员不存在');
    if(action==='remove'||action==='reject')await client.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2',[classroomId,rawId]);
    else if(action==='approve')await client.query("UPDATE classroom_members SET status='approved',joined_at=COALESCE(joined_at,now()),updated_at=now() WHERE classroom_id=$1 AND user_id=$2",[classroomId,rawId]);
    else if(action==='update'){
      const subjects=await this.validateSubjects(client,classroomId,message.subjects);
      await client.query('UPDATE classroom_members SET subjects_json=$3::jsonb,updated_at=now() WHERE classroom_id=$1 AND user_id=$2',[classroomId,rawId,JSON.stringify(subjects)]);
    } else if(action==='transfer'){
      if(target.status!=='approved')throw new BadRequestException('只能向已批准教师转让班主任');
      await client.query("UPDATE classroom_members SET role='teacher',updated_at=now() WHERE classroom_id=$1 AND user_id=$2",[classroomId,operatorId]);
      await client.query("UPDATE classroom_members SET role='homeroom',updated_at=now() WHERE classroom_id=$1 AND user_id=$2",[classroomId,rawId]);
    } else throw new BadRequestException('教师管理操作无效');
  }

  private async updateAssignment(client:DatabaseClient,classroomId:string,userId:string,membership:Membership,message:MutationMessage) {
    const action=String(message.action||'');
    const input=message.assignment&&typeof message.assignment==='object'&&!Array.isArray(message.assignment)?message.assignment as Record<string,unknown>:{};
    const id=String(input.id||'').trim().slice(0,128);
    if(!id)throw new BadRequestException('作业标识不能为空');
    const existing=(await client.query("SELECT subject,type,source FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'",[id,classroomId])).rows[0];
    const requestedSubject=String(input.subject||'').trim().slice(0,80);
    const canonicalRequested=requestedSubject?await this.validateSubjectName(client,classroomId,requestedSubject):'';
    const subject=action==='add'?canonicalRequested:String(existing?.subject||'');
    if(!subject||!this.canManageSubject(membership,subject))throw new ForbiddenException('只能管理已授权学科的内容');
    if(action==='add'){
      const title=String(input.title||'').trim().slice(0,1000);
      if(!title)throw new BadRequestException('作业标题不能为空');
      await client.query(
        `INSERT INTO assignments(id,classroom_id,creator_user_id,subject,type,title,deadline,source,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'teacher','active')`,
        [id,classroomId,userId,subject,input.type==='notice'?'notice':'homework',title,this.dateOrNull(input.deadline)]);
      await this.syncSubmissions(client,classroomId,id,userId,input.submissions);
    } else if(action==='edit'){
      if(!existing)throw new NotFoundException('作业或通知不存在');
      if(canonicalRequested&&canonicalRequested!==subject&&membership.role!=='homeroom')throw new ForbiddenException('不能转移作业所属学科');
      const title=String(input.title||'').trim().slice(0,1000);
      if(!title)throw new BadRequestException('作业标题不能为空');
      await client.query('UPDATE assignments SET subject=$3,title=$4,deadline=$5,updated_at=now() WHERE id=$1 AND classroom_id=$2',[id,classroomId,canonicalRequested||subject,title,this.dateOrNull(input.deadline)]);
      await this.syncSubmissions(client,classroomId,id,userId,input.submissions);
    } else if(action==='delete'){
      if(!existing)throw new NotFoundException('作业或通知不存在');
      await client.query("UPDATE assignments SET status='deleted',updated_at=now() WHERE id=$1 AND classroom_id=$2",[id,classroomId]);
      await client.query('DELETE FROM submissions WHERE assignment_id=$1',[id]);
    } else throw new BadRequestException('作业操作无效');
  }

  private async updateSubmission(client:DatabaseClient,classroomId:string,userId:string,membership:Membership,message:MutationMessage) {
    const assignmentId=String(message.assignmentId||'').trim().slice(0,128);
    const studentId=String(message.studentId||'').trim().slice(0,128);
    const status=this.submissionStatus(message.status);
    const assignment=(await client.query("SELECT subject,type FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'",[assignmentId,classroomId])).rows[0];
    if(!assignment||assignment.type==='notice')throw new NotFoundException('作业不存在');
    if(!this.canManageSubject(membership,String(assignment.subject||'')))throw new ForbiddenException('只能管理已授权学科的作业');
    const result=await client.query(
      `INSERT INTO submissions(assignment_id,student_id,status,updated_by)
       SELECT $1,s.id,$4,$5 FROM students s WHERE s.id=$2 AND s.classroom_id=$3 AND s.status='active'
       ON CONFLICT(assignment_id,student_id)DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [assignmentId,studentId,classroomId,status,userId]);
    if(!result.rowCount)throw new NotFoundException('学生不存在');
  }

  private async validateSubjects(client:DatabaseClient,classroomId:string,value:unknown) {
    const requested=Array.from(new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))).slice(0,20);
    if(!requested.length)throw new BadRequestException('至少需要一个授课科目');
    const rows=(await client.query(
      `SELECT s.name FROM subjects s JOIN classrooms c ON c.organization_id=s.organization_id
       WHERE c.id=$1 AND s.deleted_at IS NULL AND s.status='active' AND lower(s.name)=ANY($2::text[])`,
      [classroomId,requested.map(item=>item.toLowerCase())])).rows;
    if(rows.length!==requested.length)throw new BadRequestException('包含未配置或已停用的科目');
    const names=new Map(rows.map(row=>[String(row.name).toLowerCase(),String(row.name)]));
    return requested.map(item=>names.get(item.toLowerCase())!);
  }

  private async validateSubjectName(client:DatabaseClient,classroomId:string,value:string) {
    const row=(await client.query(
      `SELECT s.name FROM subjects s JOIN classrooms c ON c.organization_id=s.organization_id
       WHERE c.id=$1 AND s.deleted_at IS NULL AND s.status='active' AND lower(s.name)=lower($2)`,
      [classroomId,value],
    )).rows[0];
    if(!row)throw new BadRequestException('科目未配置或已停用');
    return String(row.name);
  }

  private async syncSubmissions(client:DatabaseClient,classroomId:string,assignmentId:string,userId:string,value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))return;
    const entries=Object.entries(value as Record<string,unknown>);
    if(entries.length>5000)throw new BadRequestException('提交状态数量超出限制');
    for(const[studentId,rawStatus]of entries){
      const status=this.submissionStatus(rawStatus);
      const result=await client.query(
        `INSERT INTO submissions(assignment_id,student_id,status,updated_by)
         SELECT $1,s.id,$4,$5 FROM students s WHERE s.id=$2 AND s.classroom_id=$3 AND s.status='active'
         ON CONFLICT(assignment_id,student_id)DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [assignmentId,String(studentId).slice(0,128),classroomId,status,userId],
      );
      if(!result.rowCount)throw new BadRequestException('提交状态包含无效学生');
    }
  }

  private submissionStatus(value:unknown) {
    const status=String(value||'').trim();
    if(!status||status.length>20)throw new BadRequestException('提交状态无效');
    return status;
  }

  private dateOrNull(value:unknown) {
    if(value===null||value===undefined||value==='')return null;
    const date=new Date(String(value));
    if(Number.isNaN(date.getTime()))throw new BadRequestException('截止时间无效');
    return date;
  }
}
