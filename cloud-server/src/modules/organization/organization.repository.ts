import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';
import type { UpdateOrganizationDto } from './organization.dto.js';

@Injectable()
export class OrganizationRepository {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  async find(id:string) {
    const result=await this.database.query(
      `SELECT id,name,slug,short_name,logo_url,primary_color,timezone,plan,status,settings_json,created_at,updated_at
       FROM organizations WHERE id=$1 AND deleted_at IS NULL`,[id]);
    return result.rows[0] || null;
  }

  async update(id:string,input:UpdateOrganizationDto) {
    const result=await this.database.query(
      `UPDATE organizations SET name=$2,short_name=$3,logo_url=$4,primary_color=upper($5),
       settings_json=COALESCE($6::jsonb,settings_json),timezone=COALESCE($7,timezone),updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,name,slug,short_name,logo_url,primary_color,timezone,plan,status,settings_json,created_at,updated_at`,
      [id,input.name.trim(),input.shortName.trim(),input.logoUrl||null,input.primaryColor,JSON.stringify(input.settings ?? null),input.timezone||null]);
    return result.rows[0] || null;
  }
}
