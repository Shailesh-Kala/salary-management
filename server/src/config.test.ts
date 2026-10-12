import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/app';

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
    });
  });

  it('parses provided values', () => {
    expect(loadConfig({ NODE_ENV: 'production', PORT: '8080', DATABASE_URL })).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
    });
  });

  it('fails fast naming each invalid or missing variable', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', PORT: 'abc' })).toThrow(
      /NODE_ENV.*PORT.*DATABASE_URL/,
    );
  });
});
