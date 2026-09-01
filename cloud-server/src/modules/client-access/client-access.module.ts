import { Module } from '@nestjs/common';
import { ClientAccessController } from './client-access.controller.js';
import { ClientAccessService } from './client-access.service.js';
@Module({controllers:[ClientAccessController],providers:[ClientAccessService]})
export class ClientAccessModule {}
