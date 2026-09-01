import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import { ClassroomSocketHub } from './classroom-socket-hub.js';

@Injectable()
export class OutboxWorker implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(OutboxWorker.name);
  private timer?:NodeJS.Timeout;
  private running=false;
  private lastCleanup=0;
  constructor(@Inject(DATABASE)private readonly database:Database,private readonly hub:ClassroomSocketHub) {}

  onModuleInit(){this.timer=setInterval(()=>void this.tick(),1000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}

  private async tick(){
    if(this.running)return;
    this.running=true;
    try{
      await this.database.query("UPDATE outbox_events SET status='failed',last_error=COALESCE(last_error,'worker lease expired') WHERE status='processing' AND available_at<=now()");
      const claimed=(await this.database.query(
        `UPDATE outbox_events SET status='processing',attempts=attempts+1,available_at=now()+interval '5 minutes'
         WHERE id IN(SELECT id FROM outbox_events WHERE status IN('pending','failed') AND available_at<=now() ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
         RETURNING id,aggregate_type,aggregate_id,event_type,payload_json,attempts`,
      )).rows;
      for(const event of claimed){
        try{
          if(event.aggregate_type==='classroom')this.hub.broadcastTo(String(event.aggregate_id),'device','classroom.event',{type:'cloud.invalidate',reason:event.event_type,revision:Number(event.payload_json?.revision||0)});
          await this.database.query("UPDATE outbox_events SET status='published',published_at=now(),last_error=NULL WHERE id=$1",[event.id]);
        }catch(error){await this.database.query("UPDATE outbox_events SET status='failed',available_at=now()+make_interval(secs=>LEAST(300,power(2,attempts)::int)),last_error=$2 WHERE id=$1",[event.id,String(error instanceof Error?error.message:error).slice(0,1000)]);}
      }
      if(Date.now()-this.lastCleanup>60*60_000){this.lastCleanup=Date.now();await this.cleanup();}
    }catch(error){this.logger.warn(`outbox worker failed: ${error instanceof Error?error.message:String(error)}`);}
    finally{this.running=false;}
  }

  private async cleanup(){
    await this.database.query("DELETE FROM outbox_events WHERE status='published' AND published_at<now()-interval '30 days'");
    await this.database.query("DELETE FROM refresh_tokens WHERE expires_at<now()-interval '7 days'");
    await this.database.query("DELETE FROM login_events WHERE created_at<now()-interval '180 days'");
    await this.database.query("DELETE FROM security_events WHERE created_at<now()-interval '365 days'");
    await this.database.query("DELETE FROM audit_logs WHERE created_at<now()-interval '365 days'");
    await this.database.query("UPDATE background_jobs SET status='failed',finished_at=now(),last_error=COALESCE(last_error,'worker lease expired') WHERE status='running' AND started_at<now()-interval '1 hour'");
    await this.database.query("DELETE FROM background_jobs WHERE status IN('succeeded','failed','cancelled') AND COALESCE(finished_at,created_at)<now()-interval '90 days'");
  }
}
