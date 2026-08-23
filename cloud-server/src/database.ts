import pg from 'pg';
import type { CloudConfig } from './config.js';

const { Pool } = pg;

export type Database = pg.Pool;
export type DatabaseClient = pg.PoolClient;

export function createDatabase(config: CloudConfig): Database {
  return new Pool({ connectionString:config.DATABASE_URL, max:20, idleTimeoutMillis:30000 });
}

export async function transaction<T>(database: Database, action: (client:DatabaseClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
