import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('connection keys identify a classroom or one pre-created teacher account', () => {
  const migration = readFileSync(new URL('../migrations/005_entity_identity_keys.sql', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

  assert.match(migration, /key_type = 'teacher' AND target_user_id IS NOT NULL/);
  assert.match(migration, /key_type = 'classroom' AND target_classroom_id IS NOT NULL/);
  assert.match(migration, /WHERE key_type = 'membership'/);
  assert.match(server, /JOIN users u ON u\.id=e\.target_user_id/);
  assert.doesNotMatch(server, /app\.post\('\/api\/v1\/classrooms\/join'/);
  assert.doesNotMatch(server, /startsWith\('mk_'\)/);
});

test('classroom snapshots reconcile known cloud identities without creating accounts', () => {
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const mirror = server.slice(server.indexOf('async function mirrorClassroomSnapshot'), server.indexOf('async function legacySyncSnapshot'));

  assert.match(mirror, /legacy_connection_id=\$2/);
  assert.match(mirror, /sync_source='classroom'/);
  assert.doesNotMatch(mirror, /INSERT INTO users/);
});

test('websocket credentials are sent after the encrypted connection opens', () => {
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

  assert.match(server, /message\.type !== 'authenticate'/);
  assert.doesNotMatch(server, /z\.object\(\{ token:z\.string\(\)\.optional\(\), client:/);
});
