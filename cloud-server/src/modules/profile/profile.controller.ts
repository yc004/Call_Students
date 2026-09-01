import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { UpdateProfileDto } from './profile.dto.js';
import { ProfileService } from './profile.service.js';

@ApiTags('profile') @ApiBearerAuth() @Controller('profile')
export class ProfileController {
  constructor(private readonly service:ProfileService) {}
  @Get() get(@CurrentAuth() auth:AuthContext){return this.service.get(auth);}
  @Patch() update(@CurrentAuth() auth:AuthContext,@Body() input:UpdateProfileDto){return this.service.update(auth,input);}
  @Post('avatar') avatar(@CurrentAuth() auth:AuthContext,@Body() body:Buffer|{base64?:string},@Headers('content-type') contentType:string){return this.service.avatar(auth,body,String(contentType||''));}
}
