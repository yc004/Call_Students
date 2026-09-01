import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CloudConfig } from '../config.js';
import type { Database } from '../database.js';
import { CLOUD_CONFIG, DATABASE } from '../platform/tokens.js';
import { verifyAccessToken } from '../security.js';
import type { AuthenticatedRequest } from './auth-context.js';
import { IS_PUBLIC } from './public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector:Reflector,
    @Inject(CLOUD_CONFIG) private readonly config:CloudConfig,
    @Inject(DATABASE) private readonly database:Database,
  ) {}

  async canActivate(context:ExecutionContext):Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = String(request.headers.authorization || '');
    if (!authorization.startsWith('Bearer ')) throw new UnauthorizedException('需要登录');
    try {
      const subject = await verifyAccessToken(authorization.slice(7).trim(), this.config);
      if (subject.subjectType !== 'user' || !subject.deviceId) throw new Error('user device required');
      const result = await this.database.query(
        `SELECT u.organization_id,u.server_role,u.auth_version,u.status,d.revoked_at,
                COALESCE(array_remove(array_agg(DISTINCT rp.permission_key),NULL),'{}') AS permissions,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                  'roleId',r.id,'scope',jsonb_build_object('type',urb.scope_type,'id',urb.scope_id),
                  'permissions',(SELECT COALESCE(jsonb_agg(rp2.permission_key ORDER BY rp2.permission_key),'[]'::jsonb)
                    FROM role_permissions rp2 WHERE rp2.role_id=r.id)
                )) FILTER (WHERE urb.id IS NOT NULL AND r.id IS NOT NULL),'[]'::jsonb) AS grants
         FROM users u JOIN user_devices d ON d.id=$2 AND d.user_id=u.id
         LEFT JOIN user_role_bindings urb ON urb.user_id=u.id AND urb.organization_id=u.organization_id AND (urb.expires_at IS NULL OR urb.expires_at>now())
         LEFT JOIN roles r ON r.id=urb.role_id AND r.status='active'
         LEFT JOIN role_permissions rp ON rp.role_id=r.id
         WHERE u.id=$1 AND u.deleted_at IS NULL
         GROUP BY u.id,u.organization_id,u.server_role,u.auth_version,u.status,d.revoked_at`,
        [subject.subjectId, subject.deviceId],
      );
      const user = result.rows[0];
      if (!user || user.status !== 'active' || user.revoked_at || user.organization_id !== subject.organizationId) throw new Error('identity revoked');
      if (subject.authVersion !== undefined && Number(user.auth_version) !== subject.authVersion) throw new Error('authorization changed');
      const grants=(user.grants || []).map((grant:{roleId:string;scope:{type:string;id:string|null};permissions:string[]})=>({
        roleId:String(grant.roleId),
        scope:{type:grant.scope.type as 'organization'|'campus'|'classroom',id:grant.scope.id},
        permissions:(grant.permissions || []).map(String),
      }));
      request.auth = {
        ...subject,
        authVersion:Number(user.auth_version),
        permissions:(user.permissions || []).map(String),
        scopes:grants.map((grant:{scope:{type:'organization'|'campus'|'classroom';id:string|null}})=>grant.scope),
        grants,
      };
      void this.database.query('UPDATE user_devices SET last_seen_at=now() WHERE id=$1', [subject.deviceId]).catch(()=>undefined);
      return true;
    } catch {
      throw new UnauthorizedException('登录状态已经失效');
    }
  }
}
