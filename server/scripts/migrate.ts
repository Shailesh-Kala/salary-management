import { loadConfig } from '../src/config.ts';
import { migrate } from '../src/db/migrate.ts';

await migrate(loadConfig(process.env).DATABASE_URL, console.log);
