import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({ imports:[RealtimeModule],controllers:[AuthController],providers:[AuthService],exports:[AuthService] })
export class AuthModule {}
