import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { BatchCreateClassroomsDto, CreateClassroomDto, MemberDto, ReplaceStudentsDto, UpdateClassroomDto } from './classroom.dto.js';
import { ClassroomService } from './classroom.service.js';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomController {
  constructor(private readonly service:ClassroomService) {}

  @Get() @RequirePermissions('classroom.read')
  list(@CurrentAuth() auth:AuthContext) { return this.service.list(auth); }

  @Get('status/overview') @RequirePermissions('classroom.read')
  status(@CurrentAuth() auth:AuthContext) { return this.service.statusOverview(auth); }

  @Get(':id') @RequirePermissions('classroom.read')
  detail(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string) { return this.service.detail(auth,id); }

  @Post() @RequirePermissions('classroom.manage')
  create(@CurrentAuth() auth:AuthContext,@Body() input:CreateClassroomDto,@Req() request:AuthenticatedRequest) { return this.service.create(auth,input,String(request.id||'')); }

  @Post('batch') @RequirePermissions('classroom.manage')
  batch(@CurrentAuth() auth:AuthContext,@Body() input:BatchCreateClassroomsDto,@Req() request:AuthenticatedRequest) { return this.service.batchCreate(auth,input,String(request.id||'')); }

  @Post(':id/reset-password') @RequirePermissions('classroom.manage')
  resetPassword(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() request:AuthenticatedRequest) { return this.service.resetPassword(auth,id,String(request.id||'')); }

  @Patch(':id') @RequirePermissions('classroom.manage')
  update(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:UpdateClassroomDto,@Req() request:AuthenticatedRequest) { return this.service.update(auth,id,input,String(request.id||'')); }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('classroom.manage')
  async archive(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() request:AuthenticatedRequest) { await this.service.archive(auth,id,String(request.id||'')); }

  @Put(':id/students') @RequirePermissions('classroom.manage')
  students(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:ReplaceStudentsDto,@Req() request:AuthenticatedRequest) { return this.service.replaceStudents(auth,id,input,String(request.id||'')); }

  @Put(':id/members') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('classroom.manage')
  async member(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:MemberDto,@Req() request:AuthenticatedRequest) { await this.service.upsertMember(auth,id,input,String(request.id||'')); }

  @Delete(':id/members/:userId') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('classroom.manage')
  async removeMember(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Param('userId',ParseUUIDPipe) userId:string,@Req() request:AuthenticatedRequest) { await this.service.removeMember(auth,id,userId,String(request.id||'')); }
}
