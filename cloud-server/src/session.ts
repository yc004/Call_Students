import { randomUUID } from 'node:crypto';
import type { CloudConfig } from './config.js';
import type { Database, DatabaseClient } from './database.js';
import { generateOpaqueToken, hashOpaqueToken, signAccessToken, type AccessSubject } from './security.js';

type Queryable = Pick<Database | DatabaseClient, 'query'>;

export async function createSession(database:Queryable, subject:AccessSubject, deviceId:string | null, config:CloudConfig, familyId:string|null=null) {
  const boundSubject:AccessSubject = { ...subject, ...(deviceId ? { deviceId } : {}) };
  const accessToken = await signAccessToken(boundSubject, config);
  const accessExpiresAt = new Date(Date.now() + config.ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshToken = generateOpaqueToken('rt');
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400000);
  const refreshTokenId=randomUUID();
  await database.query(
    `INSERT INTO refresh_tokens (id, subject_type, subject_id, device_id, token_hash, expires_at, family_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,$1))`,
    [refreshTokenId, subject.subjectType, subject.subjectId, deviceId, hashOpaqueToken(refreshToken, config.KEY_PEPPER), expiresAt,familyId],
  );
  return { accessToken, accessExpiresAt:accessExpiresAt.toISOString(), refreshToken, expiresAt:expiresAt.toISOString(), tokenType:'Bearer' };
}
