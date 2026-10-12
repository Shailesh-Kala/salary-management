import type { Pool } from 'pg';
import { pino } from 'pino';
import { createApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import type { Clock } from '../src/lib/clock.ts';
import { testPool } from './db.ts';

export type TestClock = Clock & { advance(ms: number): void };

export function fixedClock(iso = '2026-10-12T09:00:00Z'): TestClock {
  let time = new Date(iso).getTime();
  return {
    now: () => new Date(time),
    advance: (ms) => {
      time += ms;
    },
  };
}

export const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  DATABASE_URL: 'postgres://unused-in-tests',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
  COOKIE_SECURE: true,
};

export function buildTestApp({
  db = testPool,
  clock = fixedClock(),
  config = {},
}: { db?: Pool; clock?: Clock; config?: Partial<Config> } = {}) {
  return createApp({
    logger: pino({ level: 'silent' }),
    db,
    clock,
    config: { ...testConfig, ...config },
  });
}
