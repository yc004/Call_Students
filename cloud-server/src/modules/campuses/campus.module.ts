import { Module } from '@nestjs/common';
import { CampusController } from './campus.controller.js';
import { CampusRepository } from './campus.repository.js';
import { CampusService } from './campus.service.js';
@Module({controllers:[CampusController],providers:[CampusRepository,CampusService]})
export class CampusModule{}
