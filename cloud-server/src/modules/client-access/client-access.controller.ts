import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { ClientAccessService } from './client-access.service.js';

@ApiTags('client-access') @ApiBearerAuth() @Controller('client')
export class ClientAccessController {
  constructor(private readonly service:ClientAccessService) {}
  @Get('classrooms') classrooms(@CurrentAuth() auth:AuthContext){return this.service.classrooms(auth);}
  @Get('subjects') subjects(@CurrentAuth() auth:AuthContext){return this.service.subjects(auth);}
  @Get('classrooms/:id/snapshot') snapshot(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string){return this.service.snapshot(auth,id);}
  @Delete('classrooms/:id/membership') @HttpCode(HttpStatus.NO_CONTENT) async leave(@CurrentAuth() auth:AuthContext,@Param('id',ParseUUIDPipe) id:string){await this.service.leave(auth,id);}
}
