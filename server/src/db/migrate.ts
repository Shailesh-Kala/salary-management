import path from 'node:path';
import { runner } from 'node-pg-migrate';

export async function migrate(databaseUrl: string, log: (msg: string) => void = () => {}) {
  await runner({
    databaseUrl,
    dir: path.join(import.meta.dirname, '../../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log,
  });
}
