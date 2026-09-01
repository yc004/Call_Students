import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { UserQueryDto } from './user.dto.js';

@Injectable()
export class UserRepository{
 constructor(@Inject(DATABASE)private readonly database:Database){}
 private filters(org:string,q:UserQueryDto,includeCursor=false){
  const values:unknown[]=[org];const where=["u.organization_id=$1","u.deleted_at IS NULL"];
  if(q.search){values.push(`%${q.search.trim()}%`);where.push(`(u.name ILIKE $${values.length} OR u.login_name ILIKE $${values.length})`);}
  if(q.status){values.push(q.status);where.push(`u.status=$${values.length}`);}
  if(q.role){values.push(q.role);where.push(`u.server_role=$${values.length}`);}
  if(includeCursor&&q.cursor){values.push(q.cursor);where.push(`u.created_at<$${values.length}::timestamptz`);}
  return{values,where};
 }
 async list(org:string,q:UserQueryDto){
  const{values,where}=this.filters(org,q,true);values.push(q.limit+1);const limitIndex=values.length;
  return(await this.database.query(
   `SELECT u.id,u.name,u.login_name,u.server_role,u.status,u.must_change_password,u.last_login_at,u.created_at,u.updated_at,
     count(DISTINCT d.id) FILTER(WHERE d.revoked_at IS NULL)::int AS device_count,
     COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',b.id,'roleId',r.id,'roleName',r.name,'scopeType',b.scope_type,'scopeId',b.scope_id)) FILTER(WHERE b.id IS NOT NULL),'[]') AS bindings
    FROM users u LEFT JOIN user_devices d ON d.user_id=u.id LEFT JOIN user_role_bindings b ON b.user_id=u.id LEFT JOIN roles r ON r.id=b.role_id
    WHERE ${where.join(' AND ')} GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${limitIndex}`,values)).rows;
 }
 async count(org:string,q:UserQueryDto){const{values,where}=this.filters(org,q);return Number((await this.database.query(`SELECT count(*)::int AS total FROM users u WHERE ${where.join(' AND ')}`,values)).rows[0]?.total||0);}
 async detail(org:string,id:string){return(await this.database.query(
  `SELECT u.id,u.name,u.login_name,u.server_role,u.status,u.must_change_password,u.last_login_at,u.created_at,u.updated_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'roleId',r.id,'roleName',r.name,'scopeType',b.scope_type,'scopeId',b.scope_id)) FROM user_role_bindings b JOIN roles r ON r.id=b.role_id WHERE b.user_id=u.id),'[]') AS bindings,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.device_name,'type',d.device_type,'lastSeenAt',d.last_seen_at,'revokedAt',d.revoked_at,'createdAt',d.created_at) ORDER BY d.created_at DESC) FROM user_devices d WHERE d.user_id=u.id),'[]') AS devices
   FROM users u WHERE u.id=$1 AND u.organization_id=$2 AND u.deleted_at IS NULL`,[id,org])).rows[0]||null;}
}
