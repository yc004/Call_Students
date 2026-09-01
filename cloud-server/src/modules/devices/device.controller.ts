import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext, AuthenticatedRequest } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { RequirePermissions } from '../../common/permissions.decorator.js';
import { Public } from '../../common/public.decorator.js';
import { DeviceHeartbeatDto, LoginClassroomDeviceDto, RegisterClassroomDeviceDto, RevokeClassroomDeviceDto } from './device.dto.js';
import { DeviceService } from './device.service.js';

@ApiTags('devices')
@Controller()
export class DeviceController {
  constructor(private readonly service:DeviceService) {}

  @Post('classroom-devices/register') @ApiBearerAuth() @RequirePermissions('device.manage')
  register(@CurrentAuth() auth:AuthContext,@Body() input:RegisterClassroomDeviceDto,@Req() request:AuthenticatedRequest) { return this.service.register(auth,input,String(request.id||'')); }

  @Public() @Post('devices/classrooms/login')
  login(@Body() input:LoginClassroomDeviceDto,@Req() request:AuthenticatedRequest) { return this.service.login(input,String(request.id||''),request.ip); }

  @Get('classroom-devices') @ApiBearerAuth() @RequirePermissions('device.read')
  devices(@CurrentAuth() auth:AuthContext) { return this.service.listDevices(auth); }

  @Public() @Post('devices/classrooms/heartbeat')
  heartbeat(@Body() input:DeviceHeartbeatDto) { return this.service.heartbeat(input); }

  @Public() @HttpCode(HttpStatus.NO_CONTENT) @Post('devices/classrooms/revoke')
  async selfRevoke(@Body() input:RevokeClassroomDeviceDto) { await this.service.revokeByToken(input.deviceToken); }

  @Delete('classroom-devices/:id') @ApiBearerAuth() @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('device.manage')
  async revoke(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string,@Req() request:AuthenticatedRequest) { await this.service.revokeDevice(auth,id,String(request.id||'')); }
}
