import { migrate } from '../src/db/migrate.ts';
import { testDatabaseUrl } from './test-database.ts';

export default async function setup() {
  await migrate(testDatabaseUrl());
}
