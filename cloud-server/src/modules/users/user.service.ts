import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/auth-context.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';
import { transaction,type Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import { generateInitialPassword, hashPassword } from '../../security.js';
import type { BatchCreateTeachersDto, CreateUserDto, UpdateUserDto, UserQueryDto } from './user.dto.js';
import { UserRepository } from './user.repository.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';

@Injectable()
export class UserService{
 constructor(private readonly repository:UserRepository,@Inject(DATABASE)private readonly database:Database,private readonly hub:ClassroomSocketHub){}
 async list(auth:AuthContext,q:UserQueryDto){this.requireOrgRead(auth);const[rows,total]=await Promise.all([this.repository.list(auth.organizationId,q),this.repository.count(auth.organizationId,q)]);const hasMore=rows.length>q.limit;const items=rows.slice(0,q.limit);return{items,nextCursor:hasMore?items.at(-1)?.created_at:null,total};}
 async detail(auth:AuthContext,id:string){this.requireOrgRead(auth);const row=await this.repository.detail(auth.organizationId,id);if(!row)throw new NotFoundException('用户不存在');return row;}
 async create(auth:AuthContext,input:CreateUserDto,requestId:string){this.requireOrg(auth);const initialPassword=generateInitialPassword(input.serverRole==='teacher'?'teacher':'admin');const passwordHash=await hashPassword(initialPassword);try{const user=await transaction(this.database,async client=>{
  const user=(await client.query(
   `INSERT INTO users(organization_id,name,login_name,password_hash,server_role,status,must_change_password)
    VALUES($1,$2,$3,$4,$5,'active',true) RETURNING id,name,login_name,server_role,status,must_change_password,created_at`,
   [auth.organizationId,input.name.trim(),input.loginName.trim(),passwordHash,input.serverRole])).rows[0];
  await this.audit(client,auth,'user.create',user.id,requestId,{serverRole:input.serverRole});return user;
 });return{...user,initialPassword};}catch(error){if((error as{code?:string}).code==='23505')throw new ConflictException('登录账号已经存在');throw error;}}
 async batchCreateTeachers(auth:AuthContext,input:BatchCreateTeachersDto,requestId:string){this.requireOrg(auth);if(!input.items.length)throw new BadRequestException('请至少提供一名教师');const normalized=input.items.map(item=>({name:item.name.trim(),loginName:item.loginName.trim()}));const seen=new Set<string>();for(const item of normalized){const key=item.loginName.toLowerCase();if(seen.has(key))throw new BadRequestException(`导入文件中登录账号重复：${item.loginName}`);seen.add(key);}const existing=await this.database.query('SELECT login_name FROM users WHERE organization_id=$1 AND deleted_at IS NULL AND lower(login_name)=ANY($2::text[])',[auth.organizationId,[...seen]]);if(existing.rowCount)throw new ConflictException(`登录账号已经存在：${existing.rows.map(row=>row.login_name).join('、')}`);const credentials=await Promise.all(normalized.map(async item=>{const initialPassword=generateInitialPassword('teacher');return{...item,initialPassword,passwordHash:await hashPassword(initialPassword)};}));return transaction(this.database,async client=>{const items=[];for(const item of credentials){const user=(await client.query(`INSERT INTO users(organization_id,name,login_name,password_hash,server_role,status,must_change_password)VALUES($1,$2,$3,$4,'teacher','active',true)RETURNING id,name,login_name,server_role,status,must_change_password,created_at`,[auth.organizationId,item.name,item.loginName,item.passwordHash])).rows[0];items.push({...user,initialPassword:item.initialPassword});await this.audit(client,auth,'user.create',user.id,requestId,{serverRole:'teacher',batch:true});}return{items,passwordRule:'T-XXXX-XXXX-XX'};});}
 async update(auth:AuthContext,id:string,input:UpdateUserDto,requestId:string){this.requireOrg(auth);if(id===auth.subjectId&&input.status==='disabled')throw new ForbiddenException('不能停用当前登录账号');const shouldRevoke=input.status==='disabled'||!!input.serverRole;const devices=shouldRevoke?(await this.database.query('SELECT id FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL',[id])).rows:[];const result=await transaction(this.database,async client=>{
  const current=(await client.query('SELECT server_role FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[id,auth.organizationId])).rows[0];
  if(!current)throw new NotFoundException('用户不存在');
  const effectiveRole=input.serverRole||current.server_role;
  if(effectiveRole==='teacher'&&input.status==='disabled')throw new ForbiddenException('教师账号不支持停用，请使用删除操作');
  const user=(await client.query(
   `UPDATE users SET name=COALESCE($3,name),login_name=COALESCE($4,login_name),
    server_role=COALESCE($5,server_role),status=CASE WHEN COALESCE($5,server_role)='teacher' THEN 'active' ELSE COALESCE($6,status) END,
    auth_version=CASE WHEN $6::text IS NOT NULL OR $5::text IS NOT NULL THEN auth_version+1 ELSE auth_version END,updated_at=now()
    WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING id,name,login_name,server_role,status,must_change_password,updated_at`,
   [id,auth.organizationId,input.name?.trim()||null,input.loginName?.trim()||null,input.serverRole||null,input.status||null])).rows[0];
  if(!user)throw new NotFoundException('用户不存在');
  if(input.status==='disabled'||input.serverRole){await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE subject_type='user' AND subject_id=$1 AND revoked_at IS NULL",[id]);await client.query('UPDATE user_devices SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id]);}
  await this.audit(client,auth,'user.update',id,requestId,{fields:Object.keys(input)});return user;
 });devices.forEach(device=>this.hub.closeUserDevice(String(device.id)));return result;}
 async resetPassword(auth:AuthContext,id:string,requestId:string){this.requireOrg(auth);if(id===auth.subjectId)throw new ForbiddenException('不能在用户管理中重置当前登录账号的密码');const devices=(await this.database.query('SELECT id FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL',[id])).rows;const result=await transaction(this.database,async client=>{
  const current=(await client.query('SELECT id,name,login_name,server_role FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE',[id,auth.organizationId])).rows[0];
  if(!current)throw new NotFoundException('用户不存在');
  const passwordType=current.server_role==='teacher'?'teacher':'admin';
  const initialPassword=generateInitialPassword(passwordType);
  const passwordHash=await hashPassword(initialPassword);
  await client.query('UPDATE users SET password_hash=$3,must_change_password=true,auth_version=auth_version+1,updated_at=now() WHERE id=$1 AND organization_id=$2',[id,auth.organizationId,passwordHash]);
  await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE subject_type='user' AND subject_id=$1 AND revoked_at IS NULL",[id]);
  await client.query('UPDATE user_devices SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id]);
  await this.audit(client,auth,'user.password.reset',id,requestId,{serverRole:current.server_role});
  return{...current,initialPassword,passwordRule:passwordType==='teacher'?'T-XXXX-XXXX-XX':'A-XXXX-XXXX-XX'};
 });devices.forEach(device=>this.hub.closeUserDevice(String(device.id)));return result;}
 async deleteTeacher(auth:AuthContext,id:string,requestId:string){this.requireOrg(auth);if(id===auth.subjectId)throw new ForbiddenException('不能删除当前登录账号');const devices=(await this.database.query('SELECT id FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL',[id])).rows;await transaction(this.database,async client=>{
  const current=(await client.query('SELECT id,server_role FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE',[id,auth.organizationId])).rows[0];
  if(!current)throw new NotFoundException('用户不存在');
  if(current.server_role!=='teacher')throw new ForbiddenException('只能删除教师账号，管理员账号请使用状态管理');
  await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE subject_type='user' AND subject_id=$1 AND revoked_at IS NULL",[id]);
  await client.query('DELETE FROM users WHERE id=$1 AND organization_id=$2',[id,auth.organizationId]);
  await this.audit(client,auth,'user.delete',id,requestId,{serverRole:'teacher'});
 });devices.forEach(device=>this.hub.closeUserDevice(String(device.id)));}
 async revokeDevice(auth:AuthContext,userId:string,deviceId:string,requestId:string){this.requireOrg(auth);await transaction(this.database,async client=>{const device=await client.query(
  `UPDATE user_devices d SET revoked_at=now() FROM users u WHERE d.id=$1 AND d.user_id=$2 AND u.id=d.user_id AND u.organization_id=$3 AND d.revoked_at IS NULL RETURNING d.id`,[deviceId,userId,auth.organizationId]);
  if(!device.rowCount)throw new NotFoundException('设备不存在或已经吊销');await client.query('UPDATE refresh_tokens SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL',[deviceId]);await this.audit(client,auth,'device.revoke',deviceId,requestId,{userId});});this.hub.closeUserDevice(deviceId);}
 private requireOrg(auth:AuthContext){if(!hasOrganizationScope(auth,'user.manage'))throw new ForbiddenException('只有组织范围管理员可以管理用户');}
 private requireOrgRead(auth:AuthContext){if(!hasOrganizationScope(auth,'user.read'))throw new ForbiddenException('用户目录仅允许组织范围管理员查看');}
 private audit(client:{query:Database['query']},auth:AuthContext,action:string,targetId:string,requestId:string,metadata:Record<string,unknown>){return client.query(
  `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json) VALUES($1,'user',$2,$3,'user',$4,$5,$6)`,[auth.organizationId,auth.subjectId,action,targetId,requestId,JSON.stringify(metadata)]);}
}
