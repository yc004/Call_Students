import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { accessibleCampusIds, canAccessCampus, hasOrganizationScope } from '../src/common/scope-policy.js';
import type { AuthContext } from '../src/common/auth-context.js';
import { loadConfig } from '../src/config.js';

function context(scopes:AuthContext['scopes']):AuthContext {
  const grants=scopes.map((scope,index)=>({roleId:`role-${index}`,scope,permissions:['campus.read']}));
  return { subjectType:'user',subjectId:'user-1',organizationId:'org-1',role:'admin',permissions:['campus.read'],scopes,grants };
}

test('enterprise server boots NestJS with Fastify and exposes only v2', () => {
  const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(main,/NestFactory/);
  assert.match(main,/FastifyAdapter/);
  assert.match(main,/setGlobalPrefix\('api\/v2'\)/);
  assert.equal(pkg.scripts.start.includes('dist/main.js'),true);
  assert.doesNotMatch(main,/api\/v1|ws\/v1|buildLegacy/);
  assert.equal(existsSync(new URL('../src/server.ts',import.meta.url)),false);
  assert.equal(existsSync(new URL('../admin-web/index.html',import.meta.url)),false);
  const classroomGateway=readFileSync(new URL('../src/modules/devices/classroom-device.gateway.ts',import.meta.url),'utf8');
  assert.match(classroomGateway,/path:'\/ws\/classroom'/);
});

test('OpenHarmony mini-program POST responses explicitly close reused HTTP connections', () => {
  const main = readFileSync(new URL('../src/main.ts',import.meta.url), 'utf8');
  assert.match(main, /request\.method==='POST'/);
  assert.match(main, /x-banda-client.*mini-program/);
  assert.match(main, /reply\.header\('Connection','close'\)/);
});

test('production refuses an unbounded trusted proxy configuration',()=>{
  assert.throws(()=>loadConfig({
    NODE_ENV:'production',PUBLIC_URL:'https://cloud.example.test',DATABASE_URL:'postgresql://unused',
    ACCESS_TOKEN_SECRET:'a'.repeat(32),KEY_PEPPER:'b'.repeat(32),SETUP_TOKEN:'setup-token-1234567890',TRUST_PROXY:'true',
  }),/生产环境不能信任任意代理/);
});

test('admin web keeps refresh credentials in an HttpOnly cookie',()=>{
  const controller=readFileSync(new URL('../src/modules/auth/auth.controller.ts',import.meta.url),'utf8');
  const adminApi=readFileSync(new URL('../admin-web/apps/web-antd/src/api/core/auth.ts',import.meta.url),'utf8');
  const adminStore=readFileSync(new URL('../admin-web/apps/web-antd/src/store/auth.ts',import.meta.url),'utf8');
  assert.match(controller,/HttpOnly/);
  assert.match(controller,/SameSite=Strict/);
  assert.match(adminApi,/x-banda-client.*admin-web/);
  assert.doesNotMatch(adminApi,/localStorage/);
  assert.doesNotMatch(adminStore,/banda_refresh_token/);
});

test('refresh rotation is single-use and revokes a token family on replay', () => {
  const auth = readFileSync(new URL('../src/modules/auth/auth.service.ts',import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /interval '30 seconds'/);
  assert.match(auth, /device_revoked_at/);
  assert.match(auth, /refresh_token\.reuse/);
  assert.match(auth, /WHERE family_id=\$1/);
  assert.match(auth, /replaced_by/);
  assert.match(auth, /createSession/);
});

test('enterprise migration defines tenant roles, scopes, jobs, and outbox',()=>{
  const sql=readFileSync(new URL('../migrations/008_enterprise_core.sql',import.meta.url),'utf8');
  for(const table of ['campuses','permissions','roles','user_role_bindings','login_events','security_events','outbox_events','background_jobs']){
    assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql,/organization_owner/);
  assert.match(sql,/auth_version/);
});

test('data scope policy isolates campuses unless organization scope is present',()=>{
  const scoped=context([{type:'campus',id:'campus-a'}]);
  assert.equal(hasOrganizationScope(scoped,'campus.read'),false);
  assert.deepEqual(accessibleCampusIds(scoped,'campus.read'),['campus-a']);
  assert.equal(canAccessCampus(scoped,'campus-a','campus.read'),true);
  assert.equal(canAccessCampus(scoped,'campus-b','campus.read'),false);
  assert.equal(canAccessCampus(context([{type:'organization',id:'org-1'}]),'campus-b','campus.read'),true);
});

test('administrators reset user passwords through one-time generated credentials',()=>{
  const controller=readFileSync(new URL('../src/modules/users/user.controller.ts',import.meta.url),'utf8');
  const dto=readFileSync(new URL('../src/modules/users/user.dto.ts',import.meta.url),'utf8');
  const service=readFileSync(new URL('../src/modules/users/user.service.ts',import.meta.url),'utf8');
  const admin=readFileSync(new URL('../admin-web/apps/web-antd/src/views/enterprise/users.vue',import.meta.url),'utf8');
  assert.match(controller,/@Post\(':id\/reset-password'\)/);
  assert.doesNotMatch(dto,/defaultPassword/);
  assert.match(service,/generateInitialPassword\(passwordType\)/);
  assert.match(service,/must_change_password=true/);
  assert.match(service,/user\.password\.reset/);
  assert.match(admin,/>\s*重置密码<\/Button\s*>/);
  assert.doesNotMatch(admin,/Input\.Password|defaultPassword/);
});

test('classroom operational status exposes device health but never recognition-derived attendance',()=>{
  const migration=readFileSync(new URL('../migrations/014_classroom_operational_status.sql',import.meta.url),'utf8');
  const devices=readFileSync(new URL('../src/modules/devices/device.service.ts',import.meta.url),'utf8');
  const classrooms=readFileSync(new URL('../src/modules/classrooms/classroom.service.ts',import.meta.url),'utf8');
  assert.match(migration,/operational_status_json/);
  assert.match(devices,/normalizeOperationalStatus/);
  assert.match(classrooms,/app_ready/);
  assert.match(classrooms,/attendanceCloudAvailable:false/);
  assert.doesNotMatch(classrooms,/current_person_count|attendance_details|currentPeople/);
});

test('cloud classroom configuration follows its authoritative student roster',()=>{
  const migration=readFileSync(new URL('../migrations/015_backfill_classroom_configured.sql',import.meta.url),'utf8');
  const classrooms=readFileSync(new URL('../src/modules/classrooms/classroom.service.ts',import.meta.url),'utf8');
  assert.match(migration,/configured = true/);
  assert.match(migration,/s\.status = 'active'/);
  assert.match(classrooms,/SET configured=\(btrim\(c\.name\)<>'' AND EXISTS/);
  assert.match(classrooms,/RETURNING revision,configured/);
});
