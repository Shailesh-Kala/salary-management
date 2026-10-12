import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const required = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters',
};

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(loadConfig(required)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      COOKIE_SECURE: true,
      CORS_ORIGIN: 'http://localhost:5173',
      ...required,
    });
  });

  it('parses provided values', () => {
    const env = { ...required, NODE_ENV: 'production', PORT: '8080', COOKIE_SECURE: 'false' };

    expect(loadConfig(env)).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      COOKIE_SECURE: false,
    });
  });

  it('fails fast naming each invalid or missing variable', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', PORT: 'abc', JWT_SECRET: 'short' })).toThrow(
      /NODE_ENV.*PORT.*DATABASE_URL.*JWT_SECRET/,
    );
  });
});
