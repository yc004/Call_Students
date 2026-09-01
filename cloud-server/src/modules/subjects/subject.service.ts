import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../../common/auth-context.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';
import { transaction, type Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { CreateSubjectDto, UpdateSubjectDto } from './subject.dto.js';

@Injectable()
export class SubjectService {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  async list(auth:AuthContext,activeOnly:boolean) {
    const statusClause=activeOnly?"AND status='active'":'';
    return (await this.database.query(
      `SELECT id,name,code,status,sort_order,created_at,updated_at
       FROM subjects WHERE organization_id=$1 AND deleted_at IS NULL ${statusClause}
       ORDER BY sort_order,name`,[auth.organizationId])).rows;
  }

  async create(auth:AuthContext,input:CreateSubjectDto,requestId:string) {
    this.requireOrganizationManager(auth);
    const id=randomUUID();
    try {
      const row=(await this.database.query(
        `INSERT INTO subjects(id,organization_id,name,code,sort_order,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id,name,code,status,sort_order,created_at,updated_at`,
        [id,auth.organizationId,input.name.trim(),`subject-${id.replaceAll('-','').slice(0,12)}`,input.sortOrder??0,auth.subjectId])).rows[0];
      await this.audit(auth,'subject.create',id,requestId);
      return row;
    } catch (error) {
      if ((error as {code?:string}).code==='23505') throw new ConflictException('科目名称已经存在');
      throw error;
    }
  }

  async update(auth:AuthContext,id:string,input:UpdateSubjectDto,requestId:string) {
    this.requireOrganizationManager(auth);
    try {
      const row=await transaction(this.database,async client=>{
        const current=(await client.query(
          'SELECT name FROM subjects WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE',
          [id,auth.organizationId])).rows[0];
        if (!current) throw new NotFoundException('科目不存在');
        const updated=(await client.query(
          `UPDATE subjects SET name=COALESCE($3,name),sort_order=COALESCE($4,sort_order),
           status=COALESCE($5,status),updated_by=$6,updated_at=now()
           WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
           RETURNING id,name,code,status,sort_order,created_at,updated_at`,
          [id,auth.organizationId,input.name?.trim()||null,input.sortOrder??null,input.status||null,auth.subjectId])).rows[0];
        if (updated.name!==current.name) {
          await client.query(
            `UPDATE assignments a SET subject=$1,updated_at=now() FROM classrooms c
             WHERE a.classroom_id=c.id AND c.organization_id=$2 AND a.subject=$3`,
            [updated.name,auth.organizationId,current.name]);
          await client.query(
            `UPDATE classroom_members m SET subjects_json=(
               SELECT jsonb_agg(CASE WHEN value=$1 THEN $2 ELSE value END)
               FROM jsonb_array_elements_text(m.subjects_json) AS value
             ),updated_at=now() FROM classrooms c
             WHERE m.classroom_id=c.id AND c.organization_id=$3 AND m.subjects_json ? $1`,
            [current.name,updated.name,auth.organizationId]);
        }
        return updated;
      });
      await this.audit(auth,'subject.update',id,requestId);
      return row;
    } catch (error) {
      if ((error as {code?:string}).code==='23505') throw new ConflictException('科目名称已经存在');
      throw error;
    }
  }

  async archive(auth:AuthContext,id:string,requestId:string) {
    this.requireOrganizationManager(auth);
    const row=(await this.database.query(
      `UPDATE subjects SET status='disabled',deleted_at=now(),updated_by=$3,updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING id`,
      [id,auth.organizationId,auth.subjectId])).rows[0];
    if (!row) throw new NotFoundException('科目不存在');
    await this.audit(auth,'subject.delete',id,requestId);
  }

  private requireOrganizationManager(auth:AuthContext) {
    if (!hasOrganizationScope(auth,'organization.manage')) throw new ForbiddenException('只有组织范围管理员可以管理科目配置');
  }

  private audit(auth:AuthContext,action:string,targetId:string,requestId:string) {
    return this.database.query(
      `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id)
       VALUES($1,'user',$2,$3,'subject',$4,$5)`,
      [auth.organizationId,auth.subjectId,action,targetId,requestId]);
  }
}
