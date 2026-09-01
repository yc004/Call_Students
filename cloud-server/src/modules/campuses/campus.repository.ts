import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { CreateCampusDto, UpdateCampusDto } from './campus.dto.js';

@Injectable()
export class CampusRepository {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  async list(organizationId:string) {
    return (await this.database.query(
      `SELECT c.id,c.name,c.code,c.status,c.address,c.settings_json,c.created_at,c.updated_at,
              count(DISTINCT cl.id)::int AS classroom_count
       FROM campuses c LEFT JOIN classrooms cl ON cl.campus_id=c.id AND cl.deleted_at IS NULL
       WHERE c.organization_id=$1 AND c.deleted_at IS NULL GROUP BY c.id ORDER BY c.name`,[organizationId])).rows;
  }

  async find(organizationId:string,id:string) {
    return (await this.database.query(
      'SELECT * FROM campuses WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL',[id,organizationId])).rows[0]||null;
  }

  async create(organizationId:string,userId:string,input:CreateCampusDto) {
    return (await this.database.query(
      `INSERT INTO campuses(organization_id,name,code,address,settings_json,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [organizationId,input.name.trim(),input.code.trim(),input.address?.trim()||null,JSON.stringify(input.settings||{}),userId])).rows[0];
  }

  async update(organizationId:string,id:string,userId:string,input:UpdateCampusDto) {
    return (await this.database.query(
      `UPDATE campuses SET name=COALESCE($4,name),code=COALESCE($5,code),address=COALESCE($6,address),
       settings_json=COALESCE($7::jsonb,settings_json),status=COALESCE($8,status),updated_by=$3,updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING *`,
      [id,organizationId,userId,input.name?.trim()||null,input.code?.trim()||null,input.address?.trim()||null,
        input.settings?JSON.stringify(input.settings):null,input.status||null])).rows[0]||null;
  }

  async archive(organizationId:string,id:string,userId:string) {
    return (await this.database.query(
      `UPDATE campuses SET status='archived',deleted_at=now(),updated_by=$3,updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL RETURNING id`,[id,organizationId,userId])).rows[0]||null;
  }
}
