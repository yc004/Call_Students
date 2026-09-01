import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/auth-context.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';
import { transaction, type Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { CreateRoleBindingDto, CreateRoleDto, SetRolePermissionsDto } from './authorization.dto.js';
import { PERMISSIONS } from './permission.catalog.js';

@Injectable()
export class AuthorizationService {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  permissionCatalog(){ return PERMISSIONS; }

  async roles(auth:AuthContext){
    return (await this.database.query(
      `SELECT r.id,r.code,r.name,r.description,r.data_scope,r.is_system,r.status,r.created_at,
              COALESCE(array_remove(array_agg(rp.permission_key ORDER BY rp.permission_key),NULL),'{}') AS permissions,
              count(DISTINCT b.id)::int AS binding_count
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN user_role_bindings b ON b.role_id=r.id
       WHERE r.organization_id=$1 GROUP BY r.id ORDER BY r.is_system DESC,r.name`,[auth.organizationId])).rows;
  }

  async createRole(auth:AuthContext,input:CreateRoleDto,requestId:string){
    this.requireOrganizationScope(auth); this.validatePermissions(input.permissions);
    try {
      return await transaction(this.database,async client=>{
        const role=(await client.query(
          `INSERT INTO roles(organization_id,code,name,description,data_scope,is_system)
           VALUES($1,lower($2),$3,$4,$5,false) RETURNING *`,
          [auth.organizationId,input.code.trim(),input.name.trim(),input.description?.trim()||'',input.dataScope])).rows[0];
        if(input.permissions.length) await client.query(
          'INSERT INTO role_permissions(role_id,permission_key) SELECT $1,unnest($2::text[])',[role.id,input.permissions]);
        await this.audit(client,auth,'role.create','role',role.id,requestId);
        return {...role,permissions:input.permissions};
      });
    } catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('角色编码已经存在');throw error;}
  }

  async setPermissions(auth:AuthContext,roleId:string,input:SetRolePermissionsDto,requestId:string){
    this.requireOrganizationScope(auth);this.validatePermissions(input.permissions);
    return transaction(this.database,async client=>{
      const role=(await client.query('SELECT id,is_system,code FROM roles WHERE id=$1 AND organization_id=$2 FOR UPDATE',[roleId,auth.organizationId])).rows[0];
      if(!role)throw new NotFoundException('角色不存在');
      if(role.code==='organization_owner')throw new ForbiddenException('组织所有者权限不可削减');
      await client.query('DELETE FROM role_permissions WHERE role_id=$1',[roleId]);
      if(input.permissions.length)await client.query('INSERT INTO role_permissions(role_id,permission_key) SELECT $1,unnest($2::text[])',[roleId,input.permissions]);
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id IN(SELECT user_id FROM user_role_bindings WHERE role_id=$1)',[roleId]);
      await this.audit(client,auth,'role.permissions.update','role',roleId,requestId);
      return {id:roleId,permissions:input.permissions};
    });
  }

  async bind(auth:AuthContext,userId:string,input:CreateRoleBindingDto,requestId:string){
    this.requireOrganizationScope(auth);
    return transaction(this.database,async client=>{
      const [user,role]=await Promise.all([
        client.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[userId,auth.organizationId]),
        client.query("SELECT id,data_scope FROM roles WHERE id=$1 AND organization_id=$2 AND status='active'",[input.roleId,auth.organizationId]),
      ]);
      if(!user.rowCount||!role.rowCount)throw new NotFoundException('用户或角色不存在');
      if(role.rows[0].data_scope!==input.scopeType && role.rows[0].data_scope!=='self')throw new BadRequestException('角色数据范围与授权范围不一致');
      await this.verifyScope(client,auth.organizationId,input.scopeType,input.scopeId);
      const binding=(await client.query(
        `INSERT INTO user_role_bindings(organization_id,user_id,role_id,scope_type,scope_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
        [auth.organizationId,userId,input.roleId,input.scopeType,input.scopeId,auth.subjectId])).rows[0];
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[userId]);
      await this.audit(client,auth,'role.binding.create','user',userId,requestId);
      return binding||{unchanged:true};
    });
  }

  async unbind(auth:AuthContext,bindingId:string,requestId:string){
    this.requireOrganizationScope(auth);
    await transaction(this.database,async client=>{
      const result=await client.query(
        `DELETE FROM user_role_bindings WHERE id=$1 AND organization_id=$2
         AND role_id NOT IN(SELECT id FROM roles WHERE code='organization_owner') RETURNING user_id`,[bindingId,auth.organizationId]);
      if(!result.rowCount)throw new NotFoundException('授权不存在或不可删除');
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[result.rows[0].user_id]);
      await this.audit(client,auth,'role.binding.delete','user',result.rows[0].user_id,requestId);
    });
  }

  private validatePermissions(values:string[]){const invalid=values.filter(v=>!(PERMISSIONS as readonly string[]).includes(v));if(invalid.length)throw new BadRequestException(`未知权限：${invalid.join('、')}`);}
  private requireOrganizationScope(auth:AuthContext){if(!hasOrganizationScope(auth,'role.manage'))throw new ForbiddenException('只有组织范围管理员可以管理角色');}
  private async verifyScope(client:{query:Database['query']},org:string,type:string,id:string){
    if(type==='organization'&&id===org)return;
    const table=type==='campus'?'campuses':type==='classroom'?'classrooms':'';
    if(!table)throw new BadRequestException('授权范围无效');
    const found=await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`,[id,org]);
    if(!found.rowCount)throw new BadRequestException('授权目标不属于当前组织');
  }
  private audit(client:{query:Database['query']},auth:AuthContext,action:string,targetType:string,targetId:string,requestId:string){return client.query(
    `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id) VALUES($1,'user',$2,$3,$4,$5,$6)`,
    [auth.organizationId,auth.subjectId,action,targetType,targetId,requestId]);}
}
