import { loadConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { migrate } from '../migrate.js';

const database = createDatabase(loadConfig());
try {
  await migrate(database);
  console.log('database migrations completed');
} finally { await database.end(); }
