import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(loadConfig({})).toEqual({ NODE_ENV: 'development', PORT: 3000 });
  });

  it('parses provided values', () => {
    expect(loadConfig({ NODE_ENV: 'production', PORT: '8080' })).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
    });
  });

  it('fails fast naming each invalid variable', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', PORT: 'abc' })).toThrow(/NODE_ENV.*PORT/);
  });
});
