import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { containsProhibitedBiometricData } from '../../common/biometric-boundary.js';
import type { CloudConfig } from '../../config.js';
import type { Database } from '../../database.js';
import { CLOUD_CONFIG, DATABASE } from '../../platform/tokens.js';
import { verifyAccessToken, type AccessSubject } from '../../security.js';
import { ClassroomSocketHub } from './classroom-socket-hub.js';
import { CloudMutationService } from './cloud-mutation.service.js';

type CloudMembership={connectionId:string;name:string;role:'homeroom'|'teacher';subjects:string[]};
type SocketSession={subject:AccessSubject;clientId:string;classroomId?:string;membership?:CloudMembership};

@Injectable()
@WebSocketGateway({ path:'/ws/client',maxPayload:262144 })
export class RealtimeGateway implements OnGatewayConnection,OnGatewayDisconnect{
 private readonly sessions=new WeakMap<WebSocket,SocketSession>();
 private readonly authTimers=new WeakMap<WebSocket,NodeJS.Timeout>();
 private readonly rates=new WeakMap<WebSocket,{count:number;resetAt:number}>();
 constructor(@Inject(CLOUD_CONFIG)private readonly config:CloudConfig,@Inject(DATABASE)private readonly database:Database,private readonly hub:ClassroomSocketHub,private readonly mutations:CloudMutationService){}
 handleConnection(client:WebSocket){const timer=setTimeout(()=>{if(!this.sessions.has(client))client.close(4401,'authentication timeout');},10_000);timer.unref();this.authTimers.set(client,timer);}
 handleDisconnect(client:WebSocket){const timer=this.authTimers.get(client);if(timer)clearTimeout(timer);const room=this.sessions.get(client)?.classroomId;if(room)this.hub.detach(room,'user',client);}
 @SubscribeMessage('authenticate')async authenticate(@ConnectedSocket()client:WebSocket,@MessageBody()body:{token?:string}){try{const subject=await verifyAccessToken(String(body?.token||''),this.config);if(subject.subjectType!=='user'||!subject.deviceId)throw new Error();const found=await this.database.query(
  `SELECT u.auth_version FROM users u JOIN user_devices d ON d.user_id=u.id WHERE u.id=$1 AND u.organization_id=$2 AND u.status='active' AND u.deleted_at IS NULL AND d.id=$3 AND d.revoked_at IS NULL`,
  [subject.subjectId,subject.organizationId,subject.deviceId]);if(!found.rowCount||(subject.authVersion!==undefined&&Number(found.rows[0].auth_version)!==subject.authVersion))throw new Error();const clientId=randomUUID();this.sessions.set(client,{subject,clientId});const timer=this.authTimers.get(client);if(timer)clearTimeout(timer);return{event:'session.ready',data:{userId:subject.subjectId,clientId}};}catch{client.close(4401,'invalid access token');}}
 @SubscribeMessage('subscribe')async subscribe(@ConnectedSocket()client:WebSocket,@MessageBody()body:{classroomId?:string}){const session=this.sessions.get(client);if(!session)return{event:'error',data:{code:'AUTH_REQUIRED'}};const classroomId=String(body?.classroomId||'');const found=await this.database.query(
  `SELECT u.name,m.role,m.subjects_json FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 AND m.user_id=$2 AND m.status='approved' AND c.organization_id=$3 AND c.deleted_at IS NULL AND c.status='active' AND u.status='active' AND u.deleted_at IS NULL`,
  [classroomId,session.subject.subjectId,session.subject.organizationId]);if(!found.rowCount)return{event:'error',data:{code:'PERMISSION_DENIED'}};const member=found.rows[0];const subjects=Array.isArray(member.subjects_json)?member.subjects_json.map(String):[];if(session.classroomId)this.hub.detach(session.classroomId,'user',client);session.classroomId=classroomId;session.membership={connectionId:`cloud-${session.subject.subjectId}`,name:String(member.name||'云端教师'),role:member.role==='homeroom'?'homeroom':'teacher',subjects};this.hub.attach(classroomId,'user',client,session.clientId);this.hub.indexUserDevice(session.subject.deviceId!,client);return{event:'subscription.ready',data:{classroomId,transport:'cloud-relay'}};}
 @SubscribeMessage('publish')async publish(@ConnectedSocket()client:WebSocket,@MessageBody()body:unknown){
  const session=this.sessions.get(client);if(!session?.classroomId||!session.membership)return{event:'error',data:{code:'SUBSCRIPTION_REQUIRED'}};
  if(!this.allowMessage(client)){client.close(4429,'rate limit exceeded');return;}
  if(containsProhibitedBiometricData(body)){client.close(4403,'biometric data forbidden');return;}
  if(!body||typeof body!=='object'||Array.isArray(body))return{event:'error',data:{code:'INVALID_MESSAGE'}};
  const authorized=await this.currentMembership(session);
  if(!authorized){client.close(4403,'membership revoked');return;}
  session.membership=authorized;
  const message:Record<string,unknown>={...(body as Record<string,unknown>)};
  delete message._cloudBridgeSecret;delete message._cloudMembership;
  if(this.mutations.isDurable(message)){
    try{const result=await this.mutations.apply(session.subject,session.classroomId,message);return{event:'published',data:{classroomId:session.classroomId,...result}};}
    catch(error){return{event:'error',data:{code:'MUTATION_REJECTED',message:error instanceof Error?error.message:'云端修改失败'}};}
  }
  message._cloudClientId=session.clientId;
  if(message.type==='connect')message._cloudMembership=authorized;
  this.hub.broadcastTo(session.classroomId,'device','classroom.event',message);
  return{event:'published',data:{classroomId:session.classroomId}};
 }

 private async currentMembership(session:SocketSession):Promise<CloudMembership|null>{
  const found=await this.database.query(
   `SELECT u.name,u.auth_version,m.role,m.subjects_json FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id JOIN users u ON u.id=m.user_id JOIN user_devices d ON d.id=$4 AND d.user_id=u.id
    WHERE m.classroom_id=$1 AND m.user_id=$2 AND m.status='approved' AND c.organization_id=$3 AND c.deleted_at IS NULL AND c.status='active'
    AND u.status='active' AND u.deleted_at IS NULL AND d.revoked_at IS NULL`,[session.classroomId,session.subject.subjectId,session.subject.organizationId,session.subject.deviceId]);
  const row=found.rows[0];
  if(!row||(session.subject.authVersion!==undefined&&Number(row.auth_version)!==session.subject.authVersion))return null;
  return{connectionId:`cloud-${session.subject.subjectId}`,name:String(row.name||'云端教师'),role:row.role==='homeroom'?'homeroom':'teacher',subjects:Array.isArray(row.subjects_json)?row.subjects_json.map(String):[]};
 }

 private allowMessage(client:WebSocket){const now=Date.now();const current=this.rates.get(client);if(!current||current.resetAt<=now){this.rates.set(client,{count:1,resetAt:now+60_000});return true;}current.count+=1;return current.count<=120;}
}
