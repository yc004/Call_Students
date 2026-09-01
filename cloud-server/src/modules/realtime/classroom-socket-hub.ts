import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

export type SocketAudience = 'device' | 'user';

@Injectable()
export class ClassroomSocketHub {
  private readonly rooms = new Map<string, Map<SocketAudience, Set<WebSocket>>>();
  private readonly userClients = new Map<string, Map<string, WebSocket>>();
  private readonly deviceClients = new Map<string,WebSocket>();
  private readonly userDevices = new Map<string,Set<WebSocket>>();

  attach(classroomId:string, audience:SocketAudience, client:WebSocket, clientId?:string) {
    let room = this.rooms.get(classroomId);
    if (!room) {
      room = new Map();
      this.rooms.set(classroomId, room);
    }
    let clients = room.get(audience);
    if (!clients) {
      clients = new Set();
      room.set(audience, clients);
    }
    clients.add(client);
    if(audience==='user'&&clientId){let indexed=this.userClients.get(classroomId);if(!indexed){indexed=new Map();this.userClients.set(classroomId,indexed);}indexed.set(clientId,client);}
    if(audience==='device'&&clientId)this.deviceClients.set(clientId,client);
  }

  detach(classroomId:string, audience:SocketAudience, client:WebSocket) {
    const room = this.rooms.get(classroomId);
    const clients = room?.get(audience);
    clients?.delete(client);
    if(audience==='user'){const indexed=this.userClients.get(classroomId);if(indexed){for(const[id,socket]of indexed)if(socket===client)indexed.delete(id);if(indexed.size===0)this.userClients.delete(classroomId);}for(const[deviceId,sockets]of this.userDevices){sockets.delete(client);if(!sockets.size)this.userDevices.delete(deviceId);}}
    if(audience==='device')for(const[id,socket]of this.deviceClients)if(socket===client)this.deviceClients.delete(id);
    if (clients && clients.size === 0) room?.delete(audience);
    if (room && room.size === 0) this.rooms.delete(classroomId);
  }

  broadcastTo(classroomId:string,audience:SocketAudience,event:string,data:unknown,except?:WebSocket){const clients=this.rooms.get(classroomId)?.get(audience);if(!clients)return;const payload=JSON.stringify({event,data});for(const client of clients)if(client!==except&&client.readyState===client.OPEN)client.send(payload);}

  sendToUser(classroomId:string,clientId:string,event:string,data:unknown){const client=this.userClients.get(classroomId)?.get(clientId);if(client&&client.readyState===client.OPEN){client.send(JSON.stringify({event,data}));return true;}return false;}

  closeDevice(deviceId:string,code=4403,reason='device revoked'){const client=this.deviceClients.get(deviceId);if(!client)return false;this.deviceClients.delete(deviceId);try{client.close(code,reason);}catch{return false;}return true;}

  indexUserDevice(deviceId:string,client:WebSocket){let clients=this.userDevices.get(deviceId);if(!clients){clients=new Set();this.userDevices.set(deviceId,clients);}clients.add(client);}

  closeUserDevice(deviceId:string,code=4401,reason='user device revoked'){const clients=this.userDevices.get(deviceId);if(!clients)return 0;this.userDevices.delete(deviceId);for(const client of clients)try{client.close(code,reason);}catch{}return clients.size;}

  broadcast(classroomId:string, event:string, data:unknown, except?:WebSocket) {
    const room = this.rooms.get(classroomId);
    if (!room) return;
    const payload = JSON.stringify({ event, data });
    for (const clients of room.values()) {
      for (const client of clients) {
        if (client !== except && client.readyState === client.OPEN) client.send(payload);
      }
    }
  }
}
