import { Controller, ForbiddenException, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CloudConfig } from '../../config.js';
import type { Database } from '../../database.js';
import { CLOUD_CONFIG, DATABASE } from '../../platform/tokens.js';
import { Public } from '../../common/public.decorator.js';
import type { AuthContext } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(
    @Inject(CLOUD_CONFIG) private readonly config:CloudConfig,
    @Inject(DATABASE) private readonly database:Database,
  ) {}

  @Get('info')
  @Public()
  @ApiOperation({ summary:'获取企业后端版本和能力信息' })
  info() {
    return {
      service:'banda-cloud',
      architecture:'nestjs-modular-monolith',
      apiVersion:'2',
      features:{ multiTenantReady:true, faceDataCloudStorage:false },
      environment:this.config.NODE_ENV,
    };
  }

  @Get('live')
  @Public()
  @ApiOperation({ summary:'检查企业 API 进程存活状态' })
  live() {
    return { ok:true, service:'banda-cloud' };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary:'检查企业 API 数据库就绪状态' })
  async ready() {
    await this.database.query('SELECT 1');
    return { ok:true, database:'ready' };
  }

  @Get('operations')
  @RequirePermissions('operations.read')
  @ApiOperation({summary:'查看组织级运行与安全积压指标'})
  async operations(@CurrentAuth()auth:AuthContext) {
    if(!hasOrganizationScope(auth,'operations.read'))throw new ForbiddenException('运行指标仅允许组织范围运维角色查看');
    const[outbox,security,logins,devices]=await Promise.all([
      this.database.query("SELECT status,count(*)::int AS count,min(created_at) AS oldest FROM outbox_events WHERE organization_id=$1 GROUP BY status",[auth.organizationId]),
      this.database.query("SELECT severity,count(*)::int AS count FROM security_events WHERE organization_id=$1 AND created_at>now()-interval '24 hours' GROUP BY severity",[auth.organizationId]),
      this.database.query("SELECT count(*)::int AS failures FROM login_events WHERE organization_id=$1 AND outcome='failure' AND created_at>now()-interval '15 minutes'",[auth.organizationId]),
      this.database.query("SELECT count(*)FILTER(WHERE d.revoked_at IS NULL)::int AS active,count(*)FILTER(WHERE d.revoked_at IS NULL AND d.last_seen_at>now()-interval '60 seconds')::int AS online FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id WHERE c.organization_id=$1 AND c.deleted_at IS NULL",[auth.organizationId]),
    ]);
    return{generatedAt:new Date().toISOString(),outbox:outbox.rows,securityLast24Hours:security.rows,failedLoginsLast15Minutes:Number(logins.rows[0]?.failures||0),classroomDevices:devices.rows[0]||{active:0,online:0}};
  }
}
