import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin classroom query projects the device id used by its outer select', () => {
  const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

  assert.match(
    serverSource,
    /SELECT c\.\*,[\s\S]*?d\.id AS device_id[\s\S]*?LEFT JOIN LATERAL \(\s*SELECT id,status,last_seen_at,lan_connection_code FROM classroom_devices/,
  );
});

test('admin classroom form keeps a stable form reference across await', () => {
  const adminSource = readFileSync(new URL('../admin-web/app.js', import.meta.url), 'utf8');

  assert.match(adminSource, /const form=event\.currentTarget;try\{const created=await api\('\/api\/v1\/admin\/classrooms'/);
  assert.match(adminSource, /form\.reset\(\)/);
  assert.doesNotMatch(adminSource, /event\.currentTarget\.reset/);
});

test('cloud homework mutations preserve seeded submission records for authorized teachers', () => {
  const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(serverSource, /if \(!isHomeroom\) return false;\s*if \(message\.type === 'update-classroom'/);
  assert.match(serverSource, /item\.submissions && typeof item\.submissions === 'object'/);
  assert.match(serverSource, /INSERT INTO submissions \(assignment_id,student_id,status,updated_by\)/);
  assert.doesNotMatch(serverSource, /\['call','update-classroom','update-assignments','update-submission','label-face','manage-teacher'\]/);
});

test('admin exposes scoped detail, update, and deletion operations for classrooms and teachers', () => {
  const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

  assert.match(serverSource, /app\.get\('\/api\/v1\/admin\/classrooms\/:id'/);
  assert.match(serverSource, /app\.delete\('\/api\/v1\/admin\/classrooms\/:id'/);
  assert.match(serverSource, /SELECT id,name FROM classrooms WHERE id=\$1 AND organization_id=\$2/);
  assert.match(serverSource, /app\.get\('\/api\/v1\/admin\/users\/:id'/);
  assert.match(serverSource, /app\.delete\('\/api\/v1\/admin\/users\/:id'/);
  assert.match(serverSource, /SELECT id,name FROM users WHERE id=\$1 AND organization_id=\$2 AND server_role='teacher'/);
});

test('admin entity delete uses simple confirmation', () => {
  const adminSource = readFileSync(new URL('../admin-web/app.js', import.meta.url), 'utf8');
  const adminMarkup = readFileSync(new URL('../admin-web/index.html', import.meta.url), 'utf8');

  assert.match(adminMarkup, /id="entityDialog"/);
  assert.match(adminSource, /confirm\('确定删除'/);
  assert.match(adminSource, /method:'DELETE'/);
});

test('admin omits JSON content type for bodyless requests', () => {
  const adminSource = readFileSync(new URL('../admin-web/app.js', import.meta.url), 'utf8');

  assert.match(adminSource, /if \(options\.body !== undefined && options\.body !== null/);
  assert.doesNotMatch(adminSource, /const headers = \{ 'Content-Type':'application\/json'/);
});

test('admin classroom and teacher lists include unconnected entities', () => {
  const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(serverSource, /AND EXISTS \(SELECT 1 FROM classroom_devices connected_device/);
  assert.doesNotMatch(serverSource, /AND EXISTS \(SELECT 1 FROM user_devices connected_device/);
  assert.match(serverSource, /LEFT JOIN LATERAL \(/);
});
