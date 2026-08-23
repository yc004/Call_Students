import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL:'postgresql://localhost/banda', ACCESS_TOKEN_SECRET:'a'.repeat(32), KEY_PEPPER:'b'.repeat(32), SETUP_TOKEN:'c'.repeat(16),
};

test('production configuration requires HTTPS public URL', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV:'production', PUBLIC_URL:'http://cloud.example.com' }));
  assert.equal(loadConfig({ ...base, NODE_ENV:'production', PUBLIC_URL:'https://cloud.example.com' }).PORT, 8080);
});
