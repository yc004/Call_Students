import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Database } from '../database.js';
import { DATABASE } from './tokens.js';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  async onApplicationShutdown():Promise<void> {
    await this.database.end();
  }
}
