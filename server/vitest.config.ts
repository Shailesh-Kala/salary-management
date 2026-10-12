import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('../.env')) process.loadEnvFile('../.env');

export default defineConfig({
  test: {
    // A non-UTC zone makes any accidental local-time date handling fail loudly (D-039).
    env: { TZ: 'America/Los_Angeles' },
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
  },
});
