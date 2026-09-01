import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { CreateRoleBindingDto, CreateRoleDto, SetRolePermissionsDto } from './authorization.dto.js';
import { AuthorizationService } from './authorization.service.js';

@ApiTags('authorization') @ApiBearerAuth() @Controller()
export class AuthorizationController{
 constructor(private readonly service:AuthorizationService){}
 @Get('permissions') @RequirePermissions('role.read') permissions(){return this.service.permissionCatalog();}
 @Get('roles') @RequirePermissions('role.read') roles(@CurrentAuth() auth:AuthContext){return this.service.roles(auth);}
 @Post('roles') @RequirePermissions('role.manage') create(@CurrentAuth() auth:AuthContext,@Body() input:CreateRoleDto,@Req() req:AuthenticatedRequest){return this.service.createRole(auth,input,String(req.id||''));}
 @Put('roles/:id/permissions') @RequirePermissions('role.manage') set(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:SetRolePermissionsDto,@Req() req:AuthenticatedRequest){return this.service.setPermissions(auth,id,input,String(req.id||''));}
 @Post('users/:id/role-bindings') @RequirePermissions('role.manage') bind(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Body() input:CreateRoleBindingDto,@Req() req:AuthenticatedRequest){return this.service.bind(auth,id,input,String(req.id||''));}
 @Delete('role-bindings/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('role.manage') async unbind(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() req:AuthenticatedRequest){await this.service.unbind(auth,id,String(req.id||''));}
}
