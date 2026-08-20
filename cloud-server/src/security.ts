import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { CloudConfig } from './config.js';

const scrypt = promisify(scryptCallback);

export type AccessSubject = {
  subjectType: 'user' | 'classroom-device';
  subjectId: string;
  organizationId: string;
  role: string;
  deviceId?: string;
};

export async function hashPassword(password:string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password:string, stored:string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateOpaqueToken(prefix:string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function hashOpaqueToken(value:string, pepper:string): string {
  return createHmac('sha256', pepper).update(String(value || ''), 'utf8').digest('hex');
}

export async function signAccessToken(subject:AccessSubject, config:CloudConfig): Promise<string> {
  return new SignJWT({
    subjectType:subject.subjectType,
    organizationId:subject.organizationId,
    role:subject.role,
    ...(subject.deviceId ? { deviceId:subject.deviceId } : {}),
  })
    .setProtectedHeader({ alg:'HS256', typ:'JWT' })
    .setSubject(subject.subjectId)
    .setIssuer(config.PUBLIC_URL)
    .setAudience('banda-cloud')
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(config.ACCESS_TOKEN_SECRET));
}

export async function verifyAccessToken(token:string, config:CloudConfig): Promise<AccessSubject> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(config.ACCESS_TOKEN_SECRET), {
    issuer:config.PUBLIC_URL,
    audience:'banda-cloud',
  });
  if (!payload.sub || !payload.organizationId || !payload.subjectType || !payload.role) throw new Error('令牌字段不完整');
  if (payload.subjectType !== 'user' && payload.subjectType !== 'classroom-device') throw new Error('令牌主体无效');
  return {
    subjectType:payload.subjectType,
    subjectId:payload.sub,
    organizationId:String(payload.organizationId),
    role:String(payload.role),
    ...(payload.deviceId ? { deviceId:String(payload.deviceId) } : {}),
  };
}
