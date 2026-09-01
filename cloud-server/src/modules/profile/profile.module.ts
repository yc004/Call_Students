import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
@Module({imports:[RealtimeModule],controllers:[ProfileController],providers:[ProfileService]})
export class ProfileModule {}
