import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../../common/auth-context.js';
import { accessibleCampusIds, canAccessClassroom, hasOrganizationScope } from '../../common/scope-policy.js';
import { transaction, type Database, type DatabaseClient } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { CreateAssignmentDto, UpdateAssignmentDto, UpdateSubmissionDto } from './teaching.dto.js';

@Injectable()
export class TeachingService {
  constructor(@Inject(DATABASE)private readonly database:Database) {}

  async list(auth:AuthContext,classroomId:string) {
    await this.assertAccess(auth,classroomId,'content.read');
    const[assignments,submissions]=await Promise.all([
      this.database.query("SELECT id,creator_user_id,subject,type,title,publish_at,deadline,source,status,created_at,updated_at FROM assignments WHERE classroom_id=$1 AND status='active' ORDER BY created_at DESC",[classroomId]),
      this.database.query("SELECT s.assignment_id,s.student_id,st.name AS student_name,s.status,s.updated_by,s.updated_at FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN students st ON st.id=s.student_id WHERE a.classroom_id=$1 AND a.status='active'",[classroomId]),
    ]);
    return{assignments:assignments.rows,submissions:submissions.rows};
  }

  async create(auth:AuthContext,classroomId:string,input:CreateAssignmentDto,requestId:string) {
    const classroom=await this.assertAccess(auth,classroomId);
    const subject=await this.configuredSubject(auth,input.subject);
    await this.assertSubjectAccess(auth,classroomId,classroom.campus_id,subject);
    const id=randomUUID();
    return transaction(this.database,async client=>{
      await client.query(
        "INSERT INTO assignments(id,classroom_id,creator_user_id,subject,type,title,deadline,source,status)VALUES($1,$2,$3,$4,$5,$6,$7,'teacher','active')",
        [id,classroomId,auth.subjectId,subject,input.type,input.title.trim(),input.deadline?new Date(input.deadline):null],
      );
      await this.event(client,auth,classroomId,'assignment.created',{id,subject,type:input.type,title:input.title},requestId);
      return(await client.query('SELECT * FROM assignments WHERE id=$1',[id])).rows[0];
    });
  }

  async update(auth:AuthContext,classroomId:string,id:string,input:UpdateAssignmentDto,requestId:string) {
    const classroom=await this.assertAccess(auth,classroomId);
    const current=(await this.database.query("SELECT subject FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'",[id,classroomId])).rows[0];
    if(!current)throw new NotFoundException('作业或通知不存在');
    const subject=input.subject===undefined?String(current.subject||''):await this.configuredSubject(auth,input.subject);
    await this.assertSubjectAccess(auth,classroomId,classroom.campus_id,String(current.subject||''));
    if(subject!==String(current.subject||''))await this.assertSubjectAccess(auth,classroomId,classroom.campus_id,subject);
    return transaction(this.database,async client=>{
      const assignment=(await client.query(
        `UPDATE assignments SET subject=$3,type=COALESCE($4,type),title=COALESCE($5,title),
         deadline=CASE WHEN $6::boolean THEN $7 ELSE deadline END,updated_at=now()
         WHERE id=$1 AND classroom_id=$2 AND status='active' RETURNING *`,
        [id,classroomId,subject,input.type||null,input.title?.trim()||null,input.deadline!==undefined,input.deadline?new Date(input.deadline):null],
      )).rows[0];
      if(!assignment)throw new NotFoundException('作业或通知不存在');
      await this.event(client,auth,classroomId,'assignment.updated',{id},requestId);
      return assignment;
    });
  }

  async remove(auth:AuthContext,classroomId:string,id:string,requestId:string) {
    const classroom=await this.assertAccess(auth,classroomId);
    const current=(await this.database.query("SELECT subject FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'",[id,classroomId])).rows[0];
    if(!current)throw new NotFoundException('作业或通知不存在');
    await this.assertSubjectAccess(auth,classroomId,classroom.campus_id,String(current.subject||''));
    await transaction(this.database,async client=>{
      const result=await client.query("UPDATE assignments SET status='deleted',updated_at=now() WHERE id=$1 AND classroom_id=$2 AND status='active' RETURNING id",[id,classroomId]);
      if(!result.rowCount)throw new NotFoundException('作业或通知不存在');
      await client.query('DELETE FROM submissions WHERE assignment_id=$1',[id]);
      await this.event(client,auth,classroomId,'assignment.deleted',{id},requestId);
    });
  }

  async submission(auth:AuthContext,classroomId:string,assignmentId:string,studentId:string,input:UpdateSubmissionDto,requestId:string) {
    const classroom=await this.assertAccess(auth,classroomId);
    const current=(await this.database.query("SELECT subject FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'",[assignmentId,classroomId])).rows[0];
    if(!current)throw new NotFoundException('作业不存在');
    await this.assertSubjectAccess(auth,classroomId,classroom.campus_id,String(current.subject||''));
    return transaction(this.database,async client=>{
      const submission=(await client.query(
        `INSERT INTO submissions(assignment_id,student_id,status,updated_by)
         SELECT a.id,s.id,$5,$6 FROM assignments a JOIN students s ON s.classroom_id=a.classroom_id
         WHERE a.id=$1 AND a.classroom_id=$2 AND s.id=$3 AND s.classroom_id=$4 AND a.status='active' AND s.status='active'
         ON CONFLICT(assignment_id,student_id)DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
        [assignmentId,classroomId,studentId,classroomId,input.status,auth.subjectId],
      )).rows[0];
      if(!submission)throw new NotFoundException('作业或学生不存在');
      await this.event(client,auth,classroomId,'submission.updated',{assignmentId,studentId,status:input.status},requestId);
      return submission;
    });
  }

  private async assertAccess(auth:AuthContext,classroomId:string,permission:'content.read'|'content.manage'='content.manage') {
    const classroom=(await this.database.query('SELECT campus_id FROM classrooms WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[classroomId,auth.organizationId])).rows[0];
    if(!classroom)throw new NotFoundException('教室不存在');
    if(!canAccessClassroom(auth,classroomId,classroom.campus_id||null,permission))throw new ForbiddenException('无权管理该教室内容');
    return classroom;
  }

  private async assertSubjectAccess(auth:AuthContext,classroomId:string,campusId:string|null,subject:string) {
    if(hasOrganizationScope(auth,'content.manage')||(campusId&&accessibleCampusIds(auth,'content.manage').includes(campusId)))return;
    const member=(await this.database.query(
      "SELECT role,subjects_json FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 AND status='approved'",
      [classroomId,auth.subjectId],
    )).rows[0];
    const subjects=Array.isArray(member?.subjects_json)?member.subjects_json.map((value:unknown)=>String(value).toLocaleLowerCase()):[];
    if(member&&(member.role==='homeroom'||subjects.includes(subject.toLocaleLowerCase())))return;
    throw new ForbiddenException('只能管理已授权学科的内容');
  }

  private async configuredSubject(auth:AuthContext,value:string) {
    const row=(await this.database.query(
      "SELECT name FROM subjects WHERE organization_id=$1 AND deleted_at IS NULL AND status='active' AND lower(name)=lower($2)",
      [auth.organizationId,value.trim()],
    )).rows[0];
    if(!row)throw new BadRequestException('科目未配置或已停用');
    return String(row.name);
  }

  private async event(client:DatabaseClient,auth:AuthContext,classroomId:string,type:string,payload:Record<string,unknown>,requestId:string) {
    const locked=(await client.query('SELECT revision FROM classrooms WHERE id=$1 FOR UPDATE',[classroomId])).rows[0];
    const revision=Number(locked.revision)+1;
    const operationId=randomUUID();
    await client.query('UPDATE classrooms SET revision=$2,last_cloud_mutation_at=now(),updated_at=now() WHERE id=$1',[classroomId,revision]);
    await client.query('INSERT INTO operation_events(classroom_id,revision,operation_id,event_type,payload_json)VALUES($1,$2,$3,$4,$5)',[classroomId,revision,operationId,type,JSON.stringify(payload)]);
    await client.query("INSERT INTO outbox_events(organization_id,aggregate_type,aggregate_id,event_type,payload_json)VALUES($1,'classroom',$2,$3,$4)",[auth.organizationId,classroomId,type,JSON.stringify({revision,...payload})]);
    await client.query("INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json)VALUES($1,'user',$2,$3,'classroom',$4,$5,$6)",[auth.organizationId,auth.subjectId,type,classroomId,requestId,JSON.stringify(payload)]);
  }
}
