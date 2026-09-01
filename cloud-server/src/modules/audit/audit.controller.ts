import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import { AuditQueryDto } from './audit.dto.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(@CurrentAuth() auth:AuthContext,@Query() query:AuditQueryDto) {
    if(!hasOrganizationScope(auth,'audit.read'))throw new ForbiddenException('审计日志仅允许组织范围管理员查看');
    const values:unknown[]=[auth.organizationId,query.limit+1];
    const where=['l.organization_id=$1'];
    if(query.action){values.push(query.action);where.push(`l.action=$${values.length}`);}
    if(query.actorId){values.push(query.actorId);where.push(`l.actor_id=$${values.length}::uuid`);}
    if(query.cursor){values.push(query.cursor);where.push(`l.created_at<$${values.length}::timestamptz`);}
    const rows=(await this.database.query(
      `SELECT l.id,l.actor_type,l.actor_id,u.name AS actor_name,l.action,l.target_type,l.target_id,l.ip_address,l.request_id,l.outcome,l.metadata_json,l.created_at
       FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id
       WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT $2`,values,
    )).rows;
    const hasMore=rows.length>query.limit;
    const items=rows.slice(0,query.limit);
    return{items,nextCursor:hasMore?items.at(-1)?.created_at:null};
  }
}
