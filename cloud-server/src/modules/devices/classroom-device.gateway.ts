import { Injectable } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { containsProhibitedBiometricData } from '../../common/biometric-boundary.js';
import { ClassroomSocketHub } from '../realtime/classroom-socket-hub.js';
import { DeviceService } from './device.service.js';

type DeviceSession={deviceId:string;classroomId:string};

@Injectable()
@WebSocketGateway({ path:'/ws/classroom',maxPayload:262144 })
export class ClassroomDeviceGateway implements OnGatewayConnection,OnGatewayDisconnect {
  private readonly sessions = new WeakMap<WebSocket,DeviceSession>();
  private readonly authTimers = new WeakMap<WebSocket,NodeJS.Timeout>();
  private readonly rates = new WeakMap<WebSocket,{count:number;resetAt:number}>();

  constructor(private readonly devices:DeviceService, private readonly hub:ClassroomSocketHub) {}

  handleConnection(client:WebSocket) {
    const timer=setTimeout(()=>{if(!this.sessions.has(client))client.close(4401,'authentication timeout');},10_000);
    timer.unref();
    this.authTimers.set(client,timer);
  }

  handleDisconnect(client:WebSocket) {
    const timer=this.authTimers.get(client);
    if(timer)clearTimeout(timer);
    const session=this.sessions.get(client);
    if(session)this.hub.detach(session.classroomId,'device',client);
  }

  @SubscribeMessage('authenticate')
  async authenticate(@ConnectedSocket()client:WebSocket,@MessageBody()body:{deviceToken?:string}) {
    try {
      const device=await this.devices.authenticateToken(String(body?.deviceToken||''));
      const session={deviceId:device.id,classroomId:device.classroom_id};
      this.sessions.set(client,session);
      this.hub.attach(session.classroomId,'device',client,session.deviceId);
      const timer=this.authTimers.get(client);
      if(timer)clearTimeout(timer);
      const snapshot=await this.devices.authoritativeSnapshot(session.classroomId);
      client.send(JSON.stringify({event:'classroom.event',data:snapshot}));
      return {event:'session.ready',data:session};
    } catch {
      client.close(4401,'invalid device token');
    }
  }

  @SubscribeMessage('publish')
  async publish(@ConnectedSocket()client:WebSocket,@MessageBody()body:unknown) {
    const session=this.sessions.get(client);
    if(!session)return{event:'error',data:{code:'AUTH_REQUIRED'}};
    if(!this.allowMessage(client)){client.close(4429,'rate limit exceeded');return;}
    if(!await this.devices.isActiveDevice(session.deviceId,session.classroomId)){client.close(4403,'device revoked');return;}
    if(containsProhibitedBiometricData(body)){client.close(4403,'biometric data forbidden');return;}
    if(body&&typeof body==='object'&&!Array.isArray(body)&&(body as Record<string,unknown>).type==='device.status'){
      await this.devices.updateRealtimeStatus(session.deviceId,(body as Record<string,unknown>).payload);
      return{event:'published',data:{classroomId:session.classroomId}};
    }
    if(body&&typeof body==='object'&&!Array.isArray(body)&&(body as Record<string,unknown>).type==='device.snapshot-request'){
      const knownRevision=Number((body as Record<string,unknown>).knownRevision||0);
      const snapshot=await this.devices.authoritativeSnapshot(session.classroomId);
      client.send(JSON.stringify({event:'classroom.event',data:Number(snapshot.revision||0)<=knownRevision?{type:'cloud.snapshot-current',revision:snapshot.revision}:snapshot}));
      return{event:'published',data:{classroomId:session.classroomId,revision:snapshot.revision}};
    }
    const clientId=body&&typeof body==='object'&&!Array.isArray(body)?String((body as Record<string,unknown>)._cloudClientId||''):'';
    if(clientId)this.hub.sendToUser(session.classroomId,clientId,'classroom.event',body);
    else this.hub.broadcastTo(session.classroomId,'user','classroom.event',body,client);
    return{event:'published',data:{classroomId:session.classroomId}};
  }

  private allowMessage(client:WebSocket){const now=Date.now();const current=this.rates.get(client);if(!current||current.resetAt<=now){this.rates.set(client,{count:1,resetAt:now+60_000});return true;}current.count+=1;return current.count<=180;}
}
