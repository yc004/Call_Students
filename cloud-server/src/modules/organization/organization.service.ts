import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { AuthContext } from '../../common/auth-context.js';
import { hasOrganizationScope } from '../../common/scope-policy.js';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { UpdateOrganizationDto } from './organization.dto.js';
import { OrganizationRepository } from './organization.repository.js';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly repository:OrganizationRepository,
    @Inject(DATABASE) private readonly database:Database,
  ) {}

  async get(auth:AuthContext) {
    if(!hasOrganizationScope(auth,'organization.read'))throw new ForbiddenException('无权查看组织资料');
    const organization=await this.repository.find(auth.organizationId);
    if (!organization) throw new NotFoundException('组织不存在');
    return organization;
  }

  async update(auth:AuthContext,input:UpdateOrganizationDto,requestId:string) {
    this.requireManage(auth);
    if(input.timezone&&!this.isTimeZone(input.timezone))throw new BadRequestException('时区标识无效');
    const organization=await this.repository.update(auth.organizationId,input);
    if (!organization) throw new NotFoundException('组织不存在');
    await this.database.query(
      `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json)
       VALUES($1,'user',$2,'organization.update','organization',$1,$3,$4)`,
      [auth.organizationId,auth.subjectId,requestId,JSON.stringify({ fields:Object.keys(input) })]);
    return organization;
  }

  async uploadLogo(auth:AuthContext,body:Buffer,contentType:string,requestId:string) {
    this.requireManage(auth);
    if(!Buffer.isBuffer(body)||!body.length)throw new BadRequestException('Logo 文件不能为空');
    if(body.length>20*1024*1024)throw new BadRequestException('Logo 原始文件不能超过 20MB');
    if(!this.detectImageType(body))throw new BadRequestException('Logo 仅支持 PNG、JPEG 或 WebP 图片');
    let optimized:Buffer;
    let outputInfo:{height:number;size:number;width:number};
    try {
      const result=await sharp(body,{failOn:'error',limitInputPixels:40_000_000})
        .rotate()
        .resize({fit:'inside',height:512,width:512,withoutEnlargement:true})
        .webp({effort:4,quality:86,smartSubsample:true})
        .toBuffer({resolveWithObject:true});
      optimized=result.data;
      outputInfo={height:result.info.height,size:result.info.size,width:result.info.width};
    } catch {
      throw new BadRequestException('图片无法解析或像素尺寸过大');
    }
    const directory=resolve('uploads/logos');
    await mkdir(directory,{recursive:true});
    const filename=`${auth.organizationId}-${Date.now()}.webp`;
    await writeFile(resolve(directory,filename),optimized,{mode:0o600});
    const logoUrl=`/uploads/logos/${filename}`;
    const organization=(await this.database.query(
      `UPDATE organizations SET logo_url=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,name,slug,short_name,logo_url,primary_color,timezone,plan,status,settings_json,created_at,updated_at`,
      [auth.organizationId,logoUrl])).rows[0];
    if(!organization)throw new NotFoundException('组织不存在');
    await this.cleanupLogoFiles(directory,auth.organizationId,filename);
    await this.auditLogo(auth,'organization.logo.upload',requestId,{contentType,inputSize:body.length,outputHeight:outputInfo.height,outputSize:outputInfo.size,outputWidth:outputInfo.width});
    return organization;
  }

  async removeLogo(auth:AuthContext,requestId:string) {
    this.requireManage(auth);
    const organization=(await this.database.query(
      `UPDATE organizations SET logo_url=NULL,updated_at=now() WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,name,slug,short_name,logo_url,primary_color,timezone,plan,status,settings_json,created_at,updated_at`,
      [auth.organizationId])).rows[0];
    if(!organization)throw new NotFoundException('组织不存在');
    const directory=resolve('uploads/logos');
    await this.cleanupLogoFiles(directory,auth.organizationId);
    await this.auditLogo(auth,'organization.logo.remove',requestId);
    return organization;
  }

  private detectImageType(body:Buffer) {
    if(body.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return true;
    if(body[0]===0xff&&body[1]===0xd8&&body[2]===0xff)return true;
    if(body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP')return true;
    return false;
  }

  private async cleanupLogoFiles(directory:string,organizationId:string,keep?:string) {
    const files=await readdir(directory).catch(()=>[] as string[]);
    await Promise.all(files.filter(file=>file.startsWith(`${organizationId}-`)&&file!==keep).map(file=>unlink(resolve(directory,file)).catch(()=>undefined)));
  }

  private auditLogo(auth:AuthContext,action:string,requestId:string,metadata:Record<string,unknown>={}) {
    return this.database.query(
      `INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json)
       VALUES($1,'user',$2,$3,'organization',$1,$4,$5)`,
      [auth.organizationId,auth.subjectId,action,requestId,JSON.stringify(metadata)]);
  }

  private requireManage(auth:AuthContext) {
    if(!hasOrganizationScope(auth,'organization.manage'))throw new ForbiddenException('只有组织范围管理员可以修改组织资料');
  }

  private isTimeZone(value:string) {
    try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return true;}catch{return false;}
  }
}
