import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AuthContext } from '../../common/auth-context.js';
import { canAccessClassroom } from '../../common/scope-policy.js';
import type { CloudConfig } from '../../config.js';
import type { Database } from '../../database.js';
import { CLOUD_CONFIG, DATABASE } from '../../platform/tokens.js';
import { generateOpaqueToken, hashOpaqueToken, verifyPassword } from '../../security.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';
import type { DeviceHeartbeatDto, LoginClassroomDeviceDto, RegisterClassroomDeviceDto } from './device.dto.js';

@Injectable()
export class DeviceService {
  private readonly loginAttempts=new Map<string,{count:number;resetAt:number}>();
  constructor(@Inject(DATABASE)private readonly database:Database,@Inject(CLOUD_CONFIG)private readonly config:CloudConfig,private readonly hub:ClassroomSocketHub) {}

  async register(auth:AuthContext,input:RegisterClassroomDeviceDto,requestId:string) {
    const classroom=(await this.database.query('SELECT id,campus_id FROM classrooms WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[input.classroomId,auth.organizationId])).rows[0];
    if(!classroom)throw new NotFoundException('教室不存在');
    if(!canAccessClassroom(auth,input.classroomId,classroom.campus_id||null,'device.manage'))throw new ForbiddenException('无权绑定该教室设备');
    const result=await this.issueDevice(input.classroomId,input.deviceName,input.appVersion);
    await this.audit(auth.organizationId,'user',auth.subjectId,'classroom-device.register',result.deviceId,requestId,{classroomId:input.classroomId});
    return result;
  }

  async login(input:LoginClassroomDeviceDto,requestId:string,ip:string) {
    const attemptKey=`${ip}:${input.organizationSlug.toLowerCase()}:${input.loginName.toLowerCase()}`;
    if(!this.allowLoginAttempt(attemptKey))throw new ForbiddenException('登录尝试过多，请稍后重试');
    const found=await this.database.query(
      `SELECT ca.classroom_id,ca.organization_id,ca.password_hash,c.name AS classroom_name
       FROM classroom_accounts ca JOIN classrooms c ON c.id=ca.classroom_id
       JOIN organizations o ON o.id=ca.organization_id
       WHERE lower(ca.login_name)=lower($1) AND lower(o.slug)=lower($2) AND c.deleted_at IS NULL AND c.status='active' AND o.deleted_at IS NULL LIMIT 10`,
      [input.loginName.trim(),input.organizationSlug.trim()],
    );
    const matches=[];
    for(const candidate of found.rows)if(await verifyPassword(input.password,candidate.password_hash))matches.push(candidate);
    if(matches.length!==1){this.recordFailedLogin(attemptKey);throw new UnauthorizedException(matches.length>1?'存在多个相同教室账号，请联系管理员':'教室账号或密码错误');}
    this.loginAttempts.delete(attemptKey);
    const classroom=matches[0];
    const result=await this.issueDevice(classroom.classroom_id,input.deviceName,input.appVersion,input.installationId);
    const snapshot=await this.authoritativeSnapshot(classroom.classroom_id);
    await this.audit(classroom.organization_id,'classroom-device',null,'classroom-device.login',result.deviceId,requestId,{classroomId:classroom.classroom_id});
    return{...result,classroomName:classroom.classroom_name,snapshot};
  }

  async authoritativeSnapshot(classroomId:string) {
    const[classroom,students,assignments,submissions,members]=await Promise.all([
      this.database.query('SELECT c.id,c.name,c.configured,c.revision,o.timezone FROM classrooms c JOIN organizations o ON o.id=c.organization_id WHERE c.id=$1 AND c.deleted_at IS NULL',[classroomId]),
      this.database.query("SELECT id,name,sort_order FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at",[classroomId]),
      this.database.query("SELECT id,subject,type,title,publish_at,deadline,source FROM assignments WHERE classroom_id=$1 AND status='active' ORDER BY created_at",[classroomId]),
      this.database.query(`SELECT s.assignment_id,s.student_id,s.status FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN students st ON st.id=s.student_id WHERE a.classroom_id=$1 AND a.status='active' AND st.classroom_id=$1 AND st.status='active'`,[classroomId]),
      this.database.query(`SELECT m.user_id,u.name,m.role,m.status,m.subjects_json,m.joined_at,m.created_at FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 AND m.status IN('approved','pending') AND u.status='active' AND u.deleted_at IS NULL ORDER BY m.created_at`,[classroomId]),
    ]);
    const room=classroom.rows[0];
    if(!room)throw new NotFoundException('教室不存在');
    const submissionMap=new Map<string,Record<string,string>>();
    for(const row of submissions.rows){
      const values=submissionMap.get(String(row.assignment_id))||{};
      values[String(row.student_id)]=String(row.status||'未提交');
      submissionMap.set(String(row.assignment_id),values);
    }
    const normalizeSubjects=(value:unknown)=>{
      let source:unknown[]=Array.isArray(value)?value:[];
      if(typeof value==='string')try{const parsed:unknown=JSON.parse(value);source=Array.isArray(parsed)?parsed:[];}catch{source=[];}
      return Array.from(new Set(source.map(item=>String(item||'').trim()).filter(Boolean))).slice(0,20);
    };
    const teacherRows=members.rows.map(row=>({
      connectionId:`cloud-${row.user_id}`,
      name:String(row.name||'云端教师'),
      role:row.role==='homeroom'?'homeroom':'teacher',
      subjects:normalizeSubjects(row.subjects_json),
      status:row.status,
      changedAt:row.joined_at||row.created_at,
    }));
    return{
      type:'cloud.restore',
      authority:'cloud',
      classroomId:String(room.id),
      revision:Number(room.revision||0),
      className:String(room.name||''),
      classroomConfigured:!!room.configured,
      students:students.rows.map(row=>({id:String(row.id),name:String(row.name||'')})),
      assignments:assignments.rows.map(row=>({
        id:String(row.id),subject:String(row.subject||''),type:row.type==='notice'?'notice':'homework',title:String(row.title||''),
        date:row.publish_at?this.localDate(row.publish_at,String(room.timezone||'Asia/Shanghai')):'',deadline:row.deadline?new Date(row.deadline).toISOString():null,
        source:row.source==='student'?'student':'teacher',submissions:submissionMap.get(String(row.id))||{},
      })),
      teachers:{approved:teacherRows.filter(row=>row.status==='approved'),pending:teacherRows.filter(row=>row.status==='pending')},
    };
  }

  private localDate(value:unknown,timeZone:string) {
    const parts=new Intl.DateTimeFormat('en-US',{day:'2-digit',month:'2-digit',timeZone,year:'numeric'}).formatToParts(new Date(String(value)));
    const part=(type:string)=>parts.find(item=>item.type===type)?.value||'';
    return`${part('year')}-${part('month')}-${part('day')}`;
  }

  async listDevices(auth:AuthContext) {
    const rows=(await this.database.query(
      `SELECT d.id,d.device_name,d.status,d.app_version,d.last_seen_at,d.revoked_at,d.created_at,d.classroom_id,c.name AS classroom_name,c.campus_id,cp.name AS campus_name
       FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id LEFT JOIN campuses cp ON cp.id=c.campus_id
       WHERE c.organization_id=$1 AND c.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 500`,
      [auth.organizationId],
    )).rows;
    return rows.filter(row=>canAccessClassroom(auth,String(row.classroom_id),row.campus_id||null,'device.read'));
  }

  async heartbeat(input:DeviceHeartbeatDto) {
    const result=(await this.database.query(
      `UPDATE classroom_devices SET status='online',last_seen_at=now(),app_version=COALESCE($2,app_version),lan_connection_code=COALESCE($3,lan_connection_code),lan_status_updated_at=CASE WHEN $3::text IS NULL THEN lan_status_updated_at ELSE now() END
       WHERE device_token_hash=$1 AND revoked_at IS NULL RETURNING id,classroom_id,last_seen_at`,
      [hashOpaqueToken(input.deviceToken,this.config.KEY_PEPPER),input.appVersion||null,input.lanConnectionCode||null],
    )).rows[0];
    if(!result)throw new UnauthorizedException('教室设备令牌无效');
    return result;
  }

  async updateRealtimeStatus(deviceId:string,payload:unknown) {
    const source=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:{};
    const addresses=(Array.isArray(source.lanAddresses)?source.lanAddresses:[]).map(value=>String(value||'').trim()).filter(value=>/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)\d{1,3}(?:\.\d{1,3}){2}$/.test(value)).slice(0,8);
    const lanConnectionCode=String(source.lanConnectionCode||'').trim().slice(0,20)||null;
    const operationalStatus=this.normalizeOperationalStatus(source.operationalStatus);
    await this.database.query(
      `UPDATE classroom_devices SET status='online',last_seen_at=now(),lan_connection_code=$2,lan_addresses_json=$3::jsonb,lan_status_updated_at=now(),
       operational_status_json=CASE WHEN $4::jsonb IS NULL THEN operational_status_json ELSE $4::jsonb END,
       operational_status_updated_at=CASE WHEN $4::jsonb IS NULL THEN operational_status_updated_at ELSE now() END
       WHERE id=$1 AND revoked_at IS NULL`,
      [deviceId,lanConnectionCode,JSON.stringify(Array.from(new Set(addresses))),operationalStatus?JSON.stringify(operationalStatus):null],
    );
  }

  async authenticateToken(deviceToken:string) {
    const device=(await this.database.query(
      `UPDATE classroom_devices d SET status='online',last_seen_at=now() FROM classrooms c
       WHERE d.classroom_id=c.id AND d.device_token_hash=$1 AND d.revoked_at IS NULL AND c.deleted_at IS NULL
       RETURNING d.id,d.classroom_id,c.organization_id`,
      [hashOpaqueToken(deviceToken,this.config.KEY_PEPPER)],
    )).rows[0];
    if(!device)throw new UnauthorizedException('教室设备令牌无效');
    return device as {id:string;classroom_id:string;organization_id:string};
  }

  async isActiveDevice(deviceId:string,classroomId:string) {
    const result=await this.database.query(
      `SELECT 1 FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id
       WHERE d.id=$1 AND d.classroom_id=$2 AND d.revoked_at IS NULL AND c.deleted_at IS NULL AND c.status='active'`,
      [deviceId,classroomId],
    );
    return result.rowCount===1;
  }

  async revokeDevice(auth:AuthContext,id:string,requestId:string) {
    const current=(await this.database.query('SELECT d.classroom_id,c.campus_id FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id WHERE d.id=$1 AND c.organization_id=$2 AND d.revoked_at IS NULL',[id,auth.organizationId])).rows[0];
    if(!current)throw new NotFoundException('设备不存在或已吊销');
    if(!canAccessClassroom(auth,String(current.classroom_id),current.campus_id||null,'device.manage'))throw new ForbiddenException('无权管理该设备');
    await this.database.query("UPDATE classroom_devices SET revoked_at=now(),status='offline' WHERE id=$1 AND revoked_at IS NULL",[id]);
    this.hub.closeDevice(id);
    await this.audit(auth.organizationId,'user',auth.subjectId,'classroom-device.revoke',id,requestId,{classroomId:current.classroom_id});
  }

  async revokeByToken(deviceToken:string) {
    const result=await this.database.query(
      "UPDATE classroom_devices SET revoked_at=now(),status='offline' WHERE device_token_hash=$1 AND revoked_at IS NULL RETURNING id",
      [hashOpaqueToken(deviceToken,this.config.KEY_PEPPER)],
    );
    if(!result.rowCount)throw new UnauthorizedException('教室设备令牌无效');
    this.hub.closeDevice(String(result.rows[0].id));
  }

  private async issueDevice(classroomId:string,deviceName:string,appVersion?:string,installationId?:string) {
    const deviceToken=generateOpaqueToken('cd');
    const row=(await this.database.query(
      `INSERT INTO classroom_devices(classroom_id,device_name,device_token_hash,app_version,client_type,status,last_seen_at,installation_id)
       VALUES($1,$2,$3,$4,'classroom-desktop','online',now(),$5)
       ON CONFLICT(classroom_id,installation_id) WHERE installation_id IS NOT NULL
       DO UPDATE SET device_name=EXCLUDED.device_name,device_token_hash=EXCLUDED.device_token_hash,app_version=EXCLUDED.app_version,status='online',last_seen_at=now(),revoked_at=NULL
       RETURNING id,classroom_id`,
      [classroomId,deviceName.trim(),hashOpaqueToken(deviceToken,this.config.KEY_PEPPER),appVersion||null,installationId||null],
    )).rows[0];
    this.hub.closeDevice(String(row.id),4403,'device token rotated');
    return{deviceId:row.id,classroomId:row.classroom_id,deviceToken};
  }

  private normalizeOperationalStatus(value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const source=value as Record<string,unknown>;
    const reportedValue=String(source.reportedAt||'').trim();
    return{
      reportedAt:reportedValue&&!Number.isNaN(Date.parse(reportedValue))?new Date(reportedValue).toISOString():new Date().toISOString(),
      appReady:source.appReady===true,
      classroomConfigured:source.classroomConfigured===true,
    };
  }

  private allowLoginAttempt(key:string){
    const now=Date.now();
    if(this.loginAttempts.size>10_000)for(const[attemptKey,value]of this.loginAttempts)if(value.resetAt<=now)this.loginAttempts.delete(attemptKey);
    const current=this.loginAttempts.get(key);
    if(!current||current.resetAt<=now){this.loginAttempts.delete(key);return true;}
    return current.count<8;
  }

  private recordFailedLogin(key:string){
    const now=Date.now();const current=this.loginAttempts.get(key);
    if(!current||current.resetAt<=now)this.loginAttempts.set(key,{count:1,resetAt:now+15*60_000});
    else current.count+=1;
  }

  private audit(organizationId:string,actorType:string,actorId:string|null,action:string,targetId:string,requestId:string,metadata:Record<string,unknown>) {
    return this.database.query('INSERT INTO audit_logs(organization_id,actor_type,actor_id,action,target_type,target_id,request_id,metadata_json)VALUES($1,$2,$3,$4,\'classroom-device\',$5,$6,$7)',[organizationId,actorType,actorId,action,targetId,requestId,JSON.stringify(metadata)]);
  }
}
