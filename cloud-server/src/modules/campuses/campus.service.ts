import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/auth-context.js';
import { canAccessCampus, hasOrganizationScope } from '../../common/scope-policy.js';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { CreateCampusDto, UpdateCampusDto } from './campus.dto.js';
import { CampusRepository } from './campus.repository.js';

@Injectable()
export class CampusService {
  constructor(private readonly repository:CampusRepository,@Inject(DATABASE) private readonly database:Database) {}

  async list(auth:AuthContext) {
    const rows=await this.repository.list(auth.organizationId);
    return hasOrganizationScope(auth,'campus.read')?rows:rows.filter(row=>canAccessCampus(auth,row.id,'campus.read'));
  }

  async create(auth:AuthContext,input:CreateCampusDto,requestId:string) {
    if (!hasOrganizationScope(auth,'campus.manage')) throw new ForbiddenException('只有组织范围管理员可以创建校区');
    try {
      const row=await this.repository.create(auth.organizationId,auth.subjectId,input);
      await this.audit(auth,'campus.create',row.id,requestId);
      return row;
    } catch (error) {
      if ((error as {code?:string}).code==='23505') throw new ConflictException('校区编码已经存在');
      throw error;
    }
  }

  async update(auth:AuthContext,id:string,input:UpdateCampusDto,requestId:string) {
    if (!canAccessCampus(auth,id,'campus.manage')) throw new ForbiddenException('无权管理该校区');
    const row=await this.repository.update(auth.organizationId,id,auth.subjectId,input);
    if (!row) throw new NotFoundException('校区不存在');
    await this.audit(auth,'campus.update',id,requestId);
    return row;
  }

  async archive(auth:AuthContext,id:string,requestId:string) {
    if (!hasOrganizationScope(auth,'campus.manage')) throw new ForbiddenException('只有组织范围管理员可以归档校区');
    const row=await this.repository.archive(auth.organizationId,id,auth.subjectId);
    if (!row) throw new NotFoundException('校区不存在');
    await this.audit(auth,'campus.archive',id,requestId);
  }

  private async audit(auth:AuthContext,action:string,targetId:string,requestId:string) {
    await this.database.query(
      `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id)
       VALUES($1,'user',$2,$3,'campus',$4,$5)`,[auth.organizationId,auth.subjectId,action,targetId,requestId]);
  }
}
