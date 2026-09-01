import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { CreateCampusDto, UpdateCampusDto } from './campus.dto.js';
import { CampusService } from './campus.service.js';

@ApiTags('campuses') @ApiBearerAuth() @Controller('campuses')
export class CampusController {
  constructor(private readonly service:CampusService) {}
  @Get() @RequirePermissions('campus.read') list(@CurrentAuth() auth:AuthContext){return this.service.list(auth);}
  @Post() @RequirePermissions('campus.manage') create(@CurrentAuth() auth:AuthContext,@Body() input:CreateCampusDto,@Req() req:AuthenticatedRequest){return this.service.create(auth,input,String(req.id||''));}
  @Patch(':id') @RequirePermissions('campus.manage') update(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:UpdateCampusDto,@Req() req:AuthenticatedRequest){return this.service.update(auth,id,input,String(req.id||''));}
  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('campus.manage') async archive(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthenticatedRequest){await this.service.archive(auth,id,String(req.id||''));}
}
