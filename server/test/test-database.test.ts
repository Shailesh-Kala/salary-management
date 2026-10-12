import { describe, expect, it } from 'vitest';
import { testDatabaseUrl } from './test-database.ts';

describe('testDatabaseUrl', () => {
  it('returns TEST_DATABASE_URL when it is set and differs from DATABASE_URL', () => {
    const env = { TEST_DATABASE_URL: 'postgres://h/app_test', DATABASE_URL: 'postgres://h/app' };

    expect(testDatabaseUrl(env)).toBe('postgres://h/app_test');
  });

  it('refuses to run when TEST_DATABASE_URL is missing', () => {
    expect(() => testDatabaseUrl({ DATABASE_URL: 'postgres://h/app' })).toThrow(
      /TEST_DATABASE_URL is not set/,
    );
  });

  it('refuses to run against the application database', () => {
    const env = { TEST_DATABASE_URL: 'postgres://h/app', DATABASE_URL: 'postgres://h/app' };

    expect(() => testDatabaseUrl(env)).toThrow(/must differ from DATABASE_URL/);
  });
});
