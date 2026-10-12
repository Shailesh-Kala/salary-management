import { z } from 'zod';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db/pool.ts';
import { createClock } from '../src/lib/clock.ts';
import { seedDatabase } from '../src/seed/seed.ts';

const SEED = 42;
const COUNT = 10_000;

const config = loadConfig(process.env);
const admin = z
  .object({ SEED_ADMIN_EMAIL: z.email(), SEED_ADMIN_PASSWORD: z.string().min(8) })
  .parse(process.env);
const db = createPool(config.DATABASE_URL);
const started = performance.now();

try {
  const result = await seedDatabase(db, {
    count: COUNT,
    seed: SEED,
    today: createClock(config.APP_TIMEZONE).today(),
    admin: { email: admin.SEED_ADMIN_EMAIL, password: admin.SEED_ADMIN_PASSWORD },
    reset: process.argv.includes('--reset'),
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  console.log(
    `Seeded ${result.employees} employees and ${result.changes} history entries in ${seconds} s`,
  );
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
