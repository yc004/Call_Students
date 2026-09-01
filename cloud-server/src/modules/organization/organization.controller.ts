import { Body, Controller, Delete, Get, Headers, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { UpdateOrganizationDto } from './organization.dto.js';
import { OrganizationService } from './organization.service.js';

@ApiTags('organization') @ApiBearerAuth() @Controller('organization')
export class OrganizationController {
  constructor(private readonly service:OrganizationService) {}

  @Get() @RequirePermissions('organization.read')
  get(@CurrentAuth() auth:AuthContext) { return this.service.get(auth); }

  @Patch() @RequirePermissions('organization.manage')
  update(@CurrentAuth() auth:AuthContext,@Body() input:UpdateOrganizationDto,@Req() request:AuthenticatedRequest) {
    return this.service.update(auth,input,String(request.id||''));
  }

  @Post('logo') @RequirePermissions('organization.manage')
  uploadLogo(@CurrentAuth() auth:AuthContext,@Body() body:Buffer,@Headers('content-type') contentType:string,@Req() request:AuthenticatedRequest) {
    return this.service.uploadLogo(auth,body,String(contentType||''),String(request.id||''));
  }

  @Delete('logo') @RequirePermissions('organization.manage')
  removeLogo(@CurrentAuth() auth:AuthContext,@Req() request:AuthenticatedRequest) {
    return this.service.removeLogo(auth,String(request.id||''));
  }
}
