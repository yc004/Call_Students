import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './database.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '..', 'migrations');

export async function migrate(database:Database): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('banda-cloud-schema-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');
    const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationDir, file), 'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [file]);
      if(existing.rowCount){
        if(existing.rows[0].checksum&&existing.rows[0].checksum!==checksum)throw new Error(`Migration checksum mismatch: ${file}`);
        if(!existing.rows[0].checksum)await client.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1',[file,checksum]);
        continue;
      }
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)', [file,checksum]);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('banda-cloud-schema-migrations'))").catch(()=>undefined);
    client.release();
  }
}
