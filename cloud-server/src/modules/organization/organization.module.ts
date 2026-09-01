import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationRepository } from './organization.repository.js';
import { OrganizationService } from './organization.service.js';

@Module({ controllers:[OrganizationController],providers:[OrganizationRepository,OrganizationService] })
export class OrganizationModule {}
