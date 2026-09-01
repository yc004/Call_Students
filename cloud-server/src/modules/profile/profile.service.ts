import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { AuthContext } from '../../common/auth-context.js';
import type { CloudConfig } from '../../config.js';
import { transaction, type Database } from '../../database.js';
import { CLOUD_CONFIG, DATABASE } from '../../platform/tokens.js';
import { hashPassword, verifyPassword } from '../../security.js';
import type { UpdateProfileDto } from './profile.dto.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';

@Injectable()
export class ProfileService {
  constructor(@Inject(DATABASE) private readonly database:Database,@Inject(CLOUD_CONFIG) private readonly config:CloudConfig,private readonly hub:ClassroomSocketHub) {}

  async get(auth:AuthContext) {
    const row=(await this.database.query(
      `SELECT u.id,u.name,u.nickname,u.avatar_url,u.wechat_openid,u.login_name,u.server_role,u.must_change_password,
       o.id AS organization_id,o.name AS organization_name,o.slug,o.short_name,o.logo_url,o.primary_color
       FROM users u JOIN organizations o ON o.id=u.organization_id
       WHERE u.id=$1 AND u.organization_id=$2 AND u.deleted_at IS NULL`,
      [auth.subjectId,auth.organizationId])).rows[0];
    if(!row)throw new UnauthorizedException('用户不存在');
    return this.format(row);
  }

  async update(auth:AuthContext,input:UpdateProfileDto) {
    const revokedDeviceIds=await transaction(this.database,async client=>{
      const current=(await client.query(
        'SELECT password_hash,must_change_password FROM users WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [auth.subjectId,auth.organizationId])).rows[0];
      if(!current)throw new UnauthorizedException('用户不存在');
      let passwordHash:string|null=null;
      if(input.newPassword){
        if(!current.must_change_password){
          if(!input.currentPassword||!await verifyPassword(input.currentPassword,current.password_hash))throw new BadRequestException('当前密码不正确');
        }
        passwordHash=await hashPassword(input.newPassword);
      }
      await client.query(
        `UPDATE users SET name=COALESCE($3,name),nickname=COALESCE($4,nickname),password_hash=COALESCE($5,password_hash),
         must_change_password=CASE WHEN $5::text IS NULL THEN must_change_password ELSE false END,updated_at=now()
         WHERE id=$1 AND organization_id=$2`,
        [auth.subjectId,auth.organizationId,input.name?.trim()||null,input.nickname?.trim()||input.name?.trim()||null,passwordHash]);
      if(passwordHash&&auth.deviceId){
        await client.query("UPDATE refresh_tokens SET revoked_at=now() WHERE subject_type='user' AND subject_id=$1 AND device_id<>$2 AND revoked_at IS NULL",[auth.subjectId,auth.deviceId]);
        return(await client.query('UPDATE user_devices SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id',[auth.subjectId,auth.deviceId])).rows.map(row=>String(row.id));
      }
      return[] as string[];
    });
    revokedDeviceIds.forEach(deviceId=>this.hub.closeUserDevice(deviceId));
    return this.get(auth);
  }

  async avatar(auth:AuthContext,input:Buffer|{base64?:string},contentType:string) {
    let body:Buffer;
    if(Buffer.isBuffer(input))body=input;
    else{
      const encoded=String(input&&input.base64||'');
      if(!encoded||encoded.length>7*1024*1024)throw new BadRequestException('头像文件不能为空或过大');
      try{body=Buffer.from(encoded,'base64');}catch{throw new BadRequestException('头像文件编码无效');}
    }
    if(!Buffer.isBuffer(body)||!body.length)throw new BadRequestException('头像文件不能为空');
    if(body.length>5*1024*1024)throw new BadRequestException('头像文件不能超过 5MB');
    const isPng=body.length>=8&&body.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    const isJpeg=body.length>=3&&body[0]===0xff&&body[1]===0xd8&&body[2]===0xff;
    const isWebp=body.length>=12&&body.subarray(0,4).toString('ascii')==='RIFF'&&body.subarray(8,12).toString('ascii')==='WEBP';
    if(!isPng&&!isWebp&&!isJpeg)throw new BadRequestException('头像仅支持 PNG、JPEG 或 WebP');
    let optimized:Buffer;
    try{optimized=await sharp(body,{failOn:'error',limitInputPixels:25_000_000}).rotate().resize({fit:'cover',height:512,width:512,withoutEnlargement:true}).webp({quality:84,effort:4}).toBuffer();}
    catch{throw new BadRequestException('头像图片无法解析或像素尺寸过大');}
    const directory=resolve('uploads/avatars');
    await mkdir(directory,{recursive:true});
    const filename=`${auth.subjectId}.webp`;
    await writeFile(resolve(directory,filename),optimized,{mode:0o600});
    const files=await readdir(directory);
    await Promise.all(files.filter(file=>file.startsWith(`${auth.subjectId}.`)&&file!==filename).map(file=>unlink(resolve(directory,file)).catch(()=>undefined)));
    const url=`${this.config.PUBLIC_URL.replace(/\/$/,'')}/uploads/avatars/${filename}?v=${Date.now()}`;
    await this.database.query('UPDATE users SET avatar_url=$3,updated_at=now() WHERE id=$1 AND organization_id=$2',[auth.subjectId,auth.organizationId,url]);
    return{url};
  }

  private format(row:Record<string,unknown>) {
    return{user:{id:row.id,name:row.name,nickname:row.nickname||row.name,avatarUrl:row.avatar_url||'',loginName:row.login_name,role:row.server_role,mustChangePassword:Boolean(row.must_change_password),wechatBound:Boolean(row.wechat_openid)},organization:{id:row.organization_id,name:row.organization_name,slug:row.slug,shortName:row.short_name||row.organization_name,logoUrl:row.logo_url||'',primaryColor:row.primary_color||'#2563EB'}};
  }
}
