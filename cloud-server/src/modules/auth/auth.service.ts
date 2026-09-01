import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { CloudConfig } from '../../config.js';
import { transaction, type Database } from '../../database.js';
import { CLOUD_CONFIG, DATABASE } from '../../platform/tokens.js';
import { createSession } from '../../session.js';
import { hashOpaqueToken, hashPassword, verifyPassword, type AccessSubject } from '../../security.js';
import type { AdminLoginDto, LoginDto, RefreshDto, SetupDto, WechatCodeDto } from './auth.dto.js';
import type { AuthContext } from '../../common/auth-context.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';

type RequestMeta = { ip:string; userAgent:string; requestId:string };

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string,{ count:number; resetAt:number }>();

  constructor(
    @Inject(CLOUD_CONFIG) private readonly config:CloudConfig,
    @Inject(DATABASE) private readonly database:Database,
    private readonly hub:ClassroomSocketHub,
  ) {}

  async setupStatus() {
    const result = await this.database.query("SELECT EXISTS(SELECT 1 FROM users WHERE server_role='admin' AND status='active' AND deleted_at IS NULL) AS initialized");
    return { initialized:Boolean(result.rows[0]?.initialized) };
  }

  async setup(input:SetupDto, meta:RequestMeta) {
    if (!this.safeEqual(input.setupToken, this.config.SETUP_TOKEN)) throw new ForbiddenException('初始化令牌无效');
    const passwordHash = await hashPassword(input.password);
    const result = await transaction(this.database, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('banda-cloud-initial-setup'))");
      const initialized = await client.query("SELECT 1 FROM users WHERE server_role='admin' LIMIT 1 FOR UPDATE");
      if (initialized.rowCount) throw new ConflictException('服务器已经完成初始化');
      const organizationSlug=`org-${randomUUID().replaceAll('-','').slice(0,12)}`;
      const organization = (await client.query(
        'INSERT INTO organizations(name,short_name,primary_color,slug) VALUES($1,$2,$3,$4) RETURNING id,name,short_name,primary_color,slug',
        [input.organizationName.trim(), input.organizationShortName.trim(), input.primaryColor?.toUpperCase() || '#2563EB', organizationSlug],
      )).rows[0];
      const user = (await client.query(
        `INSERT INTO users(organization_id,name,login_name,password_hash,server_role,status)
         VALUES($1,$2,$3,$4,'admin','active') RETURNING id,name,login_name,server_role,auth_version`,
        [organization.id, input.administratorName.trim(), input.loginName.trim(), passwordHash],
      )).rows[0];
      const role = (await client.query(
        `INSERT INTO roles(organization_id,code,name,description,data_scope,is_system)
         VALUES($1,'organization_owner','组织所有者','组织全部管理权限','organization',true) RETURNING id`, [organization.id],
      )).rows[0];
      await client.query('INSERT INTO role_permissions(role_id,permission_key) SELECT $1,key FROM permissions', [role.id]);
      await client.query(
        `INSERT INTO user_role_bindings(organization_id,user_id,role_id,scope_type,scope_id,created_by)
         VALUES($1,$2,$3,'organization',$1,$2)`, [organization.id,user.id,role.id],
      );
      await client.query(
        `INSERT INTO subjects(organization_id,name,code,sort_order,created_by,updated_by) VALUES
         ($1,'语文','chinese',10,$2,$2),($1,'数学','mathematics',20,$2,$2),($1,'英语','english',30,$2,$2),
         ($1,'物理','physics',40,$2,$2),($1,'化学','chemistry',50,$2,$2),($1,'生物','biology',60,$2,$2),
         ($1,'政治','politics',70,$2,$2),($1,'历史','history',80,$2,$2),($1,'地理','geography',90,$2,$2),
         ($1,'信息技术','information-technology',100,$2,$2),($1,'体育','physical-education',110,$2,$2),
         ($1,'音乐','music',120,$2,$2),($1,'美术','art',130,$2,$2)`,
        [organization.id,user.id],
      );
      await client.query(
        `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,ip_address,request_id,user_agent)
         VALUES($1,'user',$2,'system.setup','organization',$1,$3,$4,$5)`,
        [organization.id,user.id,meta.ip,meta.requestId,meta.userAgent],
      );
      return { organization,user };
    });
    return result;
  }

  async adminLogin(input:AdminLoginDto, meta:RequestMeta) {
    const attemptKey = `${meta.ip}:admin:${input.organizationSlug.toLowerCase()}:${input.loginName.toLowerCase()}`;
    if (!this.allowAttempt(attemptKey)) throw new ForbiddenException('登录尝试过多，请稍后重试');
    const found = await this.database.query(
      `SELECT u.id,u.organization_id,u.name,u.nickname,u.avatar_url,u.wechat_openid,u.login_name,u.password_hash,u.server_role,u.status,u.auth_version,u.must_change_password,
              o.name AS organization_name,o.slug,o.short_name,o.logo_url,o.primary_color,o.timezone
       FROM users u JOIN organizations o ON o.id=u.organization_id
       WHERE lower(u.login_name)=lower($1) AND lower(o.slug)=lower($2) AND u.server_role='admin' AND u.deleted_at IS NULL AND o.deleted_at IS NULL
       ORDER BY u.created_at LIMIT 10`,
      [input.loginName.trim(),input.organizationSlug.trim()],
    );
    const matches=[];
    for(const candidate of found.rows)if(candidate.status==='active'&&candidate.password_hash&&await verifyPassword(input.password,candidate.password_hash))matches.push(candidate);
    const user=matches.length===1?matches[0]:undefined;
    if(!user){
      this.recordFailedAttempt(attemptKey);
      await this.recordLogin(found.rows[0],input.loginName,'failure',matches.length>1?'ambiguous_admin_login':'invalid_credentials',meta);
      throw new UnauthorizedException('账号或密码错误');
    }
    this.attempts.delete(attemptKey);
    return this.createUserSession(user,input.deviceName?.trim()||'企业管理后台','admin-web',input.loginName,meta);
  }

  async login(input:LoginDto, meta:RequestMeta) {
    const attemptKey = `${meta.ip}:client:${input.organizationSlug.toLowerCase()}:${input.loginName.toLowerCase()}`;
    if (!this.allowAttempt(attemptKey)) throw new ForbiddenException('登录尝试过多，请稍后重试');
    const found = await this.database.query(
      `SELECT u.id,u.organization_id,u.name,u.nickname,u.avatar_url,u.wechat_openid,u.login_name,u.password_hash,u.server_role,u.status,u.auth_version,u.must_change_password,
              o.name AS organization_name,o.slug,o.short_name,o.logo_url,o.primary_color,o.timezone
       FROM users u JOIN organizations o ON o.id=u.organization_id
       WHERE lower(u.login_name)=lower($1) AND lower(o.slug)=lower($2) AND u.deleted_at IS NULL AND o.deleted_at IS NULL
       ORDER BY u.created_at LIMIT 10`,
      [input.loginName.trim(),input.organizationSlug.trim()],
    );
    const matches=[];
    for(const candidate of found.rows)if(candidate.status==='active'&&candidate.password_hash&&await verifyPassword(input.password,candidate.password_hash))matches.push(candidate);
    const user=matches.length===1?matches[0]:undefined;
    if (!user) {
      this.recordFailedAttempt(attemptKey);
      await this.recordLogin(found.rows[0], input.loginName, 'failure', matches.length>1?'ambiguous_client_login':'invalid_credentials', meta);
      throw new UnauthorizedException(matches.length>1?'存在多个相同账号，请联系管理员修改登录名':'账号或密码错误');
    }
    this.attempts.delete(attemptKey);
    return this.createUserSession(user,input.deviceName?.trim()||'客户端','account-client',input.loginName,meta);
  }

  async wechatLogin(input:WechatCodeDto,meta:RequestMeta) {
    const openid=await this.exchangeWechatCode(input.code);
    const user=(await this.database.query(
      `SELECT u.id,u.organization_id,u.name,u.nickname,u.avatar_url,u.login_name,u.password_hash,u.server_role,u.status,u.auth_version,u.must_change_password,
              o.name AS organization_name,o.slug,o.short_name,o.logo_url,o.primary_color,o.timezone
       FROM users u JOIN organizations o ON o.id=u.organization_id
       WHERE u.wechat_openid=$1 AND u.deleted_at IS NULL AND o.deleted_at IS NULL LIMIT 2`,[openid])).rows;
    if(user.length!==1||user[0].status!=='active')throw new UnauthorizedException('当前微信尚未绑定组织账户，请先使用用户名和密码登录');
    if(user[0].must_change_password)throw new UnauthorizedException('请先使用初始密码登录并完成安全设置');
    return this.createUserSession(user[0],input.deviceName?.trim()||'微信小程序','mini-program-wechat','wechat',meta);
  }

  async bindWechat(auth:AuthContext,input:WechatCodeDto) {
    const openid=await this.exchangeWechatCode(input.code);
    return transaction(this.database,async client=>{
      const current=(await client.query(
        'SELECT id,must_change_password,wechat_openid FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [auth.subjectId,auth.organizationId])).rows[0];
      if(!current)throw new UnauthorizedException('用户不存在');
      if(current.must_change_password)throw new BadRequestException('请先修改初始密码再绑定微信');
      const occupied=(await client.query('SELECT id FROM users WHERE wechat_openid=$1 AND id<>$2 AND deleted_at IS NULL LIMIT 1',[openid,auth.subjectId])).rows[0];
      if(occupied)throw new ConflictException('当前微信已经绑定其他组织账户');
      await client.query('UPDATE users SET wechat_openid=$2,updated_at=now() WHERE id=$1',[auth.subjectId,openid]);
      await client.query(
        `INSERT INTO security_events(organization_id,actor_id,severity,event_type,target_type,target_id,metadata_json)
         VALUES($1,$2,'info','identity.wechat_bound','user',$2,'{}'::jsonb)`,[auth.organizationId,auth.subjectId]);
      return{bound:true};
    });
  }

  async refresh(input:{refreshToken:string}) {
    const result=await transaction(this.database,async client=>{
      const found=await client.query(
        `SELECT r.id,r.family_id,r.subject_id,r.device_id,r.revoked_at,r.expires_at,
                u.organization_id,u.server_role,u.status,u.auth_version,u.deleted_at,
                d.revoked_at AS device_revoked_at
         FROM refresh_tokens r JOIN users u ON u.id=r.subject_id JOIN user_devices d ON d.id=r.device_id AND d.user_id=u.id
         WHERE r.token_hash=$1 LIMIT 1 FOR UPDATE OF r`,
        [hashOpaqueToken(input.refreshToken,this.config.KEY_PEPPER)],
      );
      const row=found.rows[0];
      if(!row||row.status!=='active'||row.deleted_at||row.device_revoked_at||new Date(row.expires_at).getTime()<=Date.now())return{invalid:true as const};
      if(row.revoked_at){
        await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1',[row.family_id]);
        await client.query('UPDATE user_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[row.device_id]);
        await client.query(
          `INSERT INTO security_events(organization_id,actor_id,severity,event_type,target_type,target_id,metadata_json)
           VALUES($1,$2,'critical','refresh_token.reuse','user',$2,$3)`,
          [row.organization_id,row.subject_id,JSON.stringify({deviceId:row.device_id,familyId:row.family_id})]);
        return{reuse:true as const,deviceId:String(row.device_id)};
      }
      const session=await createSession(client,{
        subjectType:'user',subjectId:row.subject_id,organizationId:row.organization_id,
        role:row.server_role,authVersion:Number(row.auth_version),
      },row.device_id,this.config,row.family_id||row.id);
      const successorHash=hashOpaqueToken(session.refreshToken,this.config.KEY_PEPPER);
      await client.query(
        'UPDATE refresh_tokens SET revoked_at=now(),replaced_by=(SELECT id FROM refresh_tokens WHERE token_hash=$2) WHERE id=$1',
        [row.id,successorHash]);
      return{session};
    });
    if('reuse'in result){if(result.deviceId)this.hub.closeUserDevice(result.deviceId);throw new UnauthorizedException('检测到刷新令牌被重复使用，当前会话族已经撤销');}
    if('invalid'in result)throw new UnauthorizedException('刷新令牌已经失效');
    return result.session;
  }

  async logout(input:{refreshToken:string}) {
    const deviceId=await transaction(this.database, async client => {
      const token = await client.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING device_id',
        [hashOpaqueToken(input.refreshToken,this.config.KEY_PEPPER)],
      );
      if (token.rows[0]?.device_id) await client.query('UPDATE user_devices SET revoked_at=now() WHERE id=$1', [token.rows[0].device_id]);
      return token.rows[0]?.device_id?String(token.rows[0].device_id):null;
    });
    if(deviceId)this.hub.closeUserDevice(deviceId);
  }

  async profile(userId:string) {
    const result = await this.database.query(
      `SELECT u.id,u.name,u.login_name,u.server_role,o.id AS organization_id,o.name AS organization_name,o.slug,
              COALESCE(array_remove(array_agg(DISTINCT rp.permission_key),NULL),'{}') AS permissions
       FROM users u JOIN organizations o ON o.id=u.organization_id
       LEFT JOIN user_role_bindings b ON b.user_id=u.id AND (b.expires_at IS NULL OR b.expires_at>now())
       LEFT JOIN roles r ON r.id=b.role_id AND r.status='active'
       LEFT JOIN role_permissions rp ON rp.role_id=r.id
       WHERE u.id=$1 GROUP BY u.id,o.id`, [userId],
    );
    if (!result.rowCount) throw new UnauthorizedException('用户不存在');
    const row = result.rows[0];
    return {
      user:{ id:row.id,name:row.name,loginName:row.login_name,role:row.server_role },
      organization:{ id:row.organization_id,name:row.organization_name,slug:row.slug },
      permissions:(row.permissions || []).map(String),
    };
  }

  private allowAttempt(key:string):boolean {
    const now = Date.now();
    if(this.attempts.size>10_000)for(const[attemptKey,value]of this.attempts)if(value.resetAt<=now)this.attempts.delete(attemptKey);
    const current = this.attempts.get(key);
    if (!current || current.resetAt<=now) { this.attempts.delete(key); return true; }
    return current.count<8;
  }

  private recordFailedAttempt(key:string) {
    const now=Date.now();
    const current=this.attempts.get(key);
    if(!current||current.resetAt<=now)this.attempts.set(key,{count:1,resetAt:now+15*60_000});
    else current.count+=1;
  }

  private async createUserSession(user:Record<string,any>,deviceName:string,deviceType:string,loginName:string,meta:RequestMeta){
    const device=await this.database.query(
      'INSERT INTO user_devices(user_id,device_name,device_type,last_seen_at) VALUES($1,$2,$3,now()) RETURNING id',
      [user.id,deviceName,deviceType],
    );
    const subject:AccessSubject={subjectType:'user',subjectId:user.id,organizationId:user.organization_id,role:user.server_role,authVersion:Number(user.auth_version)};
    const session=await createSession(this.database,subject,device.rows[0].id,this.config);
    await this.recordLogin(user,loginName,'success',null,meta);
    return{user:{id:user.id,name:user.name,nickname:user.nickname||user.name,avatarUrl:user.avatar_url||'',loginName:user.login_name,role:user.server_role,mustChangePassword:Boolean(user.must_change_password),wechatBound:Boolean(user.wechat_openid)},organization:{id:user.organization_id,name:user.organization_name,slug:user.slug,shortName:user.short_name||user.organization_name,logoUrl:user.logo_url||'',primaryColor:user.primary_color||'#2563EB',timezone:user.timezone||'Asia/Shanghai'},...session};
  }

  private async exchangeWechatCode(code:string):Promise<string>{
    if(!this.config.WECHAT_APP_ID||!this.config.WECHAT_APP_SECRET)throw new ServiceUnavailableException('服务器尚未配置微信小程序登录');
    const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid',this.config.WECHAT_APP_ID);
    url.searchParams.set('secret',this.config.WECHAT_APP_SECRET);
    url.searchParams.set('js_code',String(code));
    url.searchParams.set('grant_type','authorization_code');
    let response:Response;
    try{response=await fetch(url,{signal:AbortSignal.timeout(8000)});}catch{throw new ServiceUnavailableException('暂时无法连接微信登录服务');}
    const payload=await response.json().catch(()=>({})) as {openid?:string;errcode?:number;errmsg?:string};
    if(!response.ok||!payload.openid)throw new UnauthorizedException(payload.errmsg||'微信登录凭证无效或已经使用');
    return payload.openid;
  }

  private async recordLogin(user:Record<string,unknown> | undefined, loginName:string, outcome:string, reason:string | null, meta:RequestMeta) {
    await this.database.query(
      `INSERT INTO login_events(organization_id,user_id,login_name,outcome,reason,ip_address,user_agent,request_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user?.organization_id || null,user?.id || null,loginName,outcome,reason,meta.ip,meta.userAgent,meta.requestId],
    );
  }

  private safeEqual(left:string,right:string):boolean {
    const a=Buffer.from(left); const b=Buffer.from(right);
    return a.length===b.length && timingSafeEqual(a,b);
  }
}
