import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { loadConfig, type CloudConfig } from './config.js';
import { createDatabase, transaction, type Database } from './database.js';
import { migrate } from './migrate.js';
import { createSession } from './session.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
  type AccessSubject,
} from './security.js';

type ServerDependencies = { config:CloudConfig; database:Database; migrateOnStart?:boolean };
type AuthenticatedRequest = FastifyRequest & { cloudSubject?:AccessSubject };
type ClientType = 'admin-web' | 'classroom-desktop' | 'teacher-desktop' | 'mini-program';

const CLIENT_TYPES = new Set<ClientType>(['admin-web', 'classroom-desktop', 'teacher-desktop', 'mini-program']);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(currentDir, '..', 'admin-web');
const avatarDir = process.env.AVATAR_DIR || path.resolve(process.cwd(), 'uploads', 'avatars');

function avatarExtension(contentType:string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function saveAvatar(buffer:Buffer, contentType:string): string {
  mkdirSync(avatarDir, { recursive: true });
  const filename = randomBytes(16).toString('hex') + avatarExtension(contentType);
  writeFileSync(path.join(avatarDir, filename), buffer);
  return filename;
}

function bearerToken(request:FastifyRequest): string {
  const value = String(request.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function safeEqual(left:string, right:string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseBody<T>(schema:z.ZodType<T>, request:FastifyRequest): T {
  return schema.parse(request.body);
}

function declaredClient(request:FastifyRequest): ClientType | null {
  const value = String(request.headers['x-banda-client'] || '');
  return CLIENT_TYPES.has(value as ClientType) ? value as ClientType : null;
}

function compatibleUserClient(role:string, registered:string, declared:ClientType | null): boolean {
  if (role === 'admin') return registered === 'admin-web' && declared === 'admin-web';
  return ['teacher-desktop', 'mini-program'].includes(registered) && (declared === 'teacher-desktop' || declared === 'mini-program');
}

function clientAllowed(request:FastifyRequest, ...allowed:ClientType[]): boolean {
  const client = declaredClient(request);
  return client !== null && allowed.includes(client);
}

function isForbiddenFaceMessage(type:unknown): boolean {
  const value = String(type || '');
  return value.startsWith('face-') || value.startsWith('pending-face') || value.startsWith('label-face');
}

export function containsFaceData(value:unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') return /^data:image\//i.test(value);
  if (Array.isArray(value)) return value.some(item => containsFaceData(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (key !== 'faceLanRequired' && /(?:face|descriptor|embedding|crop[_-]?base64|biometric)/i.test(key)) || containsFaceData(nested, depth + 1));
}

export async function buildServer(dependencies:ServerDependencies) {
  const { config, database } = dependencies;
  if (dependencies.migrateOnStart !== false) await migrate(database);

  const app = Fastify({ logger:{ level:config.LOG_LEVEL }, trustProxy:config.TRUST_PROXY, bodyLimit:1024 * 1024 });
  await app.register(cookie, { secret:config.ACCESS_TOKEN_SECRET });
  await app.register(websocket);
  await app.register(staticFiles, { root:adminRoot, prefix:'/admin/', decorateReply:false });
  mkdirSync(avatarDir, { recursive: true });
  await app.register(staticFiles, { root:avatarDir, prefix:'/uploads/avatars/', decorateReply:false });
  app.addContentTypeParser(['image/png', 'image/jpeg', 'image/webp'], { parseAs:'buffer', bodyLimit:5 * 1024 * 1024 }, (_request, body, done) => done(null, body as Buffer));
  app.addHook('preValidation', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (containsFaceData(request.body)) return reply.code(400).send({ error:'FACE_DATA_FORBIDDEN', message:'云服务禁止接收人脸图片、特征或识别数据' });
    if (request.headers['x-banda-protocol'] !== '1' || !declaredClient(request)) {
      return reply.code(403).send({ error:'CLIENT_IDENTITY_REQUIRED', message:'无法识别客户端或协议版本，请使用受支持的班达客户端' });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: https:; style-src 'self'; script-src 'self'");
    return payload;
  });

  const loginAttempts = new Map<string, { count:number; resetAt:number }>();
  const classroomSockets = new Map<string, Set<WebSocket>>();
  const clientSockets = new Map<string, Set<WebSocket>>();
  const clientSocketIds = new WeakMap<WebSocket, string>();
  const clientSubjects = new WeakMap<WebSocket, AccessSubject>();
  const classroomSocketDeviceIds = new WeakMap<WebSocket, string>();
  const classroomPresenceTimer = setInterval(() => {
    void database.query("UPDATE classroom_devices SET status='offline' WHERE status='online' AND (last_seen_at IS NULL OR last_seen_at<now()-interval '65 seconds')").catch(error => app.log.error(error));
  }, 20000);
  classroomPresenceTimer.unref();
  app.addHook('onClose', async () => { clearInterval(classroomPresenceTimer); });
  function consumeLoginAttempt(key:string): boolean {
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) { loginAttempts.set(key, { count:1, resetAt:now + 15 * 60_000 }); return true; }
    current.count += 1;
    return current.count <= 8;
  }

  async function createTeacherSession(userId:string, deviceName:string, deviceType:'mini-program'|'teacher-desktop') {
    const device = await database.query(
      'INSERT INTO user_devices (user_id,device_name,device_type,last_seen_at) VALUES ($1,$2,$3,now()) RETURNING id',
      [userId, deviceName, deviceType],
    );
    const subject:AccessSubject = { subjectType:'user', subjectId:userId, organizationId:(await database.query('SELECT organization_id FROM users WHERE id=$1', [userId])).rows[0].organization_id, role:'teacher' };
    return createSession(database, subject, device.rows[0].id, config);
  }

  async function organizationFor(organizationId:string) {
    const result = await database.query(
      'SELECT id,name,short_name,logo_url,primary_color FROM organizations WHERE id=$1',
      [organizationId],
    );
    const organization = result.rows[0];
    return organization ? {
      id:organization.id,
      name:organization.name,
      shortName:organization.short_name || organization.name,
      logoUrl:organization.logo_url || '',
      primaryColor:organization.primary_color || '#2563EB',
    } : null;
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      reply.code(400).send({ error:'INVALID_REQUEST', message:'请求参数不正确', details:error.issues });
      return;
    }
    app.log.error(error);
    const status = Number((error as { statusCode?:number }).statusCode || 500);
    const message = error instanceof Error ? error.message : '请求处理失败';
    reply.code(status).send({ error:status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED', message:status >= 500 ? '服务器暂时无法处理请求' : message });
  });

  async function authenticate(request:AuthenticatedRequest, reply:FastifyReply) {
    try {
      const subject = await verifyAccessToken(bearerToken(request), config);
      if (subject.subjectType !== 'user') throw new Error('user token required');
      const device = await database.query(
        `SELECT d.id,d.device_type,u.status,u.server_role,u.must_change_password FROM user_devices d JOIN users u ON u.id=d.user_id
         WHERE d.user_id=$1 AND ($2::uuid IS NULL OR d.id=$2::uuid) AND d.revoked_at IS NULL ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC LIMIT 1`,
        [subject.subjectId, subject.deviceId || null],
      );
      if (!device.rowCount || device.rows[0].status !== 'active' || device.rows[0].server_role !== subject.role || !compatibleUserClient(subject.role, device.rows[0].device_type, declaredClient(request))) throw new Error('device identity invalid');
      if (['mini-program','teacher-desktop'].includes(device.rows[0].device_type) && device.rows[0].must_change_password
        && !request.url.startsWith('/api/v1/teacher/profile') && !request.url.startsWith('/api/v1/teacher/avatar')) {
        return reply.code(403).send({ error:'PROFILE_SETUP_REQUIRED', message:'请先修改默认密码并完善个人资料' });
      }
      subject.deviceId = device.rows[0].id;
      request.cloudSubject = subject;
      void database.query('UPDATE user_devices SET last_seen_at=now() WHERE id=$1', [subject.deviceId]);
    } catch (_error) { return reply.code(401).send({ error:'AUTH_REQUIRED', message:'登录设备身份已失效，请重新登录' }); }
  }

  async function requireAdmin(request:AuthenticatedRequest, reply:FastifyReply) {
    await authenticate(request, reply);
    if (reply.sent) return;
    if (request.cloudSubject?.subjectType !== 'user' || request.cloudSubject.role !== 'admin') {
      return reply.code(403).send({ error:'PERMISSION_DENIED', message:'仅系统管理员可以执行此操作' });
    }
  }

  async function audit(subject:AccessSubject | undefined, request:FastifyRequest, action:string, targetType?:string, targetId?:string, metadata:Record<string, unknown> = {}) {
    await database.query(
      `INSERT INTO audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id, ip_address, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [subject?.organizationId || null, subject?.subjectType || 'anonymous', subject?.subjectId || null, action, targetType || null, targetId || null, request.ip, JSON.stringify(metadata)],
    );
  }

  async function pushMembershipToClassroom(classroomId:string, userId:string, action:'upsert'|'remove') {
    const result = await database.query(
      `SELECT u.id,u.name,u.legacy_connection_id,m.role,m.status,m.subjects_json
       FROM users u LEFT JOIN classroom_members m ON m.user_id=u.id AND m.classroom_id=$1
       WHERE u.id=$2 LIMIT 1`,
      [classroomId, userId],
    );
    if (!result.rowCount) return;
    const row = result.rows[0];
    classroomSockets.get(classroomId)?.forEach(socket => {
      if (socket.readyState === 1) socket.send(JSON.stringify({
        type:'cloud.membership', action,
        member:{ userId:row.id, name:row.name, connectionId:row.legacy_connection_id || `cloud-${row.id}`, role:row.role, status:row.status, subjects:row.subjects_json || [] },
      }));
    });
  }

  async function mirrorClassroomSnapshot(classroomId:string, message:Record<string, unknown>) {
    if (message.type !== 'sync' || containsFaceData(message)) return;
    const students = Array.isArray(message.students) ? message.students.slice(0, 5000) as Array<Record<string, unknown>> : [];
    const assignments = Array.isArray(message.assignments) ? message.assignments.slice(0, 5000) as Array<Record<string, unknown>> : [];
    const teacherGroups = message.teachers && typeof message.teachers === 'object' ? message.teachers as Record<string, unknown> : null;
    await transaction(database, async client => {
      const classroom = await client.query('SELECT id,organization_id FROM classrooms WHERE id=$1 FOR UPDATE', [classroomId]);
      if (!classroom.rowCount) return;
      const className = String(message.className || '').trim().slice(0, 120);
      await client.query('UPDATE classrooms SET name=CASE WHEN $2=\'\' THEN name ELSE $2 END,configured=$3,last_device_sync_at=now(),updated_at=now() WHERE id=$1', [classroomId, className, message.classroomConfigured !== false]);
      const activeStudentIds:string[] = [];
      for (let index = 0; index < students.length; index += 1) {
        const id = String(students[index]?.id || '').trim().slice(0, 128);
        const name = String(students[index]?.name || '').trim().slice(0, 80);
        if (!id || !name) continue;
        activeStudentIds.push(id);
        await client.query(`INSERT INTO students (id,classroom_id,name,sort_order,status) VALUES ($1,$2,$3,$4,'active') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now() WHERE students.classroom_id=$2`, [id, classroomId, name, index]);
      }
      if (Array.isArray(message.students)) await client.query("UPDATE students SET status='removed',updated_at=now() WHERE classroom_id=$1 AND NOT (id=ANY($2::text[]))", [classroomId, activeStudentIds]);
      const activeAssignmentIds:string[] = [];
      for (const item of assignments) {
        const id = String(item.id || '').trim().slice(0, 128);
        const subjectName = String(item.subject || '').trim().slice(0, 80);
        const title = String(item.title || '').trim().slice(0, 1000);
        if (!id || !title) continue;
        activeAssignmentIds.push(id);
        const deadlineDate = item.deadline ? new Date(String(item.deadline)) : null;
        const deadline = deadlineDate && !Number.isNaN(deadlineDate.getTime()) ? deadlineDate : null;
        const publishDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? new Date(`${item.date}T00:00:00.000Z`) : new Date();
        await client.query(`INSERT INTO assignments (id,classroom_id,subject,type,title,publish_at,deadline,source,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active') ON CONFLICT (id) DO UPDATE SET subject=EXCLUDED.subject,type=EXCLUDED.type,title=EXCLUDED.title,publish_at=EXCLUDED.publish_at,deadline=EXCLUDED.deadline,source=EXCLUDED.source,status='active',updated_at=now() WHERE assignments.classroom_id=$2`, [id, classroomId, subjectName || null, item.type === 'notice' ? 'notice' : 'homework', title, publishDate, deadline, item.source === 'student' ? 'student' : 'teacher']);
        const submissionMap = item.submissions && typeof item.submissions === 'object' ? item.submissions as Record<string, unknown> : {};
        for (const [studentId, status] of Object.entries(submissionMap)) {
          if (!activeStudentIds.includes(studentId)) continue;
          await client.query(`INSERT INTO submissions (assignment_id,student_id,status) VALUES ($1,$2,$3) ON CONFLICT (assignment_id,student_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`, [id, studentId, String(status || '未提交').slice(0, 20)]);
        }
      }
      if (Array.isArray(message.assignments)) await client.query("UPDATE assignments SET status='deleted',updated_at=now() WHERE classroom_id=$1 AND NOT (id=ANY($2::text[]))", [classroomId, activeAssignmentIds]);
      if (teacherGroups) {
        const localTeachers = [
          ...(Array.isArray(teacherGroups.approved) ? teacherGroups.approved.map(item => ({ item, status:'approved' })) : []),
          ...(Array.isArray(teacherGroups.pending) ? teacherGroups.pending.map(item => ({ item, status:'pending' })) : []),
        ].slice(0, 1000) as Array<{ item:Record<string, unknown>; status:string }>;
        const syncedUserIds:string[] = [];
        for (const entry of localTeachers) {
          const connectionId = String(entry.item.connection_id || entry.item.connectionId || '').trim().slice(0, 128);
          if (!connectionId) continue;
          const user = await client.query("SELECT id FROM users WHERE organization_id=$1 AND server_role='teacher' AND legacy_connection_id=$2 AND status='active' LIMIT 1", [classroom.rows[0].organization_id, connectionId]);
          if (!user.rowCount) continue;
          const userId = user.rows[0].id;
          syncedUserIds.push(userId);
          const subjects = Array.isArray(entry.item.subjects) ? entry.item.subjects.map(String).map(value => value.trim().slice(0, 80)).filter(Boolean).slice(0, 30) : [];
          const role = entry.item.role === '班主任' || entry.item.role === 'homeroom' ? 'homeroom' : 'teacher';
          await client.query(
            `INSERT INTO classroom_members (classroom_id,user_id,role,status,subjects_json,joined_at,sync_source)
             VALUES ($1,$2,$3,$4,$5,CASE WHEN $4='approved' THEN now() ELSE NULL END,'classroom')
             ON CONFLICT (classroom_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,subjects_json=EXCLUDED.subjects_json,joined_at=CASE WHEN EXCLUDED.status='approved' THEN COALESCE(classroom_members.joined_at,now()) ELSE classroom_members.joined_at END,sync_source='classroom',updated_at=now()`,
            [classroomId, userId, role, entry.status, JSON.stringify(subjects)],
          );
        }
        await client.query("DELETE FROM classroom_members WHERE classroom_id=$1 AND sync_source='classroom' AND NOT (user_id=ANY($2::uuid[]))", [classroomId, syncedUserIds]);
      }
    });
  }

  async function legacySyncSnapshot(classroomId:string, userId:string) {
    const [classroom, membership, students, assignments, submissions, members] = await Promise.all([
      database.query("SELECT id,name,configured,revision FROM classrooms WHERE id=$1 AND status='active'", [classroomId]),
      database.query("SELECT m.role,m.status,m.subjects_json,u.name,u.legacy_connection_id FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 AND m.user_id=$2 AND m.status='approved'", [classroomId, userId]),
      database.query("SELECT id,name FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at", [classroomId]),
      database.query("SELECT id,subject,type,title,publish_at,deadline,source FROM assignments WHERE classroom_id=$1 AND status='active' ORDER BY deadline NULLS LAST,created_at", [classroomId]),
      database.query(`SELECT s.assignment_id,s.student_id,s.status FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.classroom_id=$1 AND a.status='active'`, [classroomId]),
      database.query(`SELECT u.id,u.name,u.legacy_connection_id,m.role,m.status,m.subjects_json FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 ORDER BY m.created_at`, [classroomId]),
    ]);
    if (!classroom.rowCount || !membership.rowCount) return null;
    const submissionMap = new Map<string, Record<string, string>>();
    submissions.rows.forEach(row => {
      if (!submissionMap.has(row.assignment_id)) submissionMap.set(row.assignment_id, {});
      submissionMap.get(row.assignment_id)![row.student_id] = row.status;
    });
    const roleName = (role:string) => role === 'homeroom' ? '班主任' : '授课教师';
    const member = membership.rows[0];
    const isHomeroom = member.role === 'homeroom';
    const teacherSubjects = Array.isArray(member.subjects_json) ? member.subjects_json.map(String) : [];
    const allowedSubjects = new Set(teacherSubjects);
    const visibleAssignments = isHomeroom ? assignments.rows : assignments.rows.filter(item => allowedSubjects.has(String(item.subject || '')));
    return {
      type:'sync', cloudSnapshot:true, faceLanRequired:true,
      className:classroom.rows[0].name, classroomConfigured:classroom.rows[0].configured,
      students:students.rows,
      assignments:visibleAssignments.map(item => ({ id:item.id, subject:item.subject, type:item.type, title:item.title, date:new Date(item.publish_at).toISOString().slice(0, 10), deadline:item.deadline, source:item.source, submissions:submissionMap.get(item.id) || {} })),
      subjects:isHomeroom ? Array.from(new Set(members.rows.flatMap(row => Array.isArray(row.subjects_json) ? row.subjects_json.map(String) : []))) : teacherSubjects,
      teacher:{ connectionId:member.legacy_connection_id || `cloud-${userId}`, name:member.name, role:roleName(member.role), subjects:member.subjects_json || [], status:'approved' },
      teachers:isHomeroom ? {
        approved:members.rows.filter(row => row.status === 'approved').map(row => ({ connection_id:row.legacy_connection_id || `cloud-${row.id}`, name:row.name, role:roleName(row.role), subjects:row.subjects_json || [] })),
        pending:members.rows.filter(row => row.status === 'pending').map(row => ({ connection_id:row.legacy_connection_id || `cloud-${row.id}`, name:row.name, role:roleName(row.role), subjects:row.subjects_json || [] })),
      } : null,
    };
  }

  async function classroomRestoreSnapshot(classroomId:string) {
    const [classroom, students, assignments, submissions] = await Promise.all([
      database.query("SELECT name,configured,last_device_sync_at,last_cloud_mutation_at FROM classrooms WHERE id=$1 AND status='active'", [classroomId]),
      database.query("SELECT id,name FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at", [classroomId]),
      database.query("SELECT id,subject,type,title,publish_at,deadline,source FROM assignments WHERE classroom_id=$1 AND status='active' ORDER BY created_at", [classroomId]),
      database.query(`SELECT s.assignment_id,s.student_id,s.status FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.classroom_id=$1 AND a.status='active'`, [classroomId]),
    ]);
    const meta = classroom.rows[0];
    if (!meta || !meta.last_cloud_mutation_at || (meta.last_device_sync_at && new Date(meta.last_cloud_mutation_at) <= new Date(meta.last_device_sync_at))) return null;
    const submissionMap = new Map<string, Record<string,string>>();
    submissions.rows.forEach(row => { if (!submissionMap.has(row.assignment_id)) submissionMap.set(row.assignment_id, {}); submissionMap.get(row.assignment_id)![row.student_id]=row.status; });
    return { type:'cloud.restore', className:meta.name, classroomConfigured:meta.configured, students:students.rows, assignments:assignments.rows.map(item => ({ id:item.id,subject:item.subject,type:item.type,title:item.title,date:new Date(item.publish_at).toISOString().slice(0,10),deadline:item.deadline,source:item.source,submissions:submissionMap.get(item.id)||{} })) };
  }

  async function pushClassroomRestore(classroomId:string) {
    const snapshot = await classroomRestoreSnapshot(classroomId);
    if (!snapshot) return;
    classroomSockets.get(classroomId)?.forEach(socket => {
      if (socket.readyState === 1) socket.send(JSON.stringify(snapshot));
    });
  }

  async function applyLegacyCloudMutation(classroomId:string, subject:AccessSubject, message:Record<string, unknown>):Promise<boolean> {
    const memberResult = await database.query("SELECT role,subjects_json FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 AND status='approved'", [classroomId, subject.subjectId]);
    if (!memberResult.rowCount) return false;
    const member = memberResult.rows[0];
    const isHomeroom = member.role === 'homeroom';
    const subjects = Array.isArray(member.subjects_json) ? member.subjects_json.map(String) : [];
    if (!isHomeroom) return false;
    if (message.type === 'update-classroom') {
      if (!isHomeroom) return false;
      const input = message.classroom && typeof message.classroom === 'object' ? message.classroom as Record<string, unknown> : {};
      const name = String(input.className || '').trim().slice(0, 120);
      const studentList = Array.isArray(input.students) ? input.students as Array<Record<string, unknown>> : [];
      if (!name || !studentList.length) return false;
      await transaction(database, async client => {
        await client.query('UPDATE classrooms SET name=$2,configured=true,updated_at=now() WHERE id=$1', [classroomId, name]);
        const ids:string[] = [];
        for (let index=0; index<studentList.length; index+=1) {
          const id=String(studentList[index]?.id || '').trim().slice(0,128); const studentName=String(studentList[index]?.name || '').trim().slice(0,80);
          if (!id || !studentName) continue; ids.push(id);
          await client.query(`INSERT INTO students (id,classroom_id,name,sort_order,status) VALUES ($1,$2,$3,$4,'active') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now() WHERE students.classroom_id=$2`, [id,classroomId,studentName,index]);
        }
        await client.query("UPDATE students SET status='removed',updated_at=now() WHERE classroom_id=$1 AND NOT (id=ANY($2::text[]))", [classroomId,ids]);
      });
      return true;
    }
    if (message.type === 'update-assignments') {
      const action=String(message.action || ''); const item=message.assignment && typeof message.assignment === 'object' ? message.assignment as Record<string, unknown> : {};
      const id=String(item.id || '').trim().slice(0,128); const subjectName=String(item.subject || '').trim().slice(0,80);
      if (!id || !subjectName || (!isHomeroom && !subjects.includes(subjectName))) return false;
      if (action === 'delete') await database.query("UPDATE assignments SET status='deleted',updated_at=now() WHERE id=$1 AND classroom_id=$2 AND ($3 OR creator_user_id=$4 OR creator_user_id IS NULL)", [id,classroomId,isHomeroom,subject.subjectId]);
      else if ((action === 'add' || action === 'edit') && String(item.title || '').trim()) {
        const deadlineDate=item.deadline ? new Date(String(item.deadline)) : null; const deadline=deadlineDate && !Number.isNaN(deadlineDate.getTime()) ? deadlineDate : null;
        const publishDate=/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? new Date(`${item.date}T00:00:00.000Z`) : new Date();
        await database.query(`INSERT INTO assignments (id,classroom_id,creator_user_id,subject,type,title,publish_at,deadline,source,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') ON CONFLICT (id) DO UPDATE SET subject=EXCLUDED.subject,type=EXCLUDED.type,title=EXCLUDED.title,publish_at=EXCLUDED.publish_at,deadline=EXCLUDED.deadline,status='active',updated_at=now() WHERE assignments.classroom_id=$2 AND ($10 OR assignments.creator_user_id=$3 OR assignments.creator_user_id IS NULL)`, [id,classroomId,subject.subjectId,subjectName,item.type==='notice'?'notice':'homework',String(item.title).trim().slice(0,1000),publishDate,deadline,item.source==='student'?'student':'teacher',isHomeroom]);
      } else return false;
      return true;
    }
    if (message.type === 'update-submission') {
      const assignmentId=String(message.assignmentId || ''); const studentId=String(message.studentId || ''); const status=String(message.status || '未提交').slice(0,20);
      const assignment=await database.query("SELECT subject FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'", [assignmentId,classroomId]);
      if (!assignment.rowCount || (!isHomeroom && !subjects.includes(assignment.rows[0].subject))) return false;
      await database.query(`INSERT INTO submissions (assignment_id,student_id,status,updated_by) SELECT $1,s.id,$3,$4 FROM students s WHERE s.id=$2 AND s.classroom_id=$5 ON CONFLICT (assignment_id,student_id) DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now()`, [assignmentId,studentId,status,subject.subjectId,classroomId]);
      return true;
    }
    return false;
  }

  app.get('/', async (_request, reply) => reply.redirect('/admin/'));
  app.get('/health/live', async () => ({ ok:true, service:'banda-cloud', time:new Date().toISOString() }));
  app.get('/health/ready', async (_request, reply) => {
    try { await database.query('SELECT 1'); return { ok:true, database:'ready' }; }
    catch (_error) { return reply.code(503).send({ ok:false, database:'unavailable' }); }
  });

  app.get('/api/v1/setup/status', async () => {
    const result = await database.query("SELECT EXISTS (SELECT 1 FROM users WHERE server_role='admin' AND status='active') AS initialized");
    return { initialized:!!result.rows[0]?.initialized };
  });

  app.post('/api/v1/setup', async (request, reply) => {
    if (!clientAllowed(request, 'admin-web')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'初始化只能通过管理面板完成' });
    const input = parseBody(z.object({ setupToken:z.string(), organizationName:z.string().trim().min(1).max(120), name:z.string().trim().min(1).max(40), loginName:z.string().trim().min(3).max(80), password:z.string().min(10).max(200) }), request);
    if (!safeEqual(input.setupToken, config.SETUP_TOKEN)) return reply.code(403).send({ error:'SETUP_TOKEN_INVALID', message:'初始化令牌无效' });
    const initialized = await database.query("SELECT 1 FROM users WHERE server_role='admin' LIMIT 1");
    if (initialized.rowCount) return reply.code(409).send({ error:'ALREADY_INITIALIZED', message:'服务器已经完成初始化' });
    const passwordHash = await hashPassword(input.password);
    const result = await transaction(database, async client => {
      const organization = await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id,name', [input.organizationName]);
      const user = await client.query(
        `INSERT INTO users (organization_id,name,login_name,password_hash,server_role,status)
         VALUES ($1,$2,$3,$4,'admin','active') RETURNING id,name,login_name,server_role`,
        [organization.rows[0].id, input.name, input.loginName, passwordHash],
      );
      return { organization:organization.rows[0], user:user.rows[0] };
    });
    await audit(undefined, request, 'system.setup', 'organization', result.organization.id);
    return reply.code(201).send(result);
  });

  app.post('/api/v1/auth/admin/login', async (request, reply) => {
    if (!clientAllowed(request, 'admin-web')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'管理员账号只能登录管理面板' });
    const input = parseBody(z.object({ loginName:z.string().trim(), password:z.string(), deviceName:z.string().trim().max(120).default('Web 管理面板') }), request);
    if (!consumeLoginAttempt(`${request.ip}:${input.loginName.toLowerCase()}`)) return reply.code(429).send({ error:'TOO_MANY_ATTEMPTS', message:'登录尝试过多，请 15 分钟后再试' });
    const found = await database.query(
      `SELECT id,organization_id,name,login_name,password_hash,server_role,status FROM users
       WHERE login_name=$1 AND server_role='admin' LIMIT 1`, [input.loginName],
    );
    const user = found.rows[0];
    if (!user || user.status !== 'active' || !user.password_hash || !(await verifyPassword(input.password, user.password_hash))) {
      return reply.code(401).send({ error:'LOGIN_FAILED', message:'账号或密码错误' });
    }
    const device = await database.query(
      `INSERT INTO user_devices (user_id,device_name,device_type,last_seen_at) VALUES ($1,$2,'admin-web',now()) RETURNING id`,
      [user.id, input.deviceName],
    );
    const subject:AccessSubject = { subjectType:'user', subjectId:user.id, organizationId:user.organization_id, role:'admin' };
    const session = await createSession(database, subject, device.rows[0].id, config);
    await audit(subject, request, 'auth.login', 'user', user.id);
    return { user:{ id:user.id, name:user.name, loginName:user.login_name, role:user.server_role }, ...session };
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const input = parseBody(z.object({ refreshToken:z.string().min(20) }), request);
    const tokenHash = hashOpaqueToken(input.refreshToken, config.KEY_PEPPER);
    const found = await database.query(
      `SELECT r.id,r.subject_type,r.subject_id,r.device_id,u.organization_id,u.server_role,u.status,d.device_type,d.revoked_at AS device_revoked_at
       FROM refresh_tokens r LEFT JOIN users u ON r.subject_type='user' AND u.id=r.subject_id
       LEFT JOIN user_devices d ON d.id=r.device_id AND d.user_id=r.subject_id
       WHERE r.token_hash=$1 AND r.revoked_at IS NULL AND r.expires_at>now() LIMIT 1`, [tokenHash],
    );
    const row = found.rows[0];
    if (!row || row.subject_type !== 'user' || row.status !== 'active' || row.device_revoked_at || !compatibleUserClient(row.server_role, row.device_type, declaredClient(request))) return reply.code(401).send({ error:'TOKEN_REVOKED', message:'登录状态或设备身份已经失效' });
    await database.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [row.id]);
    const subject:AccessSubject = { subjectType:'user', subjectId:row.subject_id, organizationId:row.organization_id, role:row.server_role };
    return createSession(database, subject, row.device_id, config);
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const input = parseBody(z.object({ refreshToken:z.string().min(20) }), request);
    const revoked = await database.query('UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING device_id', [hashOpaqueToken(input.refreshToken, config.KEY_PEPPER)]);
    if (revoked.rows[0]?.device_id) await database.query('UPDATE user_devices SET revoked_at=now() WHERE id=$1', [revoked.rows[0].device_id]);
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/summary', { preHandler:requireAdmin }, async (request:AuthenticatedRequest) => {
    const org = request.cloudSubject!.organizationId;
    const [classrooms, users, onlineDevices, pendingTargets] = await Promise.all([
      database.query("SELECT count(*)::int AS count FROM classrooms c WHERE c.organization_id=$1 AND c.status<>'archived' AND EXISTS (SELECT 1 FROM classroom_devices d WHERE d.classroom_id=c.id AND d.last_seen_at IS NOT NULL)", [org]),
      database.query("SELECT count(*)::int AS count FROM users u WHERE u.organization_id=$1 AND u.server_role='teacher' AND EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id=u.id AND d.last_seen_at IS NOT NULL)", [org]),
      database.query(`SELECT count(*)::int AS count FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id WHERE c.organization_id=$1 AND d.status='online' AND d.last_seen_at>now()-interval '60 seconds' AND d.revoked_at IS NULL`, [org]),
      database.query(`SELECT (
        (SELECT count(*) FROM classrooms c WHERE c.organization_id=$1 AND c.status<>'archived' AND NOT EXISTS (SELECT 1 FROM classroom_devices d WHERE d.classroom_id=c.id AND d.last_seen_at IS NOT NULL)) +
        (SELECT count(*) FROM users u WHERE u.organization_id=$1 AND u.server_role='teacher' AND NOT EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id=u.id AND d.last_seen_at IS NOT NULL))
      )::int AS count`, [org]),
    ]);
    return { classrooms:classrooms.rows[0].count, users:users.rows[0].count, onlineDevices:onlineDevices.rows[0].count, pendingTargets:pendingTargets.rows[0].count };
  });

  app.get('/api/v1/admin/organization', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const organization = await organizationFor(request.cloudSubject!.organizationId);
    if (!organization) return reply.code(404).send({ error:'ORGANIZATION_NOT_FOUND', message:'组织不存在' });
    return { organization };
  });

  app.patch('/api/v1/admin/organization', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const input = parseBody(z.object({
      name:z.string().trim().min(1).max(120),
      shortName:z.string().trim().min(1).max(40),
      logoUrl:z.string().url().max(500).optional().or(z.literal('')),
      primaryColor:z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }), request);
    const result = await database.query(
      `UPDATE organizations SET name=$2,short_name=$3,logo_url=$4,primary_color=UPPER($5)
       WHERE id=$1 RETURNING id,name,short_name,logo_url,primary_color`,
      [request.cloudSubject!.organizationId, input.name, input.shortName, input.logoUrl || null, input.primaryColor],
    );
    if (!result.rowCount) return reply.code(404).send({ error:'ORGANIZATION_NOT_FOUND', message:'组织不存在' });
    await audit(request.cloudSubject, request, 'organization.update', 'organization', request.cloudSubject!.organizationId, input);
    return { organization:await organizationFor(request.cloudSubject!.organizationId) };
  });

  app.get('/api/v1/admin/classrooms', { preHandler:requireAdmin }, async (request:AuthenticatedRequest) => {
    const result = await database.query(
      `SELECT c.*,
              (SELECT count(*)::int FROM students s WHERE s.classroom_id=c.id AND s.status='active') AS student_count,
              (SELECT count(*)::int FROM classroom_members m WHERE m.classroom_id=c.id AND m.status='approved') AS member_count,
              (SELECT count(*)::int FROM assignments a WHERE a.classroom_id=c.id AND a.status='active') AS assignment_count,
              d.id AS device_id, CASE WHEN d.status='online' AND d.last_seen_at>now()-interval '60 seconds' THEN 'online' ELSE 'offline' END AS device_status, d.last_seen_at, d.lan_connection_code
       FROM classrooms c LEFT JOIN LATERAL (
         SELECT id,status,last_seen_at,lan_connection_code FROM classroom_devices WHERE classroom_id=c.id AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1
       ) d ON true WHERE c.organization_id=$1 AND c.status<>'archived'
       ORDER BY c.created_at DESC`, [request.cloudSubject!.organizationId],
    );
    return { classrooms:result.rows };
  });

  app.get('/api/v1/admin/classrooms/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const result = await database.query(
      `SELECT c.id,c.name,c.status,c.configured,c.revision,c.last_device_sync_at,c.created_at,c.updated_at,
              (SELECT count(*)::int FROM students s WHERE s.classroom_id=c.id AND s.status='active') AS student_count,
              (SELECT count(*)::int FROM classroom_members m WHERE m.classroom_id=c.id) AS member_count,
              (SELECT count(*)::int FROM assignments a WHERE a.classroom_id=c.id AND a.status='active') AS assignment_count,
              d.device_name,d.app_version,d.status AS device_status,d.last_seen_at,d.lan_connection_code
       FROM classrooms c LEFT JOIN LATERAL (
         SELECT device_name,app_version,status,last_seen_at,lan_connection_code FROM classroom_devices
         WHERE classroom_id=c.id AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1
       ) d ON true WHERE c.id=$1 AND c.organization_id=$2 AND c.status<>'archived'`,
      [params.id, request.cloudSubject!.organizationId],
    );
    if (!result.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    return { classroom:result.rows[0] };
  });

  app.post('/api/v1/admin/classrooms', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const input = parseBody(z.object({ name:z.string().trim().min(1).max(120) }), request);
    const result = await database.query('INSERT INTO classrooms (organization_id,name) VALUES ($1,$2) RETURNING *', [request.cloudSubject!.organizationId, input.name]);
    await audit(request.cloudSubject, request, 'classroom.create', 'classroom', result.rows[0].id);
    return reply.code(201).send(result.rows[0]);
  });

  app.patch('/api/v1/admin/classrooms/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({ name:z.string().trim().min(1).max(120).optional(), status:z.enum(['active','disabled']).optional() }).refine(value => value.name !== undefined || value.status !== undefined, { message:'至少提供一个需要修改的字段' }), request);
    const result = await database.query(
      `UPDATE classrooms SET name=COALESCE($3,name),status=COALESCE($4,status),updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND status<>'archived' RETURNING *`, [params.id, request.cloudSubject!.organizationId, input.name || null, input.status || null],
    );
    if (!result.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    classroomSockets.get(params.id)?.forEach(socket => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type:'cloud.classroom-update', classroomId:params.id, name:result.rows[0].name, status:result.rows[0].status }));
    });
    if (input.status === 'disabled') {
      classroomSockets.get(params.id)?.forEach(socket => socket.close(4403, 'classroom disabled'));
      clientSockets.get(params.id)?.forEach(socket => socket.close(4403, 'classroom disabled'));
    }
    await audit(request.cloudSubject, request, 'classroom.update', 'classroom', params.id, input);
    return result.rows[0];
  });

  app.delete('/api/v1/admin/classrooms/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const removed = await transaction(database, async client => {
      const found = await client.query("SELECT id,name FROM classrooms WHERE id=$1 AND organization_id=$2 AND status<>'archived' FOR UPDATE", [params.id, request.cloudSubject!.organizationId]);
      if (!found.rowCount) return null;
      await client.query('DELETE FROM classrooms WHERE id=$1', [params.id]);
      return found.rows[0] as { id:string; name:string };
    });
    if (!removed) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    classroomSockets.get(params.id)?.forEach(socket => socket.close(4404, 'classroom deleted'));
    clientSockets.get(params.id)?.forEach(socket => socket.close(4404, 'classroom deleted'));
    classroomSockets.delete(params.id);
    clientSockets.delete(params.id);
    await audit(request.cloudSubject, request, 'classroom.delete', 'classroom', params.id, { name:removed.name });
    return reply.code(204).send();
  });

  app.put('/api/v1/admin/classrooms/:id/students', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({ students:z.array(z.object({ id:z.string().trim().max(128).optional(), name:z.string().trim().min(1).max(80) })).max(5000) }), request);
    const updated = await transaction(database, async client => {
      const classroom = await client.query("SELECT id FROM classrooms WHERE id=$1 AND organization_id=$2 AND status<>'archived' FOR UPDATE", [params.id, request.cloudSubject!.organizationId]);
      if (!classroom.rowCount) return null;
      const existing = await client.query('SELECT id FROM students WHERE classroom_id=$1', [params.id]);
      const existingIds = new Set(existing.rows.map(row => String(row.id)));
      const activeIds:string[] = [];
      for (const [index, student] of input.students.entries()) {
        const requestedId = String(student.id || '');
        const id = existingIds.has(requestedId) ? requestedId : randomUUID();
        activeIds.push(id);
        await client.query(`INSERT INTO students (id,classroom_id,name,sort_order,status) VALUES ($1,$2,$3,$4,'active') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now() WHERE students.classroom_id=$2`, [id, params.id, student.name, index]);
      }
      await client.query("UPDATE students SET status='removed',updated_at=now() WHERE classroom_id=$1 AND NOT (id=ANY($2::text[]))", [params.id, activeIds]);
      await client.query('UPDATE classrooms SET configured=$2,revision=revision+1,last_cloud_mutation_at=now(),updated_at=now() WHERE id=$1', [params.id, activeIds.length > 0]);
      return client.query("SELECT id,name,sort_order FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at", [params.id]);
    });
    if (!updated) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    await audit(request.cloudSubject, request, 'classroom.students.replace', 'classroom', params.id, { count:updated.rowCount });
    await pushClassroomRestore(params.id);
    await broadcastCloudSnapshot(params.id);
    return { students:updated.rows };
  });

  app.get('/api/v1/admin/classrooms/:id/snapshot', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const [classroom, students, assignments, submissions, members] = await Promise.all([
      database.query('SELECT id,name,status,configured,revision,updated_at,last_device_sync_at FROM classrooms WHERE id=$1 AND organization_id=$2', [params.id, request.cloudSubject!.organizationId]),
      database.query("SELECT id,name,sort_order FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at", [params.id]),
      database.query("SELECT id,subject,type,title,publish_at,deadline,source FROM assignments WHERE classroom_id=$1 AND status='active' ORDER BY deadline NULLS LAST,created_at", [params.id]),
      database.query('SELECT s.assignment_id,s.student_id,s.status,s.updated_at FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.classroom_id=$1', [params.id]),
      database.query('SELECT u.id,u.name,m.role,m.status,m.subjects_json,m.updated_at FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 ORDER BY m.created_at', [params.id]),
    ]);
    if (!classroom.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    return { classroom:classroom.rows[0], students:students.rows, assignments:assignments.rows, submissions:submissions.rows, members:members.rows };
  });

  app.delete('/api/v1/admin/classroom-devices/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const result = await database.query(`UPDATE classroom_devices d SET revoked_at=now(),status='offline' FROM classrooms c WHERE d.id=$1 AND d.classroom_id=c.id AND c.organization_id=$2 AND d.revoked_at IS NULL RETURNING d.id,d.classroom_id`, [params.id, request.cloudSubject!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error:'DEVICE_NOT_FOUND', message:'教室设备不存在或已撤销' });
    classroomSockets.forEach(sockets => sockets.forEach(socket => { if (classroomSocketDeviceIds.get(socket) === params.id) socket.close(4403, 'device revoked'); }));
    await audit(request.cloudSubject, request, 'classroom-device.revoke', 'classroom-device', params.id, { classroomId:result.rows[0].classroom_id });
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/users', { preHandler:requireAdmin }, async (request:AuthenticatedRequest) => {
    const result = await database.query(
      `SELECT id,name,login_name,wechat_openid,legacy_connection_id,server_role,status,must_change_password,created_at,updated_at
       FROM users u WHERE organization_id=$1 AND server_role='teacher'
       ORDER BY created_at DESC`, [request.cloudSubject!.organizationId],
    );
    return { users:result.rows };
  });

  app.get('/api/v1/admin/users/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const [teacher, memberships, devices] = await Promise.all([
      database.query("SELECT id,name,login_name,wechat_openid,legacy_connection_id,status,must_change_password,created_at,updated_at FROM users WHERE id=$1 AND organization_id=$2 AND server_role='teacher'", [params.id, request.cloudSubject!.organizationId]),
      database.query(`SELECT c.id AS classroom_id,c.name AS classroom_name,m.role,m.status,m.subjects_json FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id WHERE m.user_id=$1 AND c.organization_id=$2 AND c.status<>'archived' ORDER BY c.name`, [params.id, request.cloudSubject!.organizationId]),
      database.query('SELECT count(*)::int AS count,max(last_seen_at) AS last_seen_at FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL', [params.id]),
    ]);
    if (!teacher.rowCount) return reply.code(404).send({ error:'USER_NOT_FOUND', message:'教师不存在' });
    return { teacher:{ ...teacher.rows[0], device_count:devices.rows[0].count, last_seen_at:devices.rows[0].last_seen_at }, memberships:memberships.rows };
  });

  app.post('/api/v1/admin/users', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const input = parseBody(z.object({
      name:z.string().trim().min(1).max(40),
      loginName:z.string().trim().min(3).max(80),
      defaultPassword:z.string().min(8).max(200),
    }), request);
    const duplicate = await database.query("SELECT 1 FROM users WHERE organization_id=$1 AND login_name=$2 AND server_role='teacher'", [request.cloudSubject!.organizationId, input.loginName]);
    if (duplicate.rowCount) return reply.code(409).send({ error:'LOGIN_NAME_TAKEN', message:'该登录账号已被使用' });
    const passwordHash = await hashPassword(input.defaultPassword);
    const result = await database.query(
      `INSERT INTO users (organization_id,name,login_name,password_hash,must_change_password,server_role,status)
       VALUES ($1,$2,$3,$4,true,'teacher','active')
       RETURNING id,name,login_name,server_role,status,must_change_password,created_at`,
      [request.cloudSubject!.organizationId, input.name, input.loginName, passwordHash],
    );
    await audit(request.cloudSubject, request, 'teacher.create', 'user', result.rows[0].id);
    return reply.code(201).send(result.rows[0]);
  });

  app.patch('/api/v1/admin/users/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({ name:z.string().trim().min(1).max(40).optional(), status:z.enum(['active','disabled']).optional(), loginName:z.string().trim().min(3).max(80).optional(), defaultPassword:z.string().min(8).max(200).optional() }).refine(value => Object.values(value).some(item => item !== undefined), { message:'至少提供一个需要修改的字段' }), request);
    if (input.loginName) {
      const duplicate = await database.query("SELECT 1 FROM users WHERE organization_id=$1 AND login_name=$2 AND id<>$3", [request.cloudSubject!.organizationId, input.loginName, params.id]);
      if (duplicate.rowCount) return reply.code(409).send({ error:'LOGIN_NAME_TAKEN', message:'该登录账号已被使用' });
    }
    const passwordHash = input.defaultPassword ? await hashPassword(input.defaultPassword) : null;
    const result = await database.query(`UPDATE users SET name=COALESCE($3,name),status=COALESCE($4,status),login_name=COALESCE($5,login_name),password_hash=COALESCE($6,password_hash),must_change_password=CASE WHEN $6::text IS NOT NULL THEN true ELSE must_change_password END,updated_at=now() WHERE id=$1 AND organization_id=$2 AND server_role='teacher' RETURNING id,name,login_name,status,must_change_password`, [params.id, request.cloudSubject!.organizationId, input.name || null, input.status || null, input.loginName || null, passwordHash]);
    if (!result.rowCount) return reply.code(404).send({ error:'USER_NOT_FOUND', message:'教师不存在' });
    if (input.status === 'disabled' || input.defaultPassword) {
      await database.query("UPDATE refresh_tokens SET revoked_at=now() WHERE subject_type='user' AND subject_id=$1 AND revoked_at IS NULL", [params.id]);
      await database.query('UPDATE user_devices SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [params.id]);
      clientSockets.forEach(sockets => sockets.forEach(socket => { if (clientSubjects.get(socket)?.subjectId === params.id) socket.close(4403, input.status === 'disabled' ? 'account disabled' : 'password reset'); }));
    }
    await audit(request.cloudSubject, request, 'user.update', 'user', params.id, input);
    return result.rows[0];
  });

  app.delete('/api/v1/admin/users/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const removed = await transaction(database, async client => {
      const found = await client.query("SELECT id,name FROM users WHERE id=$1 AND organization_id=$2 AND server_role='teacher' FOR UPDATE", [params.id, request.cloudSubject!.organizationId]);
      if (!found.rowCount) return null;
      await client.query("DELETE FROM refresh_tokens WHERE subject_type='user' AND subject_id=$1", [params.id]);
      await client.query("DELETE FROM users WHERE id=$1 AND server_role='teacher'", [params.id]);
      return found.rows[0] as { id:string; name:string };
    });
    if (!removed) return reply.code(404).send({ error:'USER_NOT_FOUND', message:'教师不存在' });
    clientSockets.forEach(sockets => sockets.forEach(socket => { if (clientSubjects.get(socket)?.subjectId === params.id) socket.close(4404, 'teacher deleted'); }));
    await audit(request.cloudSubject, request, 'user.delete', 'user', params.id, { name:removed.name });
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/classrooms/:id/members', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const owned = await database.query('SELECT 1 FROM classrooms WHERE id=$1 AND organization_id=$2', [params.id, request.cloudSubject!.organizationId]);
    if (!owned.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    const result = await database.query(`SELECT m.user_id,u.name,u.status AS user_status,m.role,m.status,m.subjects_json,m.joined_at FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 ORDER BY m.created_at`, [params.id]);
    return { members:result.rows };
  });

  app.post('/api/v1/admin/classrooms/:id/members', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({ userId:z.string().uuid(), role:z.enum(['teacher','homeroom']).default('teacher'), subjects:z.array(z.string().trim().min(1).max(80)).min(1).max(30) }), request);
    const owned = await database.query('SELECT 1 FROM classrooms WHERE id=$1 AND organization_id=$2', [params.id, request.cloudSubject!.organizationId]);
    if (!owned.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    const teacher = await database.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND server_role='teacher' AND status='active'", [input.userId, request.cloudSubject!.organizationId]);
    if (!teacher.rowCount) return reply.code(404).send({ error:'TEACHER_NOT_FOUND', message:'教师账号不存在' });
    const result = await transaction(database, async client => {
      if (input.role === 'homeroom') await client.query("UPDATE classroom_members SET role='teacher',updated_at=now() WHERE classroom_id=$1 AND role='homeroom' AND status='approved' AND user_id<>$2", [params.id, input.userId]);
      return client.query(
        `INSERT INTO classroom_members (classroom_id,user_id,role,status,subjects_json,joined_at)
         VALUES ($1,$2,$3,'approved',$4,now())
         ON CONFLICT (classroom_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='approved',subjects_json=EXCLUDED.subjects_json,joined_at=COALESCE(classroom_members.joined_at,now()),updated_at=now() RETURNING *`,
        [params.id, input.userId, input.role, JSON.stringify(input.subjects)],
      );
    });
    await audit(request.cloudSubject, request, 'classroom.member.add', 'user', input.userId, { classroomId:params.id, role:input.role });
    await pushMembershipToClassroom(params.id, input.userId, 'upsert');
    return reply.code(201).send(result.rows[0]);
  });

  app.patch('/api/v1/admin/classrooms/:classroomId/members/:userId', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ classroomId:z.string().uuid(), userId:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({ role:z.enum(['teacher','homeroom']).optional(), status:z.enum(['pending','approved','rejected']).optional(), subjects:z.array(z.string().trim().min(1).max(80)).max(30).optional() }), request);
    const owned = await database.query('SELECT 1 FROM classrooms WHERE id=$1 AND organization_id=$2', [params.classroomId, request.cloudSubject!.organizationId]);
    if (!owned.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    const result = input.role === 'homeroom'
      ? await transaction(database, async client => {
        await client.query("UPDATE classroom_members SET role='teacher',updated_at=now() WHERE classroom_id=$1 AND role='homeroom' AND status='approved' AND user_id<>$2", [params.classroomId, params.userId]);
        return client.query(`UPDATE classroom_members SET role='homeroom',status='approved',subjects_json=COALESCE($3,subjects_json),joined_at=COALESCE(joined_at,now()),updated_at=now() WHERE classroom_id=$1 AND user_id=$2 RETURNING *`, [params.classroomId, params.userId, input.subjects ? JSON.stringify(input.subjects) : null]);
      })
      : await database.query(`UPDATE classroom_members SET role=COALESCE($3,role),status=COALESCE($4,status),subjects_json=COALESCE($5,subjects_json),joined_at=CASE WHEN $4='approved' THEN COALESCE(joined_at,now()) ELSE joined_at END,updated_at=now() WHERE classroom_id=$1 AND user_id=$2 RETURNING *`, [params.classroomId, params.userId, input.role || null, input.status || null, input.subjects ? JSON.stringify(input.subjects) : null]);
    if (!result.rowCount) return reply.code(404).send({ error:'MEMBER_NOT_FOUND', message:'教师成员不存在' });
    await pushMembershipToClassroom(params.classroomId, params.userId, 'upsert');
    if (input.status && input.status !== 'approved') clientSockets.get(params.classroomId)?.forEach(socket => { if (clientSubjects.get(socket)?.subjectId === params.userId) socket.close(4403, 'membership revoked'); });
    await audit(request.cloudSubject, request, 'classroom.member.update', 'user', params.userId, { classroomId:params.classroomId, ...input });
    return result.rows[0];
  });

  app.delete('/api/v1/admin/classrooms/:classroomId/members/:userId', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ classroomId:z.string().uuid(), userId:z.string().uuid() }).parse(request.params);
    const result = await database.query(`DELETE FROM classroom_members m USING classrooms c WHERE m.classroom_id=c.id AND m.classroom_id=$1 AND m.user_id=$2 AND c.organization_id=$3 RETURNING m.id`, [params.classroomId, params.userId, request.cloudSubject!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error:'MEMBER_NOT_FOUND', message:'教师成员不存在' });
    await pushMembershipToClassroom(params.classroomId, params.userId, 'remove');
    clientSockets.get(params.classroomId)?.forEach(socket => { if (clientSubjects.get(socket)?.subjectId === params.userId) socket.close(4403, 'membership removed'); });
    await audit(request.cloudSubject, request, 'classroom.member.remove', 'user', params.userId, { classroomId:params.classroomId });
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/enrollment-keys', { preHandler:requireAdmin }, async (request:AuthenticatedRequest) => {
    const result = await database.query(
      `SELECT k.id,k.key_type,k.target_classroom_id,k.target_user_id,k.expires_at,k.max_uses,k.used_count,k.revoked_at,k.created_at,
              COALESCE(c.name,u.name) AS target_name
       FROM enrollment_keys k LEFT JOIN classrooms c ON c.id=k.target_classroom_id LEFT JOIN users u ON u.id=k.target_user_id
       WHERE k.organization_id=$1 ORDER BY k.created_at DESC LIMIT 200`, [request.cloudSubject!.organizationId],
    );
    return { keys:result.rows };
  });

  app.get('/api/v1/admin/enrollment-targets', { preHandler:requireAdmin }, async (request:AuthenticatedRequest) => {
    const org = request.cloudSubject!.organizationId;
    const [classrooms, teachers] = await Promise.all([
      database.query(`SELECT c.id,c.name,c.status,c.created_at,EXISTS (
        SELECT 1 FROM classroom_devices d WHERE d.classroom_id=c.id AND d.last_seen_at IS NOT NULL
      ) AS connected FROM classrooms c WHERE c.organization_id=$1 AND c.status<>'archived' ORDER BY c.created_at DESC`, [org]),
      database.query(`SELECT u.id,u.name,u.status,u.created_at,EXISTS (
        SELECT 1 FROM user_devices d WHERE d.user_id=u.id AND d.last_seen_at IS NOT NULL
      ) AS connected FROM users u WHERE u.organization_id=$1 AND u.server_role='teacher' ORDER BY u.created_at DESC`, [org]),
    ]);
    return { classrooms:classrooms.rows, teachers:teachers.rows };
  });

  app.post('/api/v1/admin/enrollment-keys', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const input = parseBody(z.object({
      keyType:z.enum(['classroom','teacher']),
      targetClassroomId:z.string().uuid().nullable().optional(),
      targetUserId:z.string().uuid().nullable().optional(),
      expiresInHours:z.number().int().min(1).max(24 * 30).default(24),
      maxUses:z.number().int().min(1).max(100).default(1),
    }), request);
    if (input.keyType === 'classroom' && !input.targetClassroomId) return reply.code(400).send({ error:'CLASSROOM_REQUIRED', message:'教室端密钥必须分配给一个教室' });
    if (input.keyType === 'teacher' && !input.targetUserId) return reply.code(400).send({ error:'TEACHER_REQUIRED', message:'教师端密钥必须分配给一个教师账号' });
    const targetClassroomId = input.keyType === 'teacher' ? null : input.targetClassroomId || null;
    const targetUserId = input.keyType === 'teacher' ? input.targetUserId || null : null;
    if (targetClassroomId) {
      const target = await database.query("SELECT 1 FROM classrooms WHERE id=$1 AND organization_id=$2 AND status='active'", [input.targetClassroomId, request.cloudSubject!.organizationId]);
      if (!target.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'目标教室不存在' });
    }
    if (targetUserId) {
      const target = await database.query("SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND server_role='teacher' AND status='active'", [targetUserId, request.cloudSubject!.organizationId]);
      if (!target.rowCount) return reply.code(404).send({ error:'TEACHER_NOT_FOUND', message:'目标教师账号不存在' });
    }
    await database.query(
      `UPDATE enrollment_keys SET revoked_at=now()
       WHERE organization_id=$1 AND key_type=$2
         AND target_classroom_id IS NOT DISTINCT FROM $3
         AND target_user_id IS NOT DISTINCT FROM $4
         AND revoked_at IS NULL`,
      [request.cloudSubject!.organizationId, input.keyType, targetClassroomId, targetUserId],
    );
    const prefix = input.keyType === 'classroom' ? 'ck' : 'tk';
    const plainKey = generateOpaqueToken(prefix);
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3600000);
    const result = await database.query(
      `INSERT INTO enrollment_keys (organization_id,key_type,key_hash,target_classroom_id,target_user_id,role,subjects_json,expires_at,max_uses,created_by)
       VALUES ($1,$2,$3,$4,$5,NULL,'[]'::jsonb,$6,$7,$8) RETURNING id,key_type,target_classroom_id,target_user_id,expires_at,max_uses,used_count,created_at`,
      [request.cloudSubject!.organizationId, input.keyType, hashOpaqueToken(plainKey, config.KEY_PEPPER), targetClassroomId, targetUserId, expiresAt, input.maxUses, request.cloudSubject!.subjectId],
    );
    await audit(request.cloudSubject, request, 'enrollment-key.create', 'enrollment-key', result.rows[0].id, { keyType:input.keyType, targetClassroomId, targetUserId });
    return reply.code(201).send({ ...result.rows[0], key:plainKey });
  });

  app.delete('/api/v1/admin/enrollment-keys/:id', { preHandler:requireAdmin }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const result = await database.query('UPDATE enrollment_keys SET revoked_at=now() WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL RETURNING id', [params.id, request.cloudSubject!.organizationId]);
    if (!result.rowCount) return reply.code(404).send({ error:'KEY_NOT_FOUND', message:'连接密钥不存在或已撤销' });
    await audit(request.cloudSubject, request, 'enrollment-key.revoke', 'enrollment-key', params.id);
    return reply.code(204).send();
  });

  app.post('/api/v1/enrollment/classroom/redeem', async (request, reply) => {
    if (!clientAllowed(request, 'classroom-desktop')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'该密钥只能由教室端使用' });
    const input = parseBody(z.object({ key:z.string().startsWith('ck_'), deviceName:z.string().trim().min(1).max(120), appVersion:z.string().trim().max(40).optional() }), request);
    const keyHash = hashOpaqueToken(input.key, config.KEY_PEPPER);
    const result = await transaction(database, async client => {
      const keyResult = await client.query(
        `SELECT * FROM enrollment_keys WHERE key_hash=$1 AND key_type='classroom' AND revoked_at IS NULL AND expires_at>now() AND used_count<max_uses FOR UPDATE`, [keyHash],
      );
      const enrollment = keyResult.rows[0];
      if (!enrollment) return null;
      const rawDeviceToken = generateOpaqueToken('cd');
      const device = await client.query(
        `INSERT INTO classroom_devices (classroom_id,device_name,device_token_hash,app_version,client_type,last_seen_at)
         VALUES ($1,$2,$3,$4,'classroom-desktop',now()) RETURNING id,classroom_id,device_name`,
        [enrollment.target_classroom_id, input.deviceName, hashOpaqueToken(rawDeviceToken, config.KEY_PEPPER), input.appVersion || null],
      );
      await client.query('UPDATE enrollment_keys SET used_count=used_count+1 WHERE id=$1', [enrollment.id]);
      return { ...device.rows[0], deviceToken:rawDeviceToken, organizationId:enrollment.organization_id };
    });
    if (!result) return reply.code(401).send({ error:'ENROLLMENT_KEY_INVALID', message:'教室接入密钥无效、已过期或已使用' });
    await audit({ subjectType:'classroom-device', subjectId:result.id, organizationId:result.organizationId, role:'classroom-device' }, request, 'classroom-device.enroll', 'classroom', result.classroom_id);
    return reply.code(201).send({ serverUrl:config.PUBLIC_URL, deviceId:result.id, classroomId:result.classroom_id, deviceToken:result.deviceToken });
  });

  app.post('/api/v1/classroom-device/revoke', async (request, reply) => {
    if (!clientAllowed(request, 'classroom-desktop')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'该操作只能由教室端执行' });
    const input = parseBody(z.object({ deviceToken:z.string().startsWith('cd_') }), request);
    const result = await database.query("UPDATE classroom_devices SET revoked_at=now(),status='offline' WHERE device_token_hash=$1 AND revoked_at IS NULL RETURNING id,classroom_id", [hashOpaqueToken(input.deviceToken, config.KEY_PEPPER)]);
    if (!result.rowCount) return reply.code(404).send({ error:'DEVICE_NOT_FOUND', message:'教室设备凭证已经失效' });
    classroomSockets.forEach(sockets => sockets.forEach(socket => { if (classroomSocketDeviceIds.get(socket) === result.rows[0].id) socket.close(4403, 'device revoked'); }));
    return reply.code(204).send();
  });

  app.post('/api/v1/enrollment/teacher/redeem', async (request, reply) => {
    const input = parseBody(z.object({ key:z.string().startsWith('tk_'), name:z.string().trim().min(1).max(40), legacyConnectionId:z.string().trim().max(128).optional(), deviceName:z.string().trim().min(1).max(120), deviceType:z.enum(['teacher-desktop','mini-program']) }), request);
    if (declaredClient(request) !== input.deviceType) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'客户端身份与设备类型不一致' });
    const result = await transaction(database, async client => {
      const keyResult = await client.query(
        `SELECT e.*,u.id AS user_id,u.name AS user_name,u.organization_id AS user_organization_id,u.legacy_connection_id,u.server_role,u.status AS user_status
         FROM enrollment_keys e JOIN users u ON u.id=e.target_user_id AND u.organization_id=e.organization_id
         WHERE e.key_hash=$1 AND e.key_type='teacher' AND e.revoked_at IS NULL AND e.expires_at>now() AND e.used_count<e.max_uses
         FOR UPDATE OF e,u`,
        [hashOpaqueToken(input.key, config.KEY_PEPPER)],
      );
      const enrollment = keyResult.rows[0];
      if (!enrollment || enrollment.user_status !== 'active' || enrollment.server_role !== 'teacher') return null;
      const localIdentity = input.legacyConnectionId || null;
      if (enrollment.legacy_connection_id && localIdentity && enrollment.legacy_connection_id !== localIdentity) {
        throw Object.assign(new Error('该教师密钥已经分配给另一个本地教师身份'), { statusCode:409 });
      }
      if (localIdentity) {
        const duplicate = await client.query('SELECT 1 FROM users WHERE organization_id=$1 AND legacy_connection_id=$2 AND id<>$3 LIMIT 1', [enrollment.user_organization_id, localIdentity, enrollment.user_id]);
        if (duplicate.rowCount) throw Object.assign(new Error('当前本地教师身份已经绑定其他云账号'), { statusCode:409 });
        await client.query('UPDATE users SET legacy_connection_id=COALESCE(legacy_connection_id,$2),updated_at=now() WHERE id=$1', [enrollment.user_id, localIdentity]);
      }
      const device = await client.query(
        `INSERT INTO user_devices (user_id,device_name,device_type,last_seen_at) VALUES ($1,$2,$3,now()) RETURNING id`,
        [enrollment.user_id, input.deviceName, input.deviceType],
      );
      await client.query('UPDATE enrollment_keys SET used_count=used_count+1 WHERE id=$1', [enrollment.id]);
      return { user:{ id:enrollment.user_id, name:enrollment.user_name, organization_id:enrollment.user_organization_id, server_role:enrollment.server_role }, deviceId:device.rows[0].id };
    });
    if (!result) return reply.code(401).send({ error:'ENROLLMENT_KEY_INVALID', message:'教师邀请密钥无效、已过期或已使用' });
    const subject:AccessSubject = { subjectType:'user', subjectId:result.user.id, organizationId:result.user.organization_id, role:result.user.server_role };
    const session = await createSession(database, subject, result.deviceId, config);
    await audit(subject, request, 'teacher.enroll', 'user', result.user.id);
    return reply.code(201).send({ user:{ id:result.user.id, name:result.user.name, role:result.user.server_role }, ...session });
  });

  app.post('/api/v1/auth/mini-program/register', async (request, reply) => {
    if (!clientAllowed(request, 'mini-program')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'该接口只能由小程序使用' });
    return reply.code(410).send({ error:'REGISTRATION_DISABLED', message:'组织账号由管理员统一创建，请使用组织发放的账号和默认密码登录' });
  });

  app.post('/api/v1/auth/mini-program/login', async (request, reply) => {
    if (!clientAllowed(request, 'mini-program', 'teacher-desktop')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'该接口只能由受支持的教师客户端使用' });
    const input = parseBody(z.object({ loginName:z.string().trim().min(3).max(80), password:z.string().min(1).max(200), deviceName:z.string().trim().min(1).max(120).default('微信小程序') }), request);
    if (!consumeLoginAttempt(request.ip + ':' + input.loginName.toLowerCase())) return reply.code(429).send({ error:'TOO_MANY_ATTEMPTS', message:'登录尝试过多，请 15 分钟后再试' });
    const found = await database.query("SELECT id,organization_id,name,nickname,avatar_url,password_hash,status,must_change_password FROM users WHERE login_name=$1 AND server_role='teacher' AND status='active' ORDER BY created_at LIMIT 1", [input.loginName]);
    const user = found.rows[0];
    if (!user || !user.password_hash || !(await verifyPassword(input.password, user.password_hash))) return reply.code(401).send({ error:'LOGIN_FAILED', message:'账号或密码错误' });
    await database.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    const deviceType = declaredClient(request) === 'teacher-desktop' ? 'teacher-desktop' : 'mini-program';
    const session = await createTeacherSession(user.id, input.deviceName, deviceType);
    return { user:{ id:user.id, name:user.name, nickname:user.nickname, avatarUrl:user.avatar_url, mustChangePassword:user.must_change_password }, organization:await organizationFor(user.organization_id), ...session };
  });

  app.patch('/api/v1/teacher/profile', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    if (request.cloudSubject?.role !== 'teacher') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const input = parseBody(z.object({
      name:z.string().trim().min(1).max(40).optional(),
      nickname:z.string().trim().min(1).max(40).optional(),
      currentPassword:z.string().min(1).max(200).optional(),
      newPassword:z.string().min(10).max(200).optional(),
    }), request);
    if (!input.name && !input.nickname && !input.newPassword) return reply.code(400).send({ error:'PROFILE_UPDATE_EMPTY', message:'没有需要保存的个人资料' });
    const current = await database.query("SELECT id,name,nickname,password_hash,must_change_password FROM users WHERE id=$1 AND server_role='teacher' AND status='active'", [request.cloudSubject.subjectId]);
    if (!current.rowCount) return reply.code(404).send({ error:'USER_NOT_FOUND', message:'教师账号不存在' });
    const existing = current.rows[0];
    if (existing.must_change_password && (!input.name || !input.nickname || !input.newPassword)) {
      return reply.code(400).send({ error:'PROFILE_SETUP_INCOMPLETE', message:'首次登录必须完善用户名并修改默认密码' });
    }
    if (input.newPassword && !existing.must_change_password) {
      if (!input.currentPassword || !existing.password_hash || !(await verifyPassword(input.currentPassword, existing.password_hash))) {
        return reply.code(401).send({ error:'CURRENT_PASSWORD_INVALID', message:'当前密码不正确' });
      }
    }
    if (input.newPassword && existing.password_hash && await verifyPassword(input.newPassword, existing.password_hash)) {
      return reply.code(400).send({ error:'PASSWORD_UNCHANGED', message:'新密码不能与当前密码相同' });
    }
    const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;
    const result = await database.query(
      `UPDATE users SET name=COALESCE($2,name),nickname=COALESCE($3,nickname),password_hash=COALESCE($4,password_hash),must_change_password=CASE WHEN $4::text IS NOT NULL THEN false ELSE must_change_password END,updated_at=now()
       WHERE id=$1 AND server_role='teacher' AND status='active'
       RETURNING id,organization_id,name,nickname,avatar_url,must_change_password`,
      [request.cloudSubject.subjectId, input.name || null, input.nickname || null, passwordHash],
    );
    const user = result.rows[0];
    await audit(request.cloudSubject, request, input.newPassword ? 'teacher.profile.password' : 'teacher.profile.update', 'user', user.id);
    return { user:{ id:user.id, name:user.name, nickname:user.nickname, avatarUrl:user.avatar_url, mustChangePassword:user.must_change_password }, organization:await organizationFor(user.organization_id) };
  });

  app.get('/api/v1/teacher/profile', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    if (request.cloudSubject?.role !== 'teacher') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const found = await database.query('SELECT id,organization_id,name,nickname,avatar_url,must_change_password FROM users WHERE id=$1 AND status=\'active\'', [request.cloudSubject.subjectId]);
    if (!found.rowCount) return reply.code(404).send({ error:'USER_NOT_FOUND', message:'教师账号不存在' });
    const user = found.rows[0];
    return { user:{ id:user.id, name:user.name, nickname:user.nickname, avatarUrl:user.avatar_url, mustChangePassword:user.must_change_password }, organization:await organizationFor(user.organization_id) };
  });

  app.post('/api/v1/auth/mini-program/wechat', async (request, reply) => {
    if (!clientAllowed(request, 'mini-program')) return reply.code(403).send({ error:'CLIENT_IDENTITY_MISMATCH', message:'该接口只能由小程序使用' });
    return reply.code(410).send({ error:'WECHAT_LOGIN_DISABLED', message:'组织模式仅支持组织发放的账号密码登录' });
  });

  app.post('/api/v1/teacher/avatar', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    if (request.cloudSubject?.subjectType !== 'user' || request.cloudSubject.role !== 'teacher') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const contentType = String(request.headers['content-type'] || '');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) return reply.code(415).send({ error:'UNSUPPORTED_MEDIA_TYPE', message:'头像仅支持 PNG、JPEG 或 WebP 图片' });
    const buffer = request.body as Buffer;
    if (!buffer || buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return reply.code(413).send({ error:'AVATAR_TOO_LARGE', message:'头像文件大小不能超过 5MB' });
    const filename = saveAvatar(buffer, contentType);
    const url = new URL('/uploads/avatars/' + filename, config.PUBLIC_URL).toString();
    await database.query('UPDATE users SET avatar_url=$2,updated_at=now() WHERE id=$1', [request.cloudSubject.subjectId, url]);
    return { url };
  });

  app.get('/api/v1/classrooms', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    if (request.cloudSubject?.subjectType !== 'user') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const result = await database.query(
      `SELECT c.id,c.name,c.status,c.configured,c.revision,m.role,m.status AS membership_status,m.subjects_json,CASE WHEN d.status='online' AND d.last_seen_at>now()-interval '60 seconds' THEN 'online' ELSE 'offline' END AS device_status,d.lan_connection_code,d.lan_status_updated_at
       FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id
       LEFT JOIN LATERAL (SELECT status,last_seen_at,lan_connection_code,lan_status_updated_at FROM classroom_devices WHERE classroom_id=c.id AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1) d ON true
       WHERE m.user_id=$1 AND m.status='approved' AND c.status='active' ORDER BY c.name`, [request.cloudSubject.subjectId],
    );
    return { classrooms:result.rows };
  });

  app.get('/api/v1/classrooms/:id/snapshot', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    if (request.cloudSubject?.subjectType !== 'user') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const membership = await database.query('SELECT role,status,subjects_json FROM classroom_members WHERE classroom_id=$1 AND user_id=$2', [params.id, request.cloudSubject.subjectId]);
    if (!membership.rowCount || membership.rows[0].status !== 'approved') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'尚未加入该教室' });
    const [classroom, students, assignments, submissions, members] = await Promise.all([
      database.query('SELECT id,name,configured,revision FROM classrooms WHERE id=$1 AND status=\'active\'', [params.id]),
      database.query('SELECT id,name,sort_order,status FROM students WHERE classroom_id=$1 AND status=\'active\' ORDER BY sort_order,created_at', [params.id]),
      database.query('SELECT * FROM assignments WHERE classroom_id=$1 AND status=\'active\' ORDER BY deadline NULLS LAST,created_at', [params.id]),
      database.query(`SELECT s.* FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.classroom_id=$1`, [params.id]),
      database.query(`SELECT m.user_id,u.name,m.role,m.status,m.subjects_json FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 ORDER BY m.created_at`, [params.id]),
    ]);
    if (!classroom.rowCount) return reply.code(404).send({ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' });
    const member = membership.rows[0];
    const isHomeroom = member.role === 'homeroom';
    const allowedSubjects = new Set(Array.isArray(member.subjects_json) ? member.subjects_json.map(String) : []);
    const visibleAssignments = isHomeroom ? assignments.rows : assignments.rows.filter(item => allowedSubjects.has(String(item.subject || '')));
    const visibleAssignmentIds = new Set(visibleAssignments.map(item => String(item.id)));
    return {
      classroom:classroom.rows[0],
      teacher:member,
      students:students.rows,
      assignments:visibleAssignments,
      submissions:submissions.rows.filter(item => visibleAssignmentIds.has(String(item.assignment_id))),
      members:isHomeroom ? members.rows : [],
    };
  });

  app.get('/api/v1/classrooms/:id/changes', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const query = z.object({ since:z.coerce.number().int().min(0).default(0), limit:z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    if (request.cloudSubject?.subjectType !== 'user') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const member = await database.query("SELECT role,subjects_json FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 AND status='approved'", [params.id, request.cloudSubject.subjectId]);
    if (!member.rowCount) return reply.code(403).send({ error:'PERMISSION_DENIED', message:'尚未加入该教室' });
    const [classroom, events] = await Promise.all([
      database.query('SELECT revision FROM classrooms WHERE id=$1', [params.id]),
      database.query('SELECT revision,operation_id,event_type,payload_json,created_at FROM operation_events WHERE classroom_id=$1 AND revision>$2 ORDER BY revision LIMIT $3', [params.id, query.since, query.limit]),
    ]);
    if (member.rows[0].role === 'homeroom') return { revision:Number(classroom.rows[0]?.revision || 0), events:events.rows };
    const allowedSubjects = new Set(Array.isArray(member.rows[0].subjects_json) ? member.rows[0].subjects_json.map(String) : []);
    const assignmentIds = events.rows
      .map(event => String(event.payload_json?.id || event.payload_json?.assignmentId || ''))
      .filter(Boolean);
    const assignmentSubjects = new Map<string,string>();
    if (assignmentIds.length) {
      const rows = await database.query('SELECT id,subject FROM assignments WHERE classroom_id=$1 AND id=ANY($2::text[])', [params.id, assignmentIds]);
      rows.rows.forEach(row => assignmentSubjects.set(String(row.id), String(row.subject || '')));
    }
    const visibleEvents = events.rows.filter(event => {
      if (!String(event.event_type || '').startsWith('assignment.') && event.event_type !== 'submission.update') return true;
      const payload = event.payload_json || {};
      const subjectName = String(payload.subject || assignmentSubjects.get(String(payload.id || payload.assignmentId || '')) || '');
      return allowedSubjects.has(subjectName);
    });
    return { revision:Number(classroom.rows[0]?.revision || 0), events:visibleEvents };
  });

  app.delete('/api/v1/classrooms/:id/membership', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    if (request.cloudSubject?.subjectType !== 'user') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const result = await database.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 RETURNING role', [params.id, request.cloudSubject.subjectId]);
    if (!result.rowCount) return reply.code(404).send({ error:'MEMBERSHIP_NOT_FOUND', message:'你已不在该教室中' });
    await pushMembershipToClassroom(params.id, request.cloudSubject!.subjectId, 'remove');
    await audit(request.cloudSubject, request, 'classroom.leave', 'classroom', params.id, { role:result.rows[0].role });
    return reply.code(204).send();
  });

  app.post('/api/v1/classrooms/:id/operations', { preHandler:authenticate }, async (request:AuthenticatedRequest, reply) => {
    const params = z.object({ id:z.string().uuid() }).parse(request.params);
    const input = parseBody(z.object({
      operationId:z.string().uuid(),
      baseRevision:z.number().int().min(0),
      type:z.enum(['classroom.update','student.upsert','student.delete','assignment.upsert','assignment.delete','submission.update']),
      payload:z.record(z.string(), z.unknown()),
    }), request);
    if (request.cloudSubject?.subjectType !== 'user') return reply.code(403).send({ error:'PERMISSION_DENIED', message:'教师账号权限不足' });
    const subject = request.cloudSubject;
    const outcome = await transaction(database, async client => {
      const classroomResult = await client.query('SELECT id,revision FROM classrooms WHERE id=$1 AND organization_id=$2 AND status=\'active\' FOR UPDATE', [params.id, subject.organizationId]);
      if (!classroomResult.rowCount) return { status:404, body:{ error:'CLASSROOM_NOT_FOUND', message:'教室不存在' } };
      const duplicate = await client.query('SELECT revision,event_type,payload_json FROM operation_events WHERE classroom_id=$1 AND operation_id=$2', [params.id, input.operationId]);
      if (duplicate.rowCount) return { status:200, body:{ replayed:true, revision:Number(duplicate.rows[0].revision), event:duplicate.rows[0] } };
      const revision = Number(classroomResult.rows[0].revision);
      if (revision !== input.baseRevision) return { status:409, body:{ error:'REVISION_CONFLICT', message:'教室数据已更新，请同步后重试', revision } };
      const memberResult = await client.query("SELECT role,status,subjects_json FROM classroom_members WHERE classroom_id=$1 AND user_id=$2", [params.id, subject.subjectId]);
      const member = memberResult.rows[0];
      if (!member || member.status !== 'approved') return { status:403, body:{ error:'PERMISSION_DENIED', message:'尚未加入该教室' } };
      const isHomeroom = member.role === 'homeroom';
      const subjects = Array.isArray(member.subjects_json) ? member.subjects_json.map(String) : [];
      const payload = input.payload;
      let eventPayload:Record<string, unknown> = {};

      if (!isHomeroom) return { status:403, body:{ error:'PERMISSION_DENIED', message:'普通授课教师仅可查看本人授课科目的作业与出勤情况' } };

      if (input.type === 'classroom.update') {
        if (!isHomeroom) return { status:403, body:{ error:'PERMISSION_DENIED', message:'仅班主任可修改教室资料' } };
        const name = String(payload.name || '').trim().slice(0, 120);
        const configured = payload.configured === true;
        if (!name) return { status:400, body:{ error:'INVALID_REQUEST', message:'班级名称不能为空' } };
        await client.query('UPDATE classrooms SET name=$2,configured=$3,updated_at=now() WHERE id=$1', [params.id, name, configured]);
        eventPayload = { name, configured };
      } else if (input.type === 'student.upsert') {
        if (!isHomeroom) return { status:403, body:{ error:'PERMISSION_DENIED', message:'仅班主任可修改学生名单' } };
        const studentId = payload.id ? String(payload.id) : randomUUID();
        const name = String(payload.name || '').trim().slice(0, 80);
        const sortOrder = Number.isInteger(payload.sortOrder) ? Number(payload.sortOrder) : 0;
        if (!name) return { status:400, body:{ error:'INVALID_REQUEST', message:'学生姓名不能为空' } };
        await client.query(`INSERT INTO students (id,classroom_id,name,sort_order,status) VALUES ($1,$2,$3,$4,'active') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,status='active',updated_at=now() WHERE students.classroom_id=$2`, [studentId, params.id, name, sortOrder]);
        eventPayload = { id:studentId, name, sortOrder };
      } else if (input.type === 'student.delete') {
        if (!isHomeroom) return { status:403, body:{ error:'PERMISSION_DENIED', message:'仅班主任可修改学生名单' } };
        const studentId = String(payload.id || '');
        await client.query("UPDATE students SET status='removed',updated_at=now() WHERE id=$1 AND classroom_id=$2", [studentId, params.id]);
        eventPayload = { id:studentId };
      } else if (input.type === 'assignment.upsert') {
        const assignmentId = payload.id ? String(payload.id) : randomUUID();
        const subjectName = String(payload.subject || '').trim().slice(0, 80);
        if (!subjectName || (!isHomeroom && !subjects.includes(subjectName))) return { status:403, body:{ error:'SUBJECT_PERMISSION_DENIED', message:'只能修改已授权学科的作业或通知' } };
        const title = String(payload.title || '').trim().slice(0, 1000);
        const assignmentType = payload.assignmentType === 'notice' ? 'notice' : 'homework';
        if (!title) return { status:400, body:{ error:'INVALID_REQUEST', message:'内容不能为空' } };
        const existing = await client.query('SELECT creator_user_id,subject FROM assignments WHERE id=$1 AND classroom_id=$2', [assignmentId, params.id]);
        if (existing.rowCount && !isHomeroom && (existing.rows[0].creator_user_id !== subject.subjectId || existing.rows[0].subject !== subjectName)) return { status:403, body:{ error:'PERMISSION_DENIED', message:'只能修改自己发布的对应学科内容' } };
        const deadline = payload.deadline ? new Date(String(payload.deadline)) : null;
        if (deadline && Number.isNaN(deadline.getTime())) return { status:400, body:{ error:'INVALID_REQUEST', message:'截止时间无效' } };
        await client.query(`INSERT INTO assignments (id,classroom_id,creator_user_id,subject,type,title,deadline,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'active') ON CONFLICT (id) DO UPDATE SET subject=EXCLUDED.subject,type=EXCLUDED.type,title=EXCLUDED.title,deadline=EXCLUDED.deadline,updated_at=now() WHERE assignments.classroom_id=$2`, [assignmentId, params.id, subject.subjectId, subjectName, assignmentType, title, deadline]);
        eventPayload = { id:assignmentId, subject:subjectName, assignmentType, title, deadline:deadline?.toISOString() || null };
      } else if (input.type === 'assignment.delete') {
        const assignmentId = String(payload.id || '');
        const existing = await client.query('SELECT creator_user_id,subject FROM assignments WHERE id=$1 AND classroom_id=$2', [assignmentId, params.id]);
        if (!existing.rowCount) return { status:404, body:{ error:'ASSIGNMENT_NOT_FOUND', message:'作业或通知不存在' } };
        if (!isHomeroom && (existing.rows[0].creator_user_id !== subject.subjectId || !subjects.includes(existing.rows[0].subject))) return { status:403, body:{ error:'PERMISSION_DENIED', message:'只能删除自己发布的对应学科内容' } };
        await client.query("UPDATE assignments SET status='deleted',updated_at=now() WHERE id=$1", [assignmentId]);
        eventPayload = { id:assignmentId };
      } else {
        const assignmentId = String(payload.assignmentId || '');
        const studentId = String(payload.studentId || '');
        const status = z.enum(['未提交','已提交','请假','免交']).safeParse(payload.status);
        const assignment = await client.query("SELECT subject FROM assignments WHERE id=$1 AND classroom_id=$2 AND status='active'", [assignmentId, params.id]);
        if (!assignment.rowCount || !status.success) return { status:400, body:{ error:'INVALID_REQUEST', message:'提交状态或作业无效' } };
        if (!isHomeroom && !subjects.includes(assignment.rows[0].subject)) return { status:403, body:{ error:'SUBJECT_PERMISSION_DENIED', message:'只能统计已授权学科的作业' } };
        await client.query(`INSERT INTO submissions (assignment_id,student_id,status,updated_by) SELECT $1,s.id,$3,$4 FROM students s WHERE s.id=$2 AND s.classroom_id=$5 ON CONFLICT (assignment_id,student_id) DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now()`, [assignmentId, studentId, status.data, subject.subjectId, params.id]);
        eventPayload = { assignmentId, studentId, status:status.data };
      }

      const nextRevision = revision + 1;
      await client.query('UPDATE classrooms SET revision=$2,last_cloud_mutation_at=now(),updated_at=now() WHERE id=$1', [params.id, nextRevision]);
      await client.query('INSERT INTO operation_events (classroom_id,revision,operation_id,event_type,payload_json) VALUES ($1,$2,$3,$4,$5)', [params.id, nextRevision, input.operationId, input.type, JSON.stringify(eventPayload)]);
      return { status:200, body:{ replayed:false, revision:nextRevision, event:{ type:input.type, payload:eventPayload } } };
    });
    if (outcome.status >= 400) return reply.code(outcome.status).send(outcome.body);
    await audit(subject, request, `operation.${input.type}`, 'classroom', params.id, { operationId:input.operationId, revision:outcome.body.revision });
    return outcome.body;
  });

  const socketAdd = (map:Map<string, Set<WebSocket>>, key:string, socket:WebSocket) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(socket);
  };
  const socketRemove = (map:Map<string, Set<WebSocket>>, key:string, socket:WebSocket) => {
    map.get(key)?.delete(socket);
    if (!map.get(key)?.size) map.delete(key);
  };
  const broadcastCloudSnapshot = async (classroomId:string) => {
    const clients = Array.from(clientSockets.get(classroomId) || []);
    await Promise.all(clients.map(async client => {
      const clientSubject = clientSubjects.get(client);
      if (!clientSubject || client.readyState !== 1) return;
      const snapshot = await legacySyncSnapshot(classroomId, clientSubject.subjectId);
      if (snapshot) client.send(JSON.stringify(snapshot));
    }));
  };

  app.get('/ws/v1/classroom', { websocket:true }, (socket, request) => {
    const query = z.object({ client:z.literal('classroom-desktop'), protocol:z.literal('1') }).safeParse(request.query);
    if (!query.success) { socket.close(4403, 'client identity invalid'); return; }
    let classroomId = '';
    let deviceId = '';
    const authTimer = setTimeout(() => { if (!deviceId) socket.close(4401, 'device authentication timeout'); }, 10000);
    authTimer.unref();
    socket.onmessage = event => {
      let message:Record<string, unknown>;
      const raw = String(event.data);
      if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) { socket.close(4400, 'message too large'); return; }
      try { message = JSON.parse(raw); } catch { return; }
      if (isForbiddenFaceMessage(message.type) || containsFaceData(message)) { socket.close(4403, 'face data is forbidden in cloud'); return; }
      if (!deviceId) {
        if (message.type !== 'authenticate' || typeof message.token !== 'string') { socket.close(4401, 'device authentication required'); return; }
        void (async () => {
          const result = await database.query(
            `SELECT d.id,d.classroom_id FROM classroom_devices d JOIN classrooms c ON c.id=d.classroom_id WHERE d.device_token_hash=$1 AND d.client_type='classroom-desktop' AND d.revoked_at IS NULL AND c.status='active' LIMIT 1`,
            [hashOpaqueToken(message.token as string, config.KEY_PEPPER)],
          );
          if (!result.rowCount) { socket.close(4401, 'device token invalid'); return; }
          deviceId = result.rows[0].id;
          clearTimeout(authTimer);
          classroomSocketDeviceIds.set(socket, deviceId);
          classroomId = result.rows[0].classroom_id;
          socketAdd(classroomSockets, classroomId, socket);
          await database.query("UPDATE classroom_devices SET status='online',last_seen_at=now() WHERE id=$1", [deviceId]);
          socket.send(JSON.stringify({ protocolVersion:1, id:randomUUID(), type:'session.ready', classroomId, timestamp:new Date().toISOString(), payload:{ deviceId } }));
          const restore = await classroomRestoreSnapshot(classroomId);
          if (restore) socket.send(JSON.stringify(restore));
        })().catch(() => socket.close(1011, 'authentication failed'));
        return;
      }
      if (message.type === 'pong' && deviceId) void database.query('UPDATE classroom_devices SET last_seen_at=now() WHERE id=$1', [deviceId]);
      if (message.type === 'device.status' && deviceId) {
        const payload = message.payload && typeof message.payload === 'object' ? message.payload as Record<string, unknown> : {};
        const lanConnectionCode = String(payload.lanConnectionCode || '').replace(/[^0-9]/g, '').slice(0, 20) || null;
        void database.query('UPDATE classroom_devices SET last_seen_at=now(),lan_connection_code=$2,lan_status_updated_at=now() WHERE id=$1', [deviceId, lanConnectionCode]);
        return;
      }
      if (message.type === 'device.snapshot-applied' && deviceId) {
        void database.query('UPDATE classrooms SET last_device_sync_at=now(),updated_at=now() WHERE id=$1', [classroomId]);
        return;
      }
      if (message.type === 'sync' && classroomId) {
        void mirrorClassroomSnapshot(classroomId, message)
          .then(() => broadcastCloudSnapshot(classroomId))
          .catch(error => app.log.error(error));
        return;
      }
      if (classroomId) {
        const targetClientId = String(message._cloudClientId || '');
        delete message._cloudClientId;
        clientSockets.get(classroomId)?.forEach(client => {
          if (!targetClientId || clientSocketIds.get(client) === targetClientId) client.send(JSON.stringify(message));
        });
      }
    };
    socket.onclose = () => {
      clearTimeout(authTimer);
      if (classroomId) socketRemove(classroomSockets, classroomId, socket);
      if (deviceId) void database.query("UPDATE classroom_devices SET status='offline',last_seen_at=now() WHERE id=$1", [deviceId]);
    };
  });

  app.get('/ws/v1/client', { websocket:true }, (socket, request) => {
    const query = z.object({ client:z.enum(['teacher-desktop','mini-program']), protocol:z.literal('1') }).safeParse(request.query);
    if (!query.success) { socket.close(4403, 'client identity invalid'); return; }
    let subject:AccessSubject | null = null;
    let subscribedClassroom = '';
    let cloudMembership:Record<string, unknown> | null = null;
    const authTimer = setTimeout(() => { if (!subject) socket.close(4401, 'access token timeout'); }, 10000);
    authTimer.unref();
    const cloudClientId = randomUUID();
    clientSocketIds.set(socket, cloudClientId);
    socket.onmessage = event => {
      void (async () => {
        let message:Record<string, unknown>;
        const raw = String(event.data);
        if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) { socket.close(4400, 'message too large'); return; }
        try { message = JSON.parse(raw); } catch { return; }
        if (isForbiddenFaceMessage(message.type) || containsFaceData(message)) { socket.close(4403, 'face data is forbidden in cloud'); return; }
        if (!subject) {
          if (message.type !== 'authenticate' || typeof message.token !== 'string') { socket.close(4401, 'access token required'); return; }
          const value = await verifyAccessToken(message.token, config);
          if (value.subjectType !== 'user' || value.role !== 'teacher') throw new Error('teacher required');
          const device = await database.query(
            `SELECT d.id,d.device_type,u.status,u.server_role FROM user_devices d JOIN users u ON u.id=d.user_id
             WHERE d.user_id=$1 AND ($2::uuid IS NULL OR d.id=$2::uuid) AND d.revoked_at IS NULL ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC LIMIT 1`,
            [value.subjectId, value.deviceId || null],
          );
          if (!device.rowCount || device.rows[0].status !== 'active' || device.rows[0].server_role !== 'teacher' || !compatibleUserClient('teacher', device.rows[0].device_type, query.data.client)) throw new Error('device identity invalid');
          value.deviceId = device.rows[0].id;
          subject = value;
          clearTimeout(authTimer);
          clientSubjects.set(socket, value);
          socket.send(JSON.stringify({ protocolVersion:1, id:randomUUID(), type:'session.ready', classroomId:null, timestamp:new Date().toISOString(), payload:{ userId:value.subjectId } }));
          return;
        }
        const activeSubject = subject;
        if (message.type === 'subscribe') {
          const classroomId = String(message.classroomId || '');
          const member = await database.query("SELECT m.role,m.subjects_json,u.name,u.legacy_connection_id FROM classroom_members m JOIN users u ON u.id=m.user_id JOIN classrooms c ON c.id=m.classroom_id WHERE m.classroom_id=$1 AND m.user_id=$2 AND m.status='approved' AND u.status='active' AND c.status='active'", [classroomId, subject.subjectId]);
          if (!member.rowCount) { socket.send(JSON.stringify({ type:'error', error:'PERMISSION_DENIED' })); return; }
          cloudMembership = { userId:subject.subjectId, name:member.rows[0].name, connectionId:member.rows[0].legacy_connection_id || `cloud-${subject.subjectId}`, role:member.rows[0].role, subjects:member.rows[0].subjects_json || [] };
          if (subscribedClassroom) socketRemove(clientSockets, subscribedClassroom, socket);
          subscribedClassroom = classroomId;
          socketAdd(clientSockets, classroomId, socket);
          socket.send(JSON.stringify({ protocolVersion:1, id:randomUUID(), type:'subscription.ready', classroomId, timestamp:new Date().toISOString(), payload:{} }));
          const snapshot = await legacySyncSnapshot(classroomId, subject.subjectId);
          if (snapshot) socket.send(JSON.stringify(snapshot));
          return;
        }
        if (!subscribedClassroom || message.classroomId !== subscribedClassroom) return;
        const liveMembership = await database.query("SELECT m.role,m.subjects_json,u.name,u.legacy_connection_id,u.status AS user_status,m.status AS member_status FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 AND m.user_id=$2", [subscribedClassroom, subject.subjectId]);
        if (!liveMembership.rowCount || liveMembership.rows[0].user_status !== 'active' || liveMembership.rows[0].member_status !== 'approved') { socket.close(4403, 'membership revoked'); return; }
        cloudMembership = { userId:subject.subjectId, name:liveMembership.rows[0].name, connectionId:liveMembership.rows[0].legacy_connection_id || `cloud-${subject.subjectId}`, role:liveMembership.rows[0].role, subjects:liveMembership.rows[0].subjects_json || [] };
        if (cloudMembership.role !== 'homeroom' && ['call','update-classroom','update-assignments','update-submission','label-face','manage-teacher'].includes(String(message.type || ''))) {
          socket.send(JSON.stringify({ type:'auth-required', message:'普通授课教师仅可查看本人授课科目的作业与出勤情况' }));
          return;
        }
        if (message.type === 'call' && !(classroomSockets.get(subscribedClassroom)?.size)) {
          socket.send(JSON.stringify({ type:'delivery-unavailable', message:'教室端当前离线，呼叫未发送' }));
          return;
        }
        if (message.type === 'leave-classroom') {
          await database.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2', [subscribedClassroom, subject.subjectId]);
        }
        if (message.type === 'manage-teacher') {
          if (!cloudMembership || cloudMembership.role !== 'homeroom') { socket.send(JSON.stringify({ type:'auth-required', message:'仅班主任可管理教师成员' })); return; }
          const action = String(message.action || '');
          const connectionId = String(message.connectionId || '');
          const target = await database.query('SELECT u.id,m.role FROM users u JOIN classroom_members m ON m.user_id=u.id AND m.classroom_id=$1 WHERE u.organization_id=$2 AND u.legacy_connection_id=$3', [subscribedClassroom, subject.organizationId, connectionId]);
          if (target.rowCount) {
            const userId = target.rows[0].id;
            if (action === 'remove' || action === 'reject') await database.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2 AND user_id<>$3', [subscribedClassroom, userId, subject.subjectId]);
            else if (action === 'update' || action === 'approve') {
              const subjects = Array.isArray(message.subjects) ? message.subjects.map(String).filter(Boolean).slice(0, 30) : [];
              await database.query("UPDATE classroom_members SET status='approved',subjects_json=CASE WHEN cardinality($3::text[])>0 THEN to_jsonb($3::text[]) ELSE subjects_json END,joined_at=COALESCE(joined_at,now()),updated_at=now() WHERE classroom_id=$1 AND user_id=$2", [subscribedClassroom, userId, subjects]);
            } else if (action === 'transfer' && userId !== subject.subjectId) {
              await transaction(database, async client => {
                await client.query("UPDATE classroom_members SET role='teacher',updated_at=now() WHERE classroom_id=$1 AND user_id=$2 AND role='homeroom'", [subscribedClassroom, activeSubject.subjectId]);
                await client.query("UPDATE classroom_members SET role='homeroom',status='approved',joined_at=COALESCE(joined_at,now()),updated_at=now() WHERE classroom_id=$1 AND user_id=$2", [subscribedClassroom, userId]);
              });
              cloudMembership = { ...cloudMembership, role:'teacher' };
            }
          }
        }
        if (await applyLegacyCloudMutation(subscribedClassroom, subject, message)) {
          await database.query('UPDATE classrooms SET revision=revision+1,last_cloud_mutation_at=now(),updated_at=now() WHERE id=$1', [subscribedClassroom]);
          await broadcastCloudSnapshot(subscribedClassroom);
        }
        classroomSockets.get(subscribedClassroom)?.forEach(device => device.send(JSON.stringify({ ...message, _cloudClientId:cloudClientId, _cloudMembership:cloudMembership })));
      })().catch(() => socket.close(1011, 'message failed'));
    };
    socket.onclose = () => { clearTimeout(authTimer); if (subscribedClassroom) socketRemove(clientSockets, subscribedClassroom, socket); };
  });

  app.addHook('onClose', async () => { await database.end(); });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = loadConfig();
    const database = createDatabase(config);
    const app = await buildServer({ config, database });
    await app.listen({ host:config.HOST, port:config.PORT });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { hostname?:string };
    if (failure.code === 'ENOTFOUND' && failure.hostname === 'postgres') {
      console.error('[启动失败] DATABASE_URL 中的主机名 postgres 只能在 Docker Compose 网络内使用。请启动 Docker 后执行 docker compose up -d --build；若要直接运行 npm start，请把 DATABASE_URL 的主机改为本机 PostgreSQL 地址。');
    } else if (failure.code === 'ECONNREFUSED') {
      console.error('[启动失败] 无法连接 PostgreSQL，请确认数据库已经启动并检查 .env 中的 DATABASE_URL。');
    } else {
      console.error('[启动失败]', failure.message || failure);
    }
    process.exitCode = 1;
  }
}
