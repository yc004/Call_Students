import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { CreateSubjectDto, UpdateSubjectDto } from './subject.dto.js';
import { SubjectService } from './subject.service.js';

@ApiTags('subjects') @ApiBearerAuth() @Controller('subjects')
export class SubjectController {
  constructor(private readonly service:SubjectService) {}
  @Get() @RequirePermissions('classroom.read') list(@CurrentAuth() auth:AuthContext,@Query('activeOnly') activeOnly?:string){return this.service.list(auth,activeOnly==='true');}
  @Post() @RequirePermissions('organization.manage') create(@CurrentAuth() auth:AuthContext,@Body() input:CreateSubjectDto,@Req() req:AuthenticatedRequest){return this.service.create(auth,input,String(req.id||''));}
  @Patch(':id') @RequirePermissions('organization.manage') update(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:UpdateSubjectDto,@Req() req:AuthenticatedRequest){return this.service.update(auth,id,input,String(req.id||''));}
  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('organization.manage') async archive(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthenticatedRequest){await this.service.archive(auth,id,String(req.id||''));}
}
