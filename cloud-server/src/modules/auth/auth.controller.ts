import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../common/auth-context.js';
import type { AuthContext } from '../../common/auth-context.js';
import { CurrentAuth } from '../../common/current-auth.decorator.js';
import { Public } from '../../common/public.decorator.js';
import type { CloudConfig } from '../../config.js';
import { CLOUD_CONFIG } from '../../platform/tokens.js';
import { AdminLoginDto, LoginDto, RefreshDto, SetupDto, WechatCodeDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth:AuthService,@Inject(CLOUD_CONFIG)private readonly config:CloudConfig) {}

  @Public() @Get('setup/status')
  @ApiOperation({ summary:'检查服务是否已经初始化' })
  setupStatus() { return this.auth.setupStatus(); }

  @Public() @Post('setup')
  @ApiOperation({ summary:'创建首个组织和组织所有者' })
  setup(@Body() input:SetupDto,@Req() request:AuthenticatedRequest) {
    return this.auth.setup(input,this.meta(request));
  }

  @Public() @HttpCode(HttpStatus.OK) @Post('auth/login')
  @ApiOperation({ summary:'客户端使用组织标识、账号和密码登录' })
  login(@Body() input:LoginDto,@Req() request:AuthenticatedRequest) {
    return this.auth.login(input,this.meta(request));
  }

  @Public() @HttpCode(HttpStatus.OK) @Post('auth/wechat/login')
  @ApiOperation({ summary:'使用微信小程序登录凭证一键登录已绑定账户' })
  wechatLogin(@Body() input:WechatCodeDto,@Req() request:AuthenticatedRequest) {
    return this.auth.wechatLogin(input,this.meta(request));
  }

  @Post('auth/wechat/bind') @ApiBearerAuth()
  @ApiOperation({ summary:'将当前企业账户绑定到微信小程序身份' })
  bindWechat(@CurrentAuth() auth:AuthContext,@Body() input:WechatCodeDto) {
    return this.auth.bindWechat(auth,input);
  }

  @Public() @HttpCode(HttpStatus.OK) @Post('auth/admin/login')
  @ApiOperation({ summary:'管理员使用组织标识、账号和密码登录企业后台' })
  async adminLogin(@Body() input:AdminLoginDto,@Req() request:AuthenticatedRequest,@Res({passthrough:true}) reply:FastifyReply) {
    const session=await this.auth.adminLogin(input,this.meta(request));
    if(!this.isAdminWeb(request))return session;
    this.setRefreshCookie(reply,session.refreshToken);
    const{refreshToken:_refreshToken,...publicSession}=session;
    return publicSession;
  }

  @Public() @HttpCode(HttpStatus.OK) @Post('auth/refresh')
  async refresh(@Body() input:RefreshDto,@Req() request:AuthenticatedRequest,@Res({passthrough:true}) reply:FastifyReply) {
    const cookieToken=this.refreshCookie(request);
    const refreshToken=String(input.refreshToken||cookieToken||'');
    if(!refreshToken)throw new UnauthorizedException('刷新令牌已经失效');
    const session=await this.auth.refresh({refreshToken});
    if(!cookieToken&&!this.isAdminWeb(request))return session;
    this.setRefreshCookie(reply,session.refreshToken);
    const{refreshToken:_refreshToken,...publicSession}=session;
    return publicSession;
  }

  @Public() @HttpCode(HttpStatus.NO_CONTENT) @Post('auth/logout')
  async logout(@Body() input:RefreshDto,@Req() request:AuthenticatedRequest,@Res({passthrough:true}) reply:FastifyReply) {
    const refreshToken=String(input.refreshToken||this.refreshCookie(request)||'');
    if(refreshToken)await this.auth.logout({refreshToken});
    this.clearRefreshCookie(reply);
  }

  @Get('auth/me') @ApiBearerAuth()
  me(@Req() request:AuthenticatedRequest) { return this.auth.profile(request.auth!.subjectId); }

  private meta(request:AuthenticatedRequest) {
    return { ip:request.ip,userAgent:String(request.headers['user-agent'] || ''),requestId:String(request.id || '') };
  }

  private isAdminWeb(request:AuthenticatedRequest){return request.headers['x-banda-client']==='admin-web';}

  private refreshCookie(request:AuthenticatedRequest){
    const raw=String(request.headers.cookie||'');
    const value=raw.split(';').map(item=>item.trim()).find(item=>item.startsWith('banda_refresh_token='))?.slice('banda_refresh_token='.length);
    if(!value)return'';
    try{return decodeURIComponent(value);}catch{return'';}
  }

  private setRefreshCookie(reply:FastifyReply,token:string){
    const secure=this.config.PUBLIC_URL.startsWith('https://')?'; Secure':'';
    reply.header('Set-Cookie',`banda_refresh_token=${encodeURIComponent(token)}; HttpOnly; Path=/api/v2/auth; SameSite=Strict; Max-Age=${this.config.REFRESH_TOKEN_TTL_DAYS*86400}${secure}`);
  }

  private clearRefreshCookie(reply:FastifyReply){
    const secure=this.config.PUBLIC_URL.startsWith('https://')?'; Secure':'';
    reply.header('Set-Cookie',`banda_refresh_token=; HttpOnly; Path=/api/v2/auth; SameSite=Strict; Max-Age=0${secure}`);
  }
}
