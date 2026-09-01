import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth.guard.js';
import { BiometricBoundaryGuard } from './common/biometric-boundary.guard.js';
import { PermissionsGuard } from './common/permissions.guard.js';
import type { CloudConfig } from './config.js';
import type { Database } from './database.js';
import { DatabaseLifecycle } from './platform/database-lifecycle.js';
import { SystemModule } from './modules/system/system.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { CampusModule } from './modules/campuses/campus.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { UserModule } from './modules/users/user.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ClassroomModule } from './modules/classrooms/classroom.module.js';
import { TeachingModule } from './modules/teaching/teaching.module.js';
import { DeviceModule } from './modules/devices/device.module.js';
import { SubjectModule } from './modules/subjects/subject.module.js';
import { ProfileModule } from './modules/profile/profile.module.js';
import { ClientAccessModule } from './modules/client-access/client-access.module.js';
import { CLOUD_CONFIG, DATABASE } from './platform/tokens.js';

export type AppDependencies = { config:CloudConfig; database:Database };

@Module({})
export class AppModule {
  static register(dependencies:AppDependencies):DynamicModule {
    return {
      module:AppModule,
      global:true,
      imports:[ThrottlerModule.forRoot([{ttl:60_000,limit:120}]),AuthModule,ProfileModule,ClientAccessModule,OrganizationModule,CampusModule,AuthorizationModule,UserModule,SubjectModule,ClassroomModule,TeachingModule,DeviceModule,AuditModule,RealtimeModule,SystemModule],
      providers:[
        { provide:CLOUD_CONFIG, useValue:dependencies.config },
        { provide:DATABASE, useValue:dependencies.database },
        DatabaseLifecycle,
        { provide:APP_GUARD, useClass:BiometricBoundaryGuard },
        { provide:APP_GUARD, useClass:AuthGuard },
        { provide:APP_GUARD, useClass:PermissionsGuard },
        { provide:APP_GUARD, useClass:ThrottlerGuard },
      ],
      exports:[CLOUD_CONFIG, DATABASE],
    };
  }
}
